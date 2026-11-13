// A document as docstream reads it, drawn as the page's own elements: one reading of Markdown for the web, the app
// and the blog alike (the kernel is Rust; see NJUPT-CS-StuDev/docstream). Each top-level block is drawn once and
// kept while its key is the same, so text streaming in redraws only the block being written. Formulas are typeset and
// Mermaid diagrams laid out by the same kernel, as SVG in the colour of the text around them.
import { memo, useMemo, useState } from 'react';
import { diagram, initialize, math, read, Stream, type Block, type Inline, type Keyed, type Update } from 'docstream';

let ready: Promise<void> | undefined;
/** The kernel, loaded once. */
export const docReady = () => ready ??= initialize();
export { read as readDoc, Stream as DocStream, type Keyed, type Update };

/** What the kernel drew, kept by what it was drawn from: a streamed answer draws the same formula many times over. */
const drawn = new Map<string, string | undefined>();
function remember(key: string, draw: () => string | undefined) {
    if (drawn.has(key)) return drawn.get(key);
    if (drawn.size > 400) drawn.delete(drawn.keys().next().value!);
    const svg = draw();
    drawn.set(key, svg);
    return svg;
}

// The kernel's SVG: its words are escaped there, and nothing else in it comes from the text.
function Tex({ tex, display }: { tex: string; display: boolean }) {
    const svg = remember(`${display ? 'D' : 'T'}${tex}`, () => math(tex, display))!;
    return <span className={display ? 'doc-math' : 'doc-tex'} dangerouslySetInnerHTML={{ __html: svg }} />;
}
function Diagram({ text }: { text: string }) {
    const svg = remember(`M${text}`, () => diagram(text));
    return svg ? <figure className="doc-diagram" dangerouslySetInnerHTML={{ __html: svg }} /> : <CodeView language="mermaid" text={text} />;
}

const ALERTS = { note: '说明', tip: '提示', important: '重要', warning: '注意', caution: '小心' } as const;

function Inlines({ inlines }: { inlines: Inline[] }) {
    return <>{inlines.map((inline, at) => <InlineView key={at} inline={inline} />)}</>;
}
function InlineView({ inline }: { inline: Inline }) {
    switch (inline.type) {
        case 'text': return <>{inline.text}</>;
        case 'strong': return <strong><Inlines inlines={inline.children} /></strong>;
        case 'emphasis': return <em><Inlines inlines={inline.children} /></em>;
        case 'strike': return <s><Inlines inlines={inline.children} /></s>;
        case 'highlight': return <mark><Inlines inlines={inline.children} /></mark>;
        case 'superscript': return <sup><Inlines inlines={inline.children} /></sup>;
        case 'subscript': return <sub><Inlines inlines={inline.children} /></sub>;
        case 'code': return <code>{inline.text}</code>;
        case 'math': return <Tex tex={inline.tex} display={inline.display} />;
        case 'link': {
            const inside = inline.href.startsWith('/');
            return <a href={inline.href} {...(inside ? {} : { target: '_blank', rel: 'noreferrer' })}><Inlines inlines={inline.children} /></a>;
        }
        case 'image': return <img src={inline.src} alt={inline.alt} loading="lazy" />;
        case 'break': return <br />;
    }
}

function CodeView({ language, text }: { language: string; text: string }) {
    const [copied, setCopied] = useState(false);
    return <div className="doc-code">
        <div className="doc-code-h"><span>{language || '代码'}</span><button onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? '已复制' : '复制'}</button></div>
        <pre><code>{text}</code></pre>
    </div>;
}

function BlockView({ block }: { block: Block }) {
    switch (block.type) {
        case 'paragraph': return <p><Inlines inlines={block.inlines} /></p>;
        case 'heading': { const Tag = (`h${Math.min(6, block.level + 1)}`) as 'h2'; return <Tag><Inlines inlines={block.inlines} /></Tag>; }
        case 'quote': return <blockquote>{block.blocks.map((inner, at) => <BlockView key={at} block={inner} />)}</blockquote>;
        case 'alert': return <aside className={`doc-alert ${block.kind}`}><b>{ALERTS[block.kind]}</b>{block.blocks.map((inner, at) => <BlockView key={at} block={inner} />)}</aside>;
        case 'list': {
            const items = block.items.map((item, at) => <li key={at} className={item.checked !== undefined ? 'task' : undefined}>
                {item.checked !== undefined && <span className={`doc-check ${item.checked ? 'on' : ''}`} aria-label={item.checked ? '已完成' : '未完成'} />}
                {item.blocks.map((inner, i) => <BlockView key={i} block={inner} />)}</li>);
            return block.ordered ? <ol start={block.start}>{items}</ol> : <ul>{items}</ul>;
        }
        case 'code': return block.language === 'mermaid' ? <Diagram text={block.text} /> : <CodeView language={block.language} text={block.text} />;
        case 'math': return <Tex tex={block.tex} display />;
        case 'table': return <div className="doc-table"><table>
            <thead><tr>{block.head.map((cell, at) => <th key={at} style={{ textAlign: block.align[at] === 'none' ? undefined : block.align[at] }}><Inlines inlines={cell} /></th>)}</tr></thead>
            <tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, at) => <td key={at} style={{ textAlign: block.align[at] === 'none' ? undefined : block.align[at] }}><Inlines inlines={cell} /></td>)}</tr>)}</tbody>
        </table></div>;
        case 'rule': return <hr />;
        case 'html': return <pre className="doc-html">{block.text}</pre>;
    }
}

/** One top-level block, drawn again only when its key changes. */
const Top = memo(function Top({ block }: { block: Keyed }) { return <BlockView block={block.block} />; }, (before, after) => before.block.key === after.block.key);

/** A document: the blocks docstream gives, in the page's own elements. */
export function Doc({ blocks, live = false }: { blocks: Keyed[]; live?: boolean }) {
    return <div className={`doc ${live ? 'live' : ''}`}>{blocks.map((block, at) => <Top key={`${at}:${block.key}`} block={block} />)}</div>;
}
/** A whole text, read at once and drawn. */
export function DocText({ text }: { text: string }) {
    const blocks = useMemo(() => { const stream = new Stream(); stream.push(text); const { blocks } = stream.finish(); stream.free(); return blocks; }, [text]);
    return <Doc blocks={blocks} />;
}
