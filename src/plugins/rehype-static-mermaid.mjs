import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';

const CACHE_VERSION = 1;
const FONT_FAMILY = 'Segoe UI, Arial, Microsoft YaHei, sans-serif';
const palettes = {
  light: { ink: '#202124', muted: '#5f6368', line: '#dadce0', background: '#ffffff' },
  dark: { ink: '#e8edf3', muted: '#aeb8c5', line: '#323a44', background: '#1b232d' },
};

let documentQueue = Promise.resolve();
let rendererModules;

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function packageVersion(name, requireFrom) {
  let directory = dirname(requireFrom.resolve(name));
  for (;;) {
    try {
      const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
      if (manifest.name === name) return manifest.version;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Cannot determine ${name} renderer version`);
    directory = parent;
  }
}

async function loadRenderer() {
  rendererModules ??= (async () => {
    const requireFrom = createRequire(import.meta.url);
    const cliRequire = createRequire(requireFrom.resolve('@mermaid-js/mermaid-cli'));
    const [{ renderMermaid }, { default: puppeteer }] = await Promise.all([
      import('@mermaid-js/mermaid-cli'),
      import('puppeteer'),
    ]);
    return {
      renderMermaid,
      puppeteer,
      versions: {
        cli: packageVersion('@mermaid-js/mermaid-cli', requireFrom),
        mermaid: packageVersion('mermaid', cliRequire),
        puppeteer: packageVersion('puppeteer', requireFrom),
      },
    };
  })();
  return rendererModules;
}

function themeConfiguration(theme, seed) {
  const colors = palettes[theme];
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    deterministicIds: true,
    deterministicIDSeed: seed,
    fontFamily: FONT_FAMILY,
    themeVariables: {
      darkMode: theme === 'dark',
      primaryColor: colors.background,
      primaryBorderColor: colors.line,
      primaryTextColor: colors.ink,
      secondaryColor: colors.background,
      secondaryBorderColor: colors.line,
      secondaryTextColor: colors.ink,
      tertiaryColor: colors.background,
      tertiaryBorderColor: colors.line,
      tertiaryTextColor: colors.ink,
      lineColor: colors.muted,
      textColor: colors.ink,
      background: colors.background,
      mainBkg: colors.background,
      clusterBkg: colors.background,
      clusterBorder: colors.line,
      nodeBorder: colors.line,
      titleColor: colors.ink,
      edgeLabelBackground: colors.background,
      actorBkg: colors.background,
      actorBorder: colors.line,
      actorTextColor: colors.ink,
      actorLineColor: colors.muted,
      signalColor: colors.muted,
      signalTextColor: colors.ink,
      labelBoxBkgColor: colors.background,
      labelBoxBorderColor: colors.line,
      labelTextColor: colors.ink,
      loopTextColor: colors.ink,
      noteBkgColor: colors.background,
      noteBorderColor: colors.line,
      noteTextColor: colors.ink,
      fontFamily: FONT_FAMILY,
    },
  };
}

function textContent(node) {
  if (node.type === 'text') return node.value;
  return (node.children ?? []).map(textContent).join('');
}

function diagramSummary(source) {
  const candidates = [
    ...source.matchAll(/\[\s*"?([^"\]\n]+)"?\s*\]/g),
    ...source.matchAll(/^\s*(?:participant|actor)\s+\S+\s+as\s+(.+)$/gm),
  ].map((match) => match[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
  const labels = [...new Set(candidates)].filter(Boolean).slice(0, 4);
  return labels.length ? `图表：${labels.join(' → ').slice(0, 120)}` : '结构图';
}

function mermaidBlocks(tree) {
  const blocks = [];
  function visit(parent) {
    for (const [index, node] of (parent.children ?? []).entries()) {
      if (node.type === 'element' && node.tagName === 'pre') {
        const code = node.children?.find((child) => child.tagName === 'code');
        const classes = code?.properties?.className ?? [];
        const language = node.properties?.dataLanguage ?? node.properties?.['data-language'];
        if (language === 'mermaid' || classes.includes('language-mermaid')) {
          blocks.push({ parent, index, node, source: textContent(code ?? node).trim() });
          continue;
        }
      }
      if (node.children) visit(node);
    }
  }
  visit(tree);
  return blocks;
}

function namespaceSvg(svg, prefix) {
  const ids = new Map([...svg.matchAll(/\sid="([^"]+)"/g)].map((match) => [match[1], `${prefix}-${match[1]}`]));
  svg = svg.replace(/\sid="([^"]+)"/g, (attribute, id) => ids.has(id) ? ` id="${ids.get(id)}"` : attribute);
  svg = svg.replace(/#([A-Za-z_][\w:.-]*)/g, (reference, id) => ids.has(id) ? `#${ids.get(id)}` : reference);
  svg = svg.replace(/\b(aria-labelledby|aria-describedby)="([^"]+)"/g, (_attribute, name, value) => {
    const references = value.split(/\s+/).map((id) => ids.get(id) ?? id).join(' ');
    return `${name}="${references}"`;
  });
  return svg;
}

function responsiveSvg(svg, prefix) {
  const viewBox = svg.match(/\bviewBox="([^"]+)"/);
  const [, , width, height] = viewBox?.[1].split(/[\s,]+/).map(Number) ?? [];
  if (!(width > 0 && height > 0)) throw new Error('Mermaid renderer returned an SVG without a valid viewBox');
  const minWidth = Math.ceil(width <= 600 ? width : width * .875);
  svg = namespaceSvg(svg, prefix);
  svg = svg.replace(/<svg\b([^>]+)>/, (_root, attributes) => {
    attributes = attributes.replace(/\s(?:width|height|style|aria-hidden)="[^"]*"/g, '');
    return `<svg${attributes} width="${Math.ceil(width)}" height="${Math.ceil(height)}" aria-hidden="true" style="width:100%;height:auto;max-width:${Math.ceil(width)}px;min-width:${minWidth}px;">`;
  });
  return svg;
}

async function cachedDiagram(source, theme, cacheDirectory, modules, browserFor) {
  const seed = digest(source);
  const mermaidConfig = themeConfiguration(theme, seed);
  const key = digest(JSON.stringify({ version: CACHE_VERSION, source, theme, mermaidConfig, versions: modules.versions }));
  const cacheFile = join(cacheDirectory, `${key}.json`);
  try {
    const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
    if (cached.svg?.includes('<svg') && cached.key === key) return cached;
    throw new Error(`Invalid Mermaid cache entry: ${cacheFile}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const browser = await browserFor();
  const rendered = await modules.renderMermaid(browser, source, 'svg', {
    mermaidConfig,
    svgId: `mermaid-${key.slice(0, 16)}`,
    backgroundColor: 'transparent',
    fontEmbed: false,
    viewport: { width: 1600, height: 1200, deviceScaleFactor: 1 },
  });
  const svg = new TextDecoder().decode(rendered.data);
  if (!svg.startsWith('<svg') || /Syntax error in text|data-testid="error-icon"/.test(svg)) {
    throw new Error('Mermaid renderer returned an invalid diagram');
  }
  const result = { key, svg, title: rendered.title, description: rendered.desc };
  await mkdir(cacheDirectory, { recursive: true });
  await writeFile(cacheFile, JSON.stringify(result), 'utf8');
  return result;
}

/** Render Markdown Mermaid fences during compilation; no diagram JavaScript is shipped. */
export default function rehypeStaticMermaid({ cacheDir = '.astro/static-mermaid', puppeteerOptions = {} } = {}) {
  const cacheDirectory = resolve(cacheDir);
  return async function transform(tree, file) {
    const blocks = mermaidBlocks(tree);
    if (!blocks.length) return;

    const renderDocument = async () => {
      const modules = await loadRenderer();
      const documentId = digest(relative(process.cwd(), file.path ?? 'markdown').replaceAll('\\', '/')).slice(0, 12);
      let browser;
      const browserFor = async () => {
        browser ??= await modules.puppeteer.launch({
          headless: 'shell',
          args: process.platform === 'linux'
            ? ['--no-sandbox', '--disable-setuid-sandbox']
            : ['--no-sandbox', '--disable-gpu'],
          ...puppeteerOptions,
        });
        return browser;
      };
      try {
        for (const [blockIndex, block] of blocks.entries()) {
          const variants = [];
          let label = diagramSummary(block.source);
          for (const theme of ['light', 'dark']) {
            let rendered;
            try {
              rendered = await cachedDiagram(block.source, theme, cacheDirectory, modules, browserFor);
            } catch (error) {
              throw new Error(`Mermaid compilation failed in ${file.path ?? 'Markdown'} at line ${block.node.position?.start?.line ?? '?'} (${theme}): ${error.message}`, { cause: error });
            }
            label = rendered.title || rendered.description || label;
            variants.push({
              type: 'element',
              tagName: 'div',
              properties: { className: [`diagram-${theme}`] },
              children: [{ type: 'raw', value: responsiveSvg(rendered.svg, `diagram-${documentId}-${blockIndex}-${theme}`) }],
            });
          }
          block.parent.children[block.index] = {
            type: 'element',
            tagName: 'div',
            properties: { className: ['diagram-panel', 'diagram-static'], dataDiagram: 'mermaid', role: 'img', ariaLabel: label },
            children: variants,
          };
        }
      } finally {
        await browser?.close();
      }
    };

    const job = documentQueue.then(renderDocument);
    documentQueue = job.catch(() => {});
    await job;
  };
}
