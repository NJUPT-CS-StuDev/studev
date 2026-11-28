import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
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

// The platform runs as an edge function (Web APIs only). Its one CPU-heavy step, the password function, runs in a
// Node function the edge calls, so the edge build swaps ./scrypt.mjs for the module that makes that call.
// These outputs are server-only and contain no build-time values or credentials.
const edgeScrypt = {
  name: 'edge-scrypt',
  setup(build) {
    build.onResolve({ filter: /\/scrypt\.mjs$/ }, (args) => ({ path: fileURLToPath(new URL('../../src/platform/server/scrypt.edge.mjs', import.meta.url)) }));
  },
};
await build({
  entryPoints: { edge: 'src/platform/server/edge.mjs' },
  outdir: '.server-build',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  external: ['@edgeone/pages-blob'],
  platform: 'neutral', mainFields: ['module', 'main'], conditions: ['worker', 'browser'], format: 'esm', target: 'es2022',
  define: { __STUDEV_ACADEMIC_YEAR__: JSON.stringify(academicYear) },
  plugins: [edgeScrypt],
});
await build({
  entryPoints: { scrypt: 'src/platform/server/scrypt-service.mjs' },
  outdir: '.server-build',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node', format: 'esm', target: 'node20',
});
