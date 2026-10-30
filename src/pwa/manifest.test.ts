import { describe, expect, it } from 'vitest';
import { GET } from '../pages/manifest.webmanifest';
import tokens from '../../design/tokens.json';

describe('install manifest', () => {
    it('has a stable identity, standalone launch and both install icon sizes', async () => {
        const response = await GET({} as Parameters<typeof GET>[0]);
        const manifest = await response.json();
        expect(manifest).toMatchObject({ id: '/', scope: '/', start_url: '/map/', display: 'standalone', theme_color: tokens.color.light.paper, background_color: tokens.color.light.paper });
        expect(manifest.icons).toEqual(expect.arrayContaining([
            expect.objectContaining({ sizes: '192x192', purpose: 'any' }),
            expect.objectContaining({ sizes: '512x512', purpose: 'any' }),
            expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
        ]));
        expect(response.headers.get('Content-Type')).toBe('application/manifest+json');
    });
});
