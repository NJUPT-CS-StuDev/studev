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
  // Knowledge and the native clients wear the same twelve authored course tones.
  const courses = scheme => Object.fromEntries(Object.values(tokens.course[scheme]).flatMap((tone, index) => Object.entries(tone).map(([part, value]) => [`course-tone-${index}-${part}`, value])));
  const declarations = values => Object.entries(values).map(([name, value]) => `  --${kebab(name)}: ${value};`).join('\n');
  const dimensions = {};
  for (const section of ['radius', 'size', 'space', 'motion', 'elevation']) {
    for (const [name, value] of Object.entries(tokens[section])) dimensions[`${section}-${name}`] = `${value}${section === 'motion' ? 'ms' : section === 'elevation' ? '' : 'px'}`;
  }
  for (const [name, values] of Object.entries(tokens.type)) {
    for (const [key, value] of Object.entries(values)) dimensions[`type-${name}-${key}`] = `${value}${key === 'weight' ? '' : 'px'}`;
  }
  const compactHeader = tokens.size.headerContent + tokens.size.headerGap + tokens.size.accountBase + tokens.size.accountNameMin;
  return `/* Generated from design/tokens.json. */\n:root {\n${declarations(tokens.color.light)}\n${declarations(aliases)}\n${declarations(courses('light'))}\n${declarations(dimensions)}\n}\n:root[data-theme='dark'] {\n${declarations(tokens.color.dark)}\n${declarations(courses('dark'))}\n}\n@container campus-header (width < ${compactHeader}px) {\n  .sd .campus-account-slot .avatar-name { display: none; }\n  .sd .campus-account-slot .avatar { width: var(--size-target); padding-inline: 4px; gap: 0; }\n}\n`;
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
