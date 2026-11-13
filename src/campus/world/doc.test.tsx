import { readFile } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { initialize, Stream } from 'docstream';
import { Doc, DocText } from './doc';

const fixture = await readFile(new URL('./doc.md', import.meta.url), 'utf8');
beforeAll(async () => {
    await initialize(new Uint8Array(await readFile(new URL('../../../node_modules/docstream/wasm/docstream_wasm_bg.wasm', import.meta.url))));
});

describe('documents drawn from the released kernel', () => {
    it('draws formulas and diagrams alongside formatted text', () => {
        const html = renderToStaticMarkup(<DocText text={fixture} />);
        expect(html).toContain('class="doc-tex"');
        expect(html).toContain('class="doc-math"');
        expect(html.match(/class="doc-diagram"/g)).toHaveLength(2);
        expect(html).toContain('<path');
        expect(html).toContain('viewBox=');
        expect(html).toContain('进入课表');
        expect(html).toContain('流式回答');
        expect(html).toContain('<strong>加粗</strong>');
        expect(html).toContain('<mark>重点</mark>');
        expect(html).toContain('<sub>2</sub>');
        expect(html).toContain('<sup>2</sup>');
        expect(html).toContain('<table>');
    });

    it('renders every streamed prefix and ends with the same document', () => {
        const stream = new Stream();
        try {
            for (const part of fixture) {
                const update = stream.push(part);
                expect(() => renderToStaticMarkup(<Doc blocks={update.blocks} live />)).not.toThrow();
            }
            expect(renderToStaticMarkup(<Doc blocks={stream.finish().blocks} />)).toBe(renderToStaticMarkup(<DocText text={fixture} />));
        } finally { stream.free(); }
    });

    it('keeps unsupported diagrams and raw HTML readable without executing them', () => {
        const html = renderToStaticMarkup(<DocText text={'```mermaid\npie\n  "A" : 1\n```\n\n<img src=x onerror="alert(1)">'} />);
        expect(html).toContain('pie');
        expect(html).not.toContain('<figure');
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;img');
    });
});
