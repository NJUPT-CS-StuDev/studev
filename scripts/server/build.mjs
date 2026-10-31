import { build } from 'esbuild';

// EdgeOne's Node wrapper declares a top-level `env`. Prebundle server dependencies
// with identifier aliases so a dependency's `import { env } from 'process'` cannot collide.
// This output is server-only and contains no build-time values or credentials.
await build({
  entryPoints: ['src/server/platform-entry.mjs'],
  outfile: '.server-build/platform.mjs',
  bundle: true,
  external: ['@edgeone/pages-blob'],
  platform: 'node', format: 'esm', target: 'node20',
  minifyIdentifiers: true, minifySyntax: true,
  banner: { js: "import { createRequire as __platformCreateRequire } from 'node:module'; const require = __platformCreateRequire(import.meta.url);" },
});
