// A document as docstream reads it, drawn as the page's own elements: one reading of Markdown for the web, the app
// and the blog alike (the kernel is Rust; see NJUPT-CS-StuDev/docstream). Each top-level block is drawn once and
// kept while its key is the same, so text streaming in redraws only the block being written. Formulas are typeset and
// Mermaid diagrams laid out by the same kernel, as SVG in the colour of the text around them.
import { memo, useMemo, useState, type CSSProperties } from 'react';
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
/** A diagram fits the column, but not below 72% of its size, where its words would be too small: wider, it scrolls. */
function Diagram({ text }: { text: string }) {
    const svg = remember(`M${text}`, () => diagram(text));
    if (!svg) return <CodeView language="mermaid" text={text} />;
    const width = Number(/width="([\d.]+)"/.exec(svg)?.[1] ?? 0);
    return <figure className="doc-diagram" style={{ '--w': width } as CSSProperties} dangerouslySetInnerHTML={{ __html: svg }} />;
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

function BlockView({ block, writing = false }: { block: Block; writing?: boolean }) {
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
        case 'code': return block.language === 'mermaid' && !writing ? <Diagram text={block.text} /> : <CodeView language={block.language} text={block.text} />;
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
const Top = memo(function Top({ block, writing }: { block: Keyed; writing: boolean }) { return <BlockView block={block.block} writing={writing} />; },
    (before, after) => before.block.key === after.block.key && before.writing === after.writing);

/** A document: the blocks docstream gives, in the page's own elements. */
export function Doc({ blocks, live = false }: { blocks: Keyed[]; live?: boolean }) {
    // The block still being written shows a diagram as its source until it is whole: drawn at every prefix, its
    // boxes would jump about as each line arrived.
    return <div className={`doc ${live ? 'live' : ''}`}>{blocks.map((block, at) => <Top key={`${at}:${block.key}`} block={block} writing={live && at === blocks.length - 1} />)}</div>;
}
/** A whole text, read at once and drawn. */
export function DocText({ text }: { text: string }) {
    const blocks = useMemo(() => { const stream = new Stream(); stream.push(text); const { blocks } = stream.finish(); stream.free(); return blocks; }, [text]);
    return <Doc blocks={blocks} />;
}
