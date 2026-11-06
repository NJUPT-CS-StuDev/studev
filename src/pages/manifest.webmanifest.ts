import type { APIRoute } from 'astro';
import tokens from '../../design/tokens.json';

export const GET: APIRoute = () => new Response(JSON.stringify({
    id: '/', name: 'studev 校园助手', short_name: 'studev', lang: 'zh-CN',
    description: '南邮的课表、考试、校历、地图和空教室。',
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
