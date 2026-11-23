import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const release = JSON.parse(await readFile('src/data/campus-release.json', 'utf8'));
const { terms } = JSON.parse(await readFile('public' + release.base + '/calendar.json', 'utf8'));
const first = terms.find(term => term.number === 1);
const second = terms.find(term => term.number === 2);
if (!first?.start || !second?.end || Number(first.start.slice(0, 4)) + 1 !== Number(second.end.slice(0, 4))) {
  throw new Error('The published campus calendar has no complete academic year.');
}
const end = new Date(second.end + 'T00:00:00Z');
end.setUTCDate(end.getUTCDate() + 1);
const academicYear = {
  id: first.start.slice(0, 4) + '-' + second.end.slice(0, 4),
  startsOn: first.start,
  endsBefore: end.toISOString().slice(0, 10),
};

// EdgeOne's Node wrapper declares a top-level `env`. Prebundle server dependencies
// with identifier aliases so a dependency's `import { env } from 'process'` cannot collide.
// This output is server-only and contains no build-time values or credentials.
await build({
  entryPoints: { platform: 'src/platform/server/entry.mjs' },
  outdir: '.server-build',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  external: ['@edgeone/pages-blob'],
  platform: 'node', format: 'esm', target: 'node20',
  define: { __STUDEV_ACADEMIC_YEAR__: JSON.stringify(academicYear) },
  minifyIdentifiers: true, minifySyntax: true,
  banner: { js: "import { createRequire as __platformCreateRequire } from 'node:module'; const require = __platformCreateRequire(import.meta.url);" },
});
