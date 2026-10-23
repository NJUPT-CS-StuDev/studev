import { build } from 'esbuild';

// EdgeOne's Node wrapper declares a top-level `env`. Prebundle server dependencies
// with identifier aliases so a dependency's `import { env } from 'process'` cannot collide.
// This output is server-only and contains no build-time values or credentials.
await build({
  entryPoints: ['src/server/collection-entry.mjs'],
  outfile: '.collection-build/handler.mjs',
  bundle: true,
  // Leave Blob to the official CLI's native handling and keep its import discoverable.
  // Only the S3 dependency needs prebundling to avoid the wrapper's identifier collision.
  external: ['@edgeone/pages-blob'],
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minifyIdentifiers: true,
  minifySyntax: true,
  banner: { js: "import { createRequire as __collectionCreateRequire } from 'node:module'; const require = __collectionCreateRequire(import.meta.url);" },
});

await build({
  entryPoints: ['src/server/platform-entry.mjs'],
  outfile: '.collection-build/platform.mjs',
  bundle: true,
  external: ['@edgeone/pages-blob'],
  platform: 'node', format: 'esm', target: 'node20',
  minifyIdentifiers: true, minifySyntax: true,
  banner: { js: "import { createRequire as __platformCreateRequire } from 'node:module'; const require = __platformCreateRequire(import.meta.url);" },
});
