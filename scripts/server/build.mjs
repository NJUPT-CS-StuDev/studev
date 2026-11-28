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

// The platform runs as an edge function for the requests in src/platform/server/routes.mjs and as a Node function for
// the rest. The edge build is Web APIs only and never checks a password, so ./scrypt.mjs is swapped for a stub there.
// These outputs are server-only and contain no build-time values or credentials.
const edgeScrypt = {
  name: 'edge-scrypt',
  setup(build) {
    build.onResolve({ filter: /\/scrypt\.mjs$/ }, () => ({ path: fileURLToPath(new URL('../../src/platform/server/scrypt.edge.mjs', import.meta.url)) }));
  },
};
const shared = { outdir: '.server-build', outExtension: { '.js': '.mjs' }, bundle: true, external: ['@edgeone/pages-blob'], format: 'esm',
  define: { __STUDEV_ACADEMIC_YEAR__: JSON.stringify(academicYear) } };
await build({ ...shared, entryPoints: { edge: 'src/platform/server/edge.mjs' },
  platform: 'neutral', mainFields: ['module', 'main'], conditions: ['worker', 'browser'], target: 'es2022', plugins: [edgeScrypt] });
// EdgeOne's Node wrapper declares a top-level `env`; identifiers are minified so a dependency's `env` cannot collide.
await build({ ...shared, entryPoints: { node: 'src/platform/server/node.mjs' }, platform: 'node', target: 'node20', minifyIdentifiers: true });
