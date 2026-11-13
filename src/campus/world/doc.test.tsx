import { readFile } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { diagram, initialize, Stream } from 'docstream';
import { DIAGRAMS } from './assistant.mjs';
import { Doc, DocText } from './doc';

const fixture = await readFile(new URL('./doc.md', import.meta.url), 'utf8');
beforeAll(async () => {
    await initialize(new Uint8Array(await readFile(new URL('../../../node_modules/docstream/wasm/docstream_wasm_bg.wasm', import.meta.url))));
});

/** One of each kind the AI is told it may draw. */
const KIND_SAMPLES: Record<string, string> = {
    flowchart: 'flowchart LR\nA[问] --> B[答]', sequenceDiagram: 'sequenceDiagram\n我->>AI: 问\nAI-->>我: 答', stateDiagram: 'stateDiagram-v2\n[*] --> 待办\n待办 --> 完成',
    mindmap: 'mindmap\n  复习\n    高数\n    计组', gantt: 'gantt\ndateFormat HH:mm\n上课 :08:00, 95m\n自习 :10:00, 60m', timeline: 'timeline\n大一 : 入学\n大二 : 实习', pie: 'pie\n"上课" : 22\n"自习" : 15',
};

describe('documents drawn from the released kernel', () => {
    it('draws every kind of diagram the AI is told it may draw', () => {
        for (const kind of DIAGRAMS) expect(diagram(KIND_SAMPLES[kind]!), kind).toMatch(/^<svg/);
    });
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
        const html = renderToStaticMarkup(<DocText text={'```mermaid\nclassDiagram\n  class Animal\n```\n\n<img src=x onerror="alert(1)">'} />);
        expect(html).toContain('classDiagram');
        expect(html).not.toContain('<figure');
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;img');
    });
});
