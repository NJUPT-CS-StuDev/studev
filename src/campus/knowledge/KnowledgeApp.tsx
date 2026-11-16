// The knowledge: a course's outline as a tree to stand in, one topic or one source document read in the middle, and
// beside it what the topic builds on, what builds on it and every question that tested it. A question opens the
// document where it is and leads back. Everything shown is a link someone can send (?course, ?topic, ?material#题).
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Doc, docReady, DocPlaceProvider, DocStream, DocText, type DocPlace } from '@/world/doc';
import { knowledgeFile, knowledgePlace, loadCurriculum, loadKnowledge, loadKnowledgeText, materialParts, tested, toneOf, KIND_TONE, type CurriculumCourse, type Knowledge, type KnowledgeCourse, type KnowledgeMaterial, type KnowledgeTopic } from '@/world/knowledge';
import { reloadIfGone } from '@/world/stale';
import { useUrl, useWide } from '@/world/useUrl';
import { Back, Bars, Chevron, Sheet } from '@/world/ui';
import '../campus.css';

/** The subject's colour as the variables the page's styles read. */
const tone = (id: string) => {
    const n = toneOf(id);
    return { '--k-bg': `var(--course-tone-${n}-bg)`, '--k-border': `var(--course-tone-${n}-border)`, '--k-fg': `var(--course-tone-${n}-fg)` } as CSSProperties;
};

type Open = { course?: string; topic?: string; material?: string; anchor?: string | null };

export default function KnowledgeApp() {
    const { params, set } = useUrl();
    const wide = useWide();
    const [knowledge, setKnowledge] = useState<Knowledge | null>(null);
    const [curriculum, setCurriculum] = useState<CurriculumCourse[]>([]);
    const [failed, setFailed] = useState('');
    const [ready, setReady] = useState(false);
    const [outline, setOutline] = useState(false);
    useEffect(() => {
        loadKnowledge().then(setKnowledge).catch(() => { reloadIfGone(); setFailed('知识还没能加载，请检查网络后重试。'); });
        void loadCurriculum().then(setCurriculum);
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
    if (!course) return <Home knowledge={knowledge} curriculum={curriculum} onOpen={id => open({ course: id })} />;

    const tree = <Outline course={course} knowledge={knowledge} topic={topic} material={material} onOpen={open} />;
    return <DocPlaceProvider value={place}>
        <div className="sd page knowledge" style={tone(course.id)}>
            <div className="kn">
                {wide ? <aside className="kn-tree">{tree}</aside> : null}
                <main className="kn-main">
                    <div className="kn-bar">
                        <button className="back" onClick={() => open({})}><Back />知识</button>
                        {!wide ? <button className="ib" onClick={() => setOutline(true)}><Bars />{course.name}</button> : null}
                    </div>
                    {topic ? <>
                        <TopicView topic={topic} />
                        <TopicQuestions topic={topic} knowledge={knowledge} course={course} onOpen={open} />
                    </>
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

const safeMermaidLabel = (text: string) => text.replace(/["\[\]{}]/g, '').replace(/[（(][^）)]*[）)]/g, '').trim() || text.replace(/["\[\]{}]/g, '');

const TERM_TITLES = ['', '大一上', '大一下', '大二上', '大二下', '大三上', '大三下', '大四上', '大四下'];
const GRADE_OPTIONS: [string, number | null][] = [['全部', null], ['大一', 1], ['大二', 2], ['大三', 3], ['大四', 4]];
const primaryCodeLabel = (codes: string[]) => codes.length > 1 ? `${codes[0]} +${codes.length - 1}` : codes[0] || '培养方案课程';

/** Every course in the unified training-plan model: term-grouped course cards (like RoomsBrowse) + curriculum dependency graph. */
function Home({ knowledge, curriculum, onOpen }: { knowledge: Knowledge; curriculum: CurriculumCourse[]; onOpen: (code: string) => void }) {
    const [query, setQuery] = useState('');
    const [view, setView] = useState<'list' | 'graph'>('list');
    const [category, setCategory] = useState('全部');
    const [nature, setNature] = useState('全部');
    const [grade, setGrade] = useState('全部');
    const [major, setMajor] = useState('全部专业');

    const byCode = useMemo(() => {
        const map = new Map<string, CurriculumCourse>();
        for (const item of curriculum) map.set(item.code, item);
        return map;
    }, [curriculum]);

    const compiledByCode = useMemo(() => {
        const map = new Map<string, KnowledgeCourse>();
        for (const c of knowledge.courses) {
            for (const code of [...c.codes, ...c.former]) map.set(code, c);
        }
        return map;
    }, [knowledge.courses]);

    const courseMeta = useMemo(() => {
        const meta = new Map<string, { categories: string[]; natures: string[]; majors: string[]; credits: number[]; terms: number[] }>();
        for (const c of knowledge.courses) {
            const matched = [...new Set([...c.codes, ...c.former].map(code => byCode.get(code)).filter((x): x is CurriculumCourse => Boolean(x)))];
            const categories = [...new Set(matched.flatMap(m => m.categories.length ? m.categories : [m.category]).filter(Boolean))];
            const natures = [...new Set(matched.flatMap(m => m.natures.length ? m.natures : [m.nature]).filter(Boolean))];
            const majors = [...new Set(matched.flatMap(m => m.majors).filter(Boolean))];
            const credits = [...new Set(matched.map(m => m.credits).filter(n => n > 0))].sort((a, b) => a - b);
            const terms = [...new Set(matched.flatMap(m => m.terms))].sort((a, b) => a - b);
            meta.set(c.id, { categories, natures, majors, credits, terms });
        }
        return meta;
    }, [knowledge.courses, byCode]);

    const categories = useMemo(() => {
        const all = new Set(['专业基础课', '专业课', '通识教育课']);
        for (const m of courseMeta.values()) for (const c of m.categories) all.add(c);
        return ['全部', ...['专业基础课', '专业课', '通识教育课'].filter(c => all.has(c))];
    }, [courseMeta]);

    const majors = useMemo(() => {
        const preferred = ['计算机科学与技术', '软件工程', '信息安全', '计算机科学与技术(创新班)'];
        const found = new Set<string>();
        for (const item of curriculum) for (const m of item.majors) found.add(m);
        return ['全部专业', ...preferred.filter(m => found.has(m)), ...[...found].filter(m => !preferred.includes(m))];
    }, [curriculum]);

    const q = query.trim().toLowerCase();
    const targetGrade = GRADE_OPTIONS.find(([label]) => label === grade)?.[1] ?? null;
    const courses = useMemo(() => {
        return knowledge.courses.filter(course => {
            const meta = courseMeta.get(course.id);
            if (category !== '全部' && !meta?.categories.includes(category)) return false;
            if (nature !== '全部' && !meta?.natures.includes(nature)) return false;
            if (major !== '全部专业' && !meta?.majors.includes(major)) return false;
            if (targetGrade !== null && !meta?.terms.some(t => Math.ceil(t / 2) === targetGrade)) return false;
            if (!q) return true;
            return course.name.toLowerCase().includes(q)
                || course.codes.some(c => c.toLowerCase().includes(q))
                || course.chapters.some(ch => ch.title.toLowerCase().includes(q));
        });
    }, [knowledge.courses, courseMeta, category, nature, major, targetGrade, q]);

    const groupedByTerm = useMemo(() => {
        const groups = new Map<number, KnowledgeCourse[]>();
        for (const course of courses) {
            const terms = courseMeta.get(course.id)?.terms ?? [];
            const primary = targetGrade !== null
                ? (terms.find(t => Math.ceil(t / 2) === targetGrade) ?? 99)
                : (terms.find(t => t >= 1 && t <= 8) ?? 99);
            const list = groups.get(primary) ?? [];
            list.push(course);
            groups.set(primary, list);
        }
        return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([term, list]) => ({
            term,
            title: term >= 1 && term <= 8 ? TERM_TITLES[term]! : '其他与通识课程',
            sub: term >= 1 && term <= 8 ? `第 ${term} 学期 · ${list.length} 门` : `${list.length} 门`,
            courses: list,
        }));
    }, [courses, courseMeta, targetGrade]);

    const graphNodes = useMemo(() => {
        if (view !== 'graph') return { doc: '', linked: [] as KnowledgeCourse[] };
        const scoped = curriculum.filter(item => {
            if (major !== '全部专业' && !item.majors.includes(major)) return false;
            if (category !== '全部' && !(item.categories.includes(category) || item.category === category)) return false;
            if (nature !== '全部' && !(item.natures.includes(nature) || item.nature === nature)) return false;
            return true;
        });
        const scopedCodes = new Set(scoped.map(item => item.code));
        const connected = new Set<string>();
        for (const item of scoped) {
            const validReqs = item.requires.filter(req => scopedCodes.has(req));
            if (validReqs.length) {
                connected.add(item.code);
                for (const req of validReqs) connected.add(req);
            }
        }
        const nodes = scoped.filter(item => connected.has(item.code) && (!q || item.name.toLowerCase().includes(q) || item.code.toLowerCase().includes(q) || item.requires.some(r => r.toLowerCase().includes(q))));
        const nodeSet = new Set(nodes.map(n => n.code));
        // Add direct prerequisite targets even if filtered by query so edges never dangle
        for (const item of [...nodes]) {
            for (const req of item.requires) {
                if (scopedCodes.has(req) && !nodeSet.has(req)) {
                    const found = byCode.get(req);
                    if (found) { nodes.push(found); nodeSet.add(req); }
                }
            }
        }

        if (nodes.length) {
            const idOf = new Map(nodes.map((n, i) => [n.code, `P${i}`]));
            const lines = ['```mermaid', 'flowchart LR'];
            for (const n of nodes) {
                const label = safeMermaidLabel(n.name);
                lines.push(`  ${idOf.get(n.code)}["${label}"]`);
            }
            for (const n of nodes) {
                for (const req of n.requires) {
                    if (idOf.has(req)) lines.push(`  ${idOf.get(req)} --> ${idOf.get(n.code)}`);
                }
            }
            lines.push('```');
            const linked: KnowledgeCourse[] = [];
            const seenCourses = new Set<string>();
            for (const n of nodes) {
                const kc = compiledByCode.get(n.code);
                if (kc && !seenCourses.has(kc.id)) {
                    seenCourses.add(kc.id);
                    linked.push(kc);
                }
            }
            return { doc: lines.join('\n'), linked };
        }

        // Fallback when curriculum has no matching prerequisite edges: show compiled knowledge courses
        const byId = new Map(knowledge.courses.map((c, i) => [c.id, `C${i}`]));
        const lines = ['```mermaid', 'flowchart LR'];
        for (const c of courses) lines.push(`  ${byId.get(c.id)}["${safeMermaidLabel(c.name)}"]`);
        lines.push('```');
        return { doc: lines.join('\n'), linked: courses };
    }, [view, curriculum, byCode, compiledByCode, knowledge.courses, courses, major, category, nature, q]);

    return <div className="sd page knowledge"><div className="wrap">
        <div className="ph"><div><h1>知识</h1><p>按培养方案与学期组织的知识体系，每门课连着它的先修依赖、课件与历年考题。</p></div></div>
        <div className="kn-tools">
            <input className="kn-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="筛选课程名称、课程代码或章节…" aria-label="筛选课程" />
            <div className="kn-tabs" role="tablist" aria-label="视图切换">
                <button role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>按学期看</button>
                <button role="tab" aria-selected={view === 'graph'} className={view === 'graph' ? 'on' : ''} onClick={() => setView('graph')}>培养方案依赖图</button>
            </div>
        </div>
        <div className="kn-filters">
            <div className="kn-chips" role="group" aria-label="年级">
                {GRADE_OPTIONS.map(([label]) => <button key={label} className={grade === label ? 'on' : ''} onClick={() => setGrade(label)}>{label === '全部' ? '全部年级' : label}</button>)}
            </div>
            <div className="kn-chips" role="group" aria-label="课程类别">
                {categories.map(item => <button key={item} className={category === item ? 'on' : ''} onClick={() => setCategory(item)}>{item}</button>)}
            </div>
            <div className="kn-chips" role="group" aria-label="课程性质">
                {['全部', '必修', '限选'].map(item => <button key={item} className={nature === item ? 'on' : ''} onClick={() => setNature(item)}>{item === '全部' ? '全部性质' : item}</button>)}
            </div>
            <select className="kn-select" value={major} onChange={e => setMajor(e.target.value)} aria-label="专业筛选">
                {majors.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
        </div>
        {view === 'graph'
            ? <div className="kn-graph">
                <DocText text={graphNodes.doc} />
                {graphNodes.linked.length ? <div className="kn-graph-links">
                    <small>图中有已编译资料的课程（点击进入）</small>
                    <div>{graphNodes.linked.map(c => <button key={c.id} style={tone(c.id)} onClick={() => onOpen(c.id)}>{c.name}</button>)}</div>
                </div> : null}
            </div>
            : groupedByTerm.length === 0
                ? <p className="empty">没有符合当前筛选条件的课程</p>
                : <div className="kn-term-groups">{groupedByTerm.map(section => (
                    <section key={section.term} className="kn-term-group">
                        <header className="kn-term-head"><h2>{section.title}</h2><small>{section.sub}</small></header>
                        <div className="kn-courses">{section.courses.map(course => {
                            const topics = new Set(course.chapters.flatMap(chapter => chapter.topics)).size;
                            const materials = knowledge.materials.filter(item => item.course === course.id).length;
                            const meta = courseMeta.get(course.id);
                            const badges = [
                                primaryCodeLabel(course.codes),
                                meta?.categories[0],
                                meta?.natures.join('/'),
                                meta?.credits.length ? `${meta.credits[0]} 学分` : null,
                            ].filter(Boolean);
                            return <button key={course.id} className="kn-course" style={tone(course.id)} onClick={() => onOpen(course.id)}>
                                <b>{course.name}</b>
                                <small>{badges.join(' · ')}</small>
                                <span>{course.chapters.length} 章 · {topics} 个知识点 · {materials} 份资料</span>
                                <Chevron />
                            </button>;
                        })}</div>
                    </section>
                ))}</div>}
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
        <p className="kn-count"><span className="kn-kind" style={{ '--kind': `var(--${KIND_TONE[material.kind] ?? 'muted'})` } as CSSProperties}>{material.kind}</span>{[material.term].filter(Boolean).map(term => ` · ${term}`)}{material.questions ? ` · ${material.questions} 题` : ''}{/^https?:\/\//.test(material.source) ? <> · <a href={material.source} target="_blank" rel="noreferrer">原件</a></> : null}
            {all && material.kind !== '课件' ? <button className="kn-toggle" onClick={() => setShown(shown.size ? new Set() : new Set(parts!.flatMap(part => part.kind === 'question' ? [part.anchor] : [])))}>{shown.size ? '收起全部解答' : '展开全部解答'}</button> : null}</p>
        {parts === null ? <p className="muted">正在打开…</p> : parts.map((part, at) => {
            if (part.kind === 'text') return <Doc key={at} blocks={part.blocks} />;
            if (part.kind === 'group') return <h2 key={at} className="kn-group">{part.title}{part.questions ? <small>{part.questions} 题</small> : null}</h2>;
            const open = shown.has(part.anchor);
            return <section key={at} id={part.anchor} className={`kn-q ${material.kind === '课件' ? 'slide' : ''} ${anchor === part.anchor ? 'here' : ''}`}>
                <header>
                    <b>{part.title}</b>
                    <span className="kn-tags">{part.topics.map(topic => <button key={topic.href} onClick={() => onTopic(topic.href)}>{topic.title}</button>)}</span>
                </header>
                <Doc blocks={part.asks} />
                {part.answer.length ? <>
                    <button className="kn-reveal" aria-expanded={open} onClick={() => setShown(current => { const next = new Set(current); if (open) next.delete(part.anchor); else next.add(part.anchor); return next; })}>{part.answer[0]?.label === '原文' ? (open ? '收起原文' : '看原文') : (open ? '收起解答' : '看解答')}</button>
                    {open ? <div className="kn-answer">{part.answer.map((piece, i) => <div key={i} className={`kn-piece ${piece.label === '订正' ? 'fix' : piece.label === '补充' ? 'note' : ''}`}><Doc blocks={piece.blocks} /></div>)}</div> : null}
                </> : null}
            </section>;
        })}
    </article>;
}

/** Right sidebar for a topic: knowledge-graph relations (prerequisite and downstream concepts + mini docstream DAG). */
function Relations({ topic, knowledge, course, onOpen }: { topic: KnowledgeTopic; knowledge: Knowledge; course: KnowledgeCourse; onOpen: (to: Open) => void }) {
    const title = (id: string) => knowledge.topics.find(item => item.id === id)?.title ?? id;
    const link = (id: string) => <button key={id} onClick={() => onOpen({ topic: id, course: course.id })}>{title(id)}</button>;
    const miniGraph = useMemo(() => {
        if (!topic.requires.length && !topic.leads_to.length) return '';
        const lines = ['```mermaid', 'flowchart TB', `  CUR["${safeMermaidLabel(topic.title)}"]`];
        topic.requires.slice(0, 5).forEach((id, i) => {
            lines.push(`  R${i}["${safeMermaidLabel(title(id))}"]`);
            lines.push(`  R${i} --> CUR`);
        });
        topic.leads_to.slice(0, 5).forEach((id, i) => {
            lines.push(`  L${i}["${safeMermaidLabel(title(id))}"]`);
            lines.push(`  CUR --> L${i}`);
        });
        lines.push('```');
        return lines.join('\n');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [topic.id, topic.requires, topic.leads_to, knowledge.topics]);
    return <div className="kn-rel">
        {miniGraph ? <section><h3>知识图谱关系</h3><div className="kn-mini-graph"><DocText text={miniGraph} /></div></section> : null}
        {topic.requires.length ? <section><h3>先要懂</h3>{topic.requires.map(link)}</section> : null}
        {topic.leads_to.length ? <section><h3>用到它的</h3>{topic.leads_to.map(link)}</section> : null}
        {!topic.requires.length && !topic.leads_to.length ? <section><h3>知识图谱关系</h3><p className="muted">本知识点暂无前后置关联</p></section> : null}
    </div>;
}

/** Below a topic's core explanation: every past-exam / exercise question that tested it, grouped by material. */
function TopicQuestions({ topic, knowledge, course, onOpen }: { topic: KnowledgeTopic; knowledge: Knowledge; course: KnowledgeCourse; onOpen: (to: Open) => void }) {
    const byMaterial = new Map<string, typeof topic.tested_by>();
    for (const ref of topic.tested_by) byMaterial.set(ref.material, [...(byMaterial.get(ref.material) ?? []), ref]);
    return <section className="kn-most kn-tested">
        <h2>考过的真题链接</h2>
        {byMaterial.size ? [...byMaterial].map(([path, refs]) => {
            const material = knowledge.materials.find(item => item.path === path);
            return <div key={path} className="kn-refs">
                <small>{material?.title ?? path}</small>
                <div className="kn-ref-list">
                    {refs.map((ref, i) => <button key={`${ref.anchor}-${i}`} onClick={() => onOpen({ material: path, anchor: ref.anchor, course: course.id })}>{ref.heading}</button>)}
                </div>
            </div>;
        }) : <p className="muted">收录的资料里还没有直接考到它的真题。</p>}
    </section>;
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
