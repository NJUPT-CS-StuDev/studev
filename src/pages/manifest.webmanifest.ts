import type { APIRoute } from 'astro';
import tokens from '../../design/tokens.json';
import { PRODUCT_CONFIG } from '../campus/world/product';

export const GET: APIRoute = () => new Response(JSON.stringify({
    id: '/', name: `${PRODUCT_CONFIG.APP_NAME} · ${PRODUCT_CONFIG.ORGANIZATION}`, short_name: PRODUCT_CONFIG.APP_NAME, lang: 'zh-CN',
    description: PRODUCT_CONFIG.SUMMARY,
    start_url: '/', scope: '/', display: 'standalone',
    background_color: tokens.color.light.paper, theme_color: tokens.color.light.paper,
    icons: [
        { src: '/pwa-icons/192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/pwa-icons/512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/pwa-icons/512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
        { name: '校园地图', url: '/map/' },
        { name: '搜索', url: '/search/' },
    ],
}), { headers: { 'Content-Type': 'application/manifest+json' } });
