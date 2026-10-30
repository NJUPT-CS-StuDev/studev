import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import tokens from '../../../design/tokens.json';

export const getStaticPaths = () => ['180', '192', '512', '512-maskable'].map(icon => ({ params: { icon } }));
export const GET: APIRoute = async ({ params }) => {
    const size = Number(params.icon?.split('-')[0]);
    const contentSize = Math.round(size * (params.icon?.includes('maskable') ? .66 : .86));
    const source = await readFile('src/assets/logo.png');
    const image = await sharp(source).resize(contentSize, contentSize, { fit: 'contain', background: tokens.color.light.paper }).png().toBuffer();
    const output = await sharp({ create: { width: size, height: size, channels: 4, background: tokens.color.light.paper } })
        .composite([{ input: image, gravity: 'centre' }]).png().toBuffer();
    return new Response(new Uint8Array(output), { headers: { 'Content-Type': 'image/png' } });
};
