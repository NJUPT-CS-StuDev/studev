import { existsSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceDir = fileURLToPath(new URL('../../.search-data/generated', import.meta.url));

export default function searchData() {
  return {
    name: 'studev-search-data',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        if (!existsSync(sourceDir)) {
          logger.warn('No .search-data/generated directory found; skipping search bundle copy.');
          return;
        }
        const targetDir = join(fileURLToPath(dir), 'generated');
        await cp(sourceDir, targetDir, { recursive: true, force: true });
        logger.info('Copied .search-data/generated into dist/generated');
      },
    },
  };
}
