// The knowledge: a course's outline as a tree to stand in, one topic or one source document read in the middle, and
// beside it what the topic builds on, what builds on it and every question that tested it. A question opens the
// document where it is and leads back. Everything shown is a link someone can send (?course, ?topic, ?material#题).
import { useEffect, useMemo, useState } from 'react';
import { Doc, docReady, DocPlaceProvider, DocStream, DocText, type DocPlace } from '@/world/doc';
import { knowledgeFile, knowledgePlace, loadKnowledge, loadKnowledgeText, materialParts, tested, type Knowledge, type KnowledgeCourse, type KnowledgeMaterial, type KnowledgeTopic } from '@/world/knowledge';
import { reloadIfGone } from '@/world/stale';
import { useUrl, useWide } from '@/world/useUrl';
import { Back, Bars, Chevron, Sheet } from '@/world/ui';
import '../campus.css';

type Open = { course?: string; topic?: string; material?: string; anchor?: string | null };

export default function KnowledgeApp() {
    const { params, set } = useUrl();
    const wide = useWide();
    const [knowledge, setKnowledge] = useState<Knowledge | null>(null);
    const [failed, setFailed] = useState('');
    const [ready, setReady] = useState(false);
    const [outline, setOutline] = useState(false);
    useEffect(() => {
        loadKnowledge().then(setKnowledge).catch(() => { reloadIfGone(); setFailed('知识还没能加载，请检查网络后重试。'); });
        void docReady().then(() => setReady(true));
    }, []);

    const topicId = params.get('topic');
    const materialPath = params.get('material');
    const topic = knowledge?.topics.find(item => item.id === topicId) ?? null;
    const material = knowledge?.materials.find(item => item.path === materialPath) ?? null;
    // The course in view: as asked, or the one that teaches the topic, or the one the document belongs to.
    const course = knowledge?.courses.find(item => item.id === (params.get('course') ?? topic?.taught_by[0] ?? material?.course)) ?? null;

    const open = (to: Open) => {
        set({ course: to.course ?? null, topic: to.topic ?? null, material: to.material ?? null }, { push: true });
        history.replaceState(null, '', `${location.pathname}${location.search}${to.anchor ? `#${encodeURIComponent(to.anchor)}` : ''}`);
        setOutline(false);
        if (to.anchor) requestAnimationFrame(() => document.getElementById(to.anchor!)?.scrollIntoView({ block: 'start' }));
        else scrollTo({ top: 0 });
    };
    const place: DocPlace = useMemo(() => ({
        image: knowledgeFile,
        open: href => {
            const to = knowledgePlace(href);
            if (!to) return null;
            if ('topic' in to) return () => open({ topic: to.topic, course: course?.id });
            if ('course' in to) return () => open({ course: to.course });
            return () => open({ material: to.material, anchor: to.anchor, course: course?.id });
        },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [course?.id]);

    if (failed) return <div className="sd page"><div className="wrap narrow"><p className="muted">{failed}</p></div></div>;
    if (!knowledge || !ready) return <div className="sd page"><div className="wrap"><p className="muted">正在打开知识…</p></div></div>;
    if (!course) return <Home knowledge={knowledge} onOpen={id => open({ course: id })} />;

    const tree = <Outline course={course} knowledge={knowledge} topic={topic} material={material} onOpen={open} />;
    return <DocPlaceProvider value={place}>
        <div className="sd page knowledge">
            <div className="kn">
                {wide ? <aside className="kn-tree">{tree}</aside> : null}
                <main className="kn-main">
                    <div className="kn-bar">
                        <button className="back" onClick={() => open({})}><Back />知识</button>
                        {!wide ? <button className="ib" onClick={() => setOutline(true)}><Bars />{course.name}</button> : null}
                    </div>
                    {topic ? <TopicView topic={topic} />
                        : material ? <MaterialView material={material} anchor={decodeURIComponent(location.hash.slice(1)) || null} onTopic={href => place.open(href)?.()} />
                            : <CourseView course={course} knowledge={knowledge} onOpen={open} />}
                    {!wide && topic ? <Relations topic={topic} knowledge={knowledge} course={course} onOpen={open} /> : null}
                    {!wide && material ? <Tested material={material} knowledge={knowledge} onOpen={open} course={course} /> : null}
                </main>
                {wide ? <aside className="kn-side">
                    {topic ? <Relations topic={topic} knowledge={knowledge} course={course} onOpen={open} />
                        : material ? <Tested material={material} knowledge={knowledge} onOpen={open} course={course} />
                            : <Materials course={course} knowledge={knowledge} onOpen={open} />}
                </aside> : null}
            </div>
            {outline ? <Sheet title={course.name} onClose={() => setOutline(false)}>{tree}</Sheet> : null}
        </div>
    </DocPlaceProvider>;
}

/** Every course that has knowledge, with how much there is. */
function Home({ knowledge, onOpen }: { knowledge: Knowledge; onOpen: (code: string) => void }) {
    return <div className="sd page knowledge"><div className="wrap">
        <div className="ph"><div><h1>知识</h1><p>按课程组织的知识点，每个知识点连着它依赖的、建立在它之上的，以及考过它的题。</p></div></div>
        <div className="kn-courses">{knowledge.courses.map(course => {
            const topics = new Set(course.chapters.flatMap(chapter => chapter.topics)).size;
            const materials = knowledge.materials.filter(item => item.course === course.id).length;
            return <button key={course.id} className="kn-course" onClick={() => onOpen(course.id)}>
                <b>{course.name}</b>
                <small>{course.id}{course.former.length ? ` · 曾用 ${course.former.join('、')}` : ''}</small>
                <span>{course.chapters.length} 章 · {topics} 个知识点 · {materials} 份资料</span>
                <Chevron />
            </button>;
        })}</div>
    </div></div>;
}

function Outline({ course, knowledge, topic, material, onOpen }: { course: KnowledgeCourse; knowledge: Knowledge; topic: KnowledgeTopic | null; material: KnowledgeMaterial | null; onOpen: (to: Open) => void }) {
    const title = (id: string) => knowledge.topics.find(item => item.id === id)?.title ?? id;
    return <nav className="kn-outline" aria-label="课程目录">
        <button className={`kn-course-head ${!topic && !material ? 'on' : ''}`} onClick={() => onOpen({ course: course.id })}>{course.name}</button>
        {course.chapters.map(chapter => <section key={chapter.title}>
            <h3>{chapter.title}</h3>
            {chapter.topics.map(id => <button key={id} className={topic?.id === id ? 'on' : ''} onClick={() => onOpen({ topic: id, course: course.id })}>{title(id)}</button>)}
        </section>)}
        <section><h3>资料</h3>{knowledge.materials.filter(item => item.course === course.id).map(item =>
            <button key={item.path} className={material?.path === item.path ? 'on' : ''} onClick={() => onOpen({ material: item.path, course: course.id })}>{item.title}</button>)}</section>
    </nav>;
}

function useText(path: string) {
    const [text, setText] = useState<string | null>(null);
    useEffect(() => { setText(null); void loadKnowledgeText(path).then(setText).catch(() => setText('这篇内容没能加载，请稍后重试。')); }, [path]);
    return text;
}

function CourseView({ course, knowledge, onOpen }: { course: KnowledgeCourse; knowledge: Knowledge; onOpen: (to: Open) => void }) {
    const text = useText(course.path);
    const topics = course.chapters.flatMap(chapter => chapter.topics).map(id => knowledge.topics.find(item => item.id === id)!).filter(Boolean);
    const most = [...topics].sort((a, b) => b.tested_by.length - a.tested_by.length).filter(item => item.tested_by.length).slice(0, 6);
    return <article className="kn-doc">
        {text === null ? <p className="muted">正在打开…</p> : <DocText text={text} />}
        {most.length ? <section className="kn-most"><h2>考得最多的知识点</h2>{most.map(item => {
            const count = tested(item);
            return <button key={item.id} onClick={() => onOpen({ topic: item.id, course: course.id })}><b>{item.title}</b><small>{count.questions} 道题 · {count.materials} 份资料</small></button>;
        })}</section> : null}
    </article>;
}

function TopicView({ topic }: { topic: KnowledgeTopic }) {
    const text = useText(topic.path);
    const count = tested(topic);
    return <article className="kn-doc">
        {count.questions ? <p className="kn-count">考过 {count.questions} 次 · 出现在 {count.materials} 份资料里</p> : <p className="kn-count">收录的资料里还没有考到它</p>}
        {text === null ? <p className="muted">正在打开…</p> : <DocText text={text} />}
    </article>;
}

function MaterialView({ material, anchor, onTopic }: { material: KnowledgeMaterial; anchor: string | null; onTopic: (href: string) => void }) {
    const text = useText(material.path);
    const parts = useMemo(() => {
        if (text === null) return null;
        const stream = new DocStream(); stream.push(text); const { blocks } = stream.finish(); stream.free();
        return materialParts(blocks);
    }, [text]);
    const [shown, setShown] = useState<Set<string>>(new Set());
    useEffect(() => { setShown(new Set()); }, [material.path]);
    useEffect(() => { if (parts && anchor) requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: 'start' })); }, [parts, anchor]);
    const all = parts?.filter(part => part.kind === 'question' && part.answer.length).length ?? 0;
    return <article className="kn-doc">
        <h1 className="kn-title">{material.title}</h1>
        <p className="kn-count">{[material.kind, material.term].filter(Boolean).join(' · ')}{material.questions ? ` · ${material.questions} 题` : ''} · <a href={material.source} target="_blank" rel="noreferrer">原件</a>
            {all ? <button className="kn-toggle" onClick={() => setShown(shown.size ? new Set() : new Set(parts!.flatMap(part => part.kind === 'question' ? [part.anchor] : [])))}>{shown.size ? '收起全部解答' : '展开全部解答'}</button> : null}</p>
        {parts === null ? <p className="muted">正在打开…</p> : parts.map((part, at) => {
            if (part.kind === 'text') return <Doc key={at} blocks={part.blocks} />;
            if (part.kind === 'group') return <h2 key={at} className="kn-group">{part.title}{part.questions ? <small>{part.questions} 题</small> : null}</h2>;
            const open = shown.has(part.anchor);
            return <section key={at} id={part.anchor} className={`kn-q ${anchor === part.anchor ? 'here' : ''}`}>
                <header>
                    <b>{part.title}</b>
                    <span className="kn-tags">{part.topics.map(topic => <button key={topic.href} onClick={() => onTopic(topic.href)}>{topic.title}</button>)}</span>
                </header>
                <Doc blocks={part.asks} />
                {part.answer.length ? <>
                    <button className="kn-reveal" aria-expanded={open} onClick={() => setShown(current => { const next = new Set(current); if (open) next.delete(part.anchor); else next.add(part.anchor); return next; })}>{open ? '收起解答' : '看解答'}</button>
                    {open ? <div className="kn-answer">{part.answer.map((piece, i) => <div key={i} className={`kn-piece ${piece.label === '订正' ? 'fix' : piece.label === '补充' ? 'note' : ''}`}><Doc blocks={piece.blocks} /></div>)}</div> : null}
                </> : null}
            </section>;
        })}
    </article>;
}

/** Around one topic: what it builds on, what builds on it, and every question that tested it, by document. */
function Relations({ topic, knowledge, course, onOpen }: { topic: KnowledgeTopic; knowledge: Knowledge; course: KnowledgeCourse; onOpen: (to: Open) => void }) {
    const title = (id: string) => knowledge.topics.find(item => item.id === id)?.title ?? id;
    const byMaterial = new Map<string, typeof topic.tested_by>();
    for (const ref of topic.tested_by) byMaterial.set(ref.material, [...(byMaterial.get(ref.material) ?? []), ref]);
    const link = (id: string) => <button key={id} onClick={() => onOpen({ topic: id, course: course.id })}>{title(id)}</button>;
    return <div className="kn-rel">
        {topic.requires.length ? <section><h3>先要懂</h3>{topic.requires.map(link)}</section> : null}
        {topic.leads_to.length ? <section><h3>用到它的</h3>{topic.leads_to.map(link)}</section> : null}
        <section><h3>考过它的题</h3>{byMaterial.size ? [...byMaterial].map(([path, refs]) => {
            const material = knowledge.materials.find(item => item.path === path);
            return <div key={path} className="kn-refs"><small>{material?.title ?? path}</small>
                {refs.map(ref => <button key={ref.anchor} onClick={() => onOpen({ material: path, anchor: ref.anchor, course: course.id })}>{ref.heading}</button>)}</div>;
        }) : <p className="muted">还没有</p>}</section>
    </div>;
}

/** Beside a document: the topics its questions test, most tested first. */
function Tested({ material, knowledge, course, onOpen }: { material: KnowledgeMaterial; knowledge: Knowledge; course: KnowledgeCourse; onOpen: (to: Open) => void }) {
    const counts = knowledge.topics.map(topic => ({ topic, n: topic.tested_by.filter(ref => ref.material === material.path).length })).filter(row => row.n).sort((a, b) => b.n - a.n);
    return <div className="kn-rel"><section><h3>这份资料考到的知识点</h3>{counts.map(({ topic, n }) =>
        <button key={topic.id} onClick={() => onOpen({ topic: topic.id, course: course.id })}>{topic.title}<small>{n} 题</small></button>)}</section></div>;
}

function Materials({ course, knowledge, onOpen }: { course: KnowledgeCourse; knowledge: Knowledge; onOpen: (to: Open) => void }) {
    return <div className="kn-rel"><section><h3>资料</h3>{knowledge.materials.filter(item => item.course === course.id).map(item =>
        <button key={item.path} onClick={() => onOpen({ material: item.path, course: course.id })}>{item.title}<small>{item.questions ? `${item.questions} 题` : item.kind}</small></button>)}</section></div>;
}
