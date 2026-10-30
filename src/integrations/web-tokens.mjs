import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const kebab = name => name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);

/** Platform aliases and tinted surfaces derive from the shared palette. */
export function renderWebTokens(tokens) {
  const aliases = {
    blue: 'var(--brand)', mark: 'color-mix(in srgb, var(--brand) 10%, var(--paper))',
    kbd: 'var(--surface)', 'inline-code': 'var(--surface-sunken)', 'code-block': 'var(--surface)',
    'alert-note': 'color-mix(in srgb, var(--brand) 3%, var(--paper))',
    'alert-tip': 'color-mix(in srgb, var(--success) 4%, var(--paper))',
    'alert-warning': 'color-mix(in srgb, var(--warning) 5%, var(--paper))',
    'alert-important': 'color-mix(in srgb, var(--shop) 4%, var(--paper))',
    'diagram-bg': 'var(--paper)', signature: 'var(--muted)', 'avatar-line': 'var(--line)',
    'selection-ink': 'var(--on-brand)',
    'danger-bg': 'color-mix(in srgb, var(--danger) 10%, var(--paper))',
    'danger-line': 'color-mix(in srgb, var(--danger) 30%, var(--paper))',
    'success-bg': 'color-mix(in srgb, var(--success) 10%, var(--paper))',
    'success-line': 'color-mix(in srgb, var(--success) 30%, var(--paper))',
    'warning-bg': 'color-mix(in srgb, var(--warning) 12%, var(--paper))',
    'warning-line': 'color-mix(in srgb, var(--warning) 35%, var(--paper))',
    'warning-ink': 'color-mix(in srgb, var(--warning) 75%, var(--ink))',
    'highlight': 'color-mix(in srgb, var(--warning) 25%, var(--paper))',
    'shadow-soft': 'color-mix(in srgb, var(--scrim) 16%, transparent)',
    'shadow-medium': 'color-mix(in srgb, var(--scrim) 38%, transparent)',
    'shadow-strong': 'color-mix(in srgb, var(--scrim) 80%, transparent)',
    'color-google-blue': 'var(--brand)', 'color-google-blue-dark': 'var(--brand)',
    'color-google-green': 'var(--success)', 'color-google-green-dark': 'var(--success)',
    'color-google-grey': 'var(--muted)', 'color-google-grey-dark': 'var(--muted)',
    'color-google-bg-dark': 'var(--surface)',
    'asset-paper': tokens.color.light.paper,
  };
  // Stable course slots use only the shared semantic hues. Text and borders
  // retain contrast in either scheme; the allocator keeps adjacent courses apart.
  const hues = ['brand', 'success', 'warning', 'food', 'danger', 'shop'];
  for (let index = 0; index < 24; index++) {
    const base = `var(--${hues[index % hues.length]})`;
    const companion = `var(--${hues[(index + 1 + Math.floor(index / hues.length)) % hues.length]})`;
    const hue = index < hues.length ? base : `color-mix(in oklab, ${base} ${70 - Math.floor(index / hues.length) * 10}%, ${companion})`;
    aliases[`course-tone-${index}-bg`] = `color-mix(in srgb, ${hue} 12%, var(--paper))`;
    aliases[`course-tone-${index}-border`] = `color-mix(in srgb, ${hue} 36%, var(--paper))`;
    aliases[`course-tone-${index}-fg`] = `color-mix(in srgb, ${hue} 70%, var(--ink))`;
  }
  const declarations = values => Object.entries(values).map(([name, value]) => `  --${kebab(name)}: ${value};`).join('\n');
  const dimensions = {};
  for (const section of ['radius', 'space', 'motion', 'elevation']) {
    for (const [name, value] of Object.entries(tokens[section])) dimensions[`${section}-${name}`] = `${value}${section === 'motion' ? 'ms' : section === 'elevation' ? '' : 'px'}`;
  }
  for (const [name, values] of Object.entries(tokens.type)) {
    for (const [key, value] of Object.entries(values)) dimensions[`type-${name}-${key}`] = `${value}${key === 'weight' ? '' : 'px'}`;
  }
  return `/* Generated from design/tokens.json. */\n:root {\n${declarations(tokens.color.light)}\n${declarations(aliases)}\n${declarations(dimensions)}\n}\n:root[data-theme='dark'] {\n${declarations(tokens.color.dark)}\n}\n`;
}

export default function webTokens() {
  return {
    name: 'studev-web-tokens',
    hooks: {
      'astro:config:setup': async ({ config, createCodegenDir, injectScript, addWatchFile }) => {
        const source = new URL('design/tokens.json', config.root);
        const target = new URL('tokens.css', createCodegenDir());
        await writeFile(target, renderWebTokens(JSON.parse(await readFile(source, 'utf8'))));
        addWatchFile(source);
        injectScript('page-ssr', `import ${JSON.stringify(fileURLToPath(target).replaceAll('\\', '/'))};`);
      },
    },
  };
}
