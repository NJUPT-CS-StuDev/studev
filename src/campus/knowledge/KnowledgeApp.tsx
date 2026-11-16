// The knowledge: a course's outline as a tree to stand in, one topic or one source document read in the middle, and
// beside it what the topic builds on, what builds on it and every question that tested it. A question opens the
// document where it is and leads back. Everything shown is a link someone can send (?course, ?topic, ?material#题).
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Doc, readDoc, docReady, DocPlaceProvider, DocStream, DocText, type DocPlace } from '@/world/doc';
import { containsAnchor, knowledgeFile, knowledgePlace, loadKnowledge, loadKnowledgeText, materialParts, referenced, toneOf, KIND_TONE, type Knowledge, type KnowledgeCourse, type KnowledgeMaterial, type KnowledgeTopic } from '@/world/knowledge';
import { referencePreviews } from './references';
import { catalogScope, courseRelations, type CatalogCourse, type CatalogCurriculum, type KnowledgeCatalog } from './catalog';
import { reloadIfGone } from '@/world/stale';
import { usePreferences } from '@/world/usePreferences';
import { loadClasses } from '@/world/data';
import type { TeachingClass } from '@/world/facts';
import { useUrl, useWide } from '@/world/useUrl';
import { Back, Chevron, Sheet, TextAction, CampusHeader } from '@/world/ui';
import '../campus.css';

/** The subject's colour as the variables the page's styles read. */
const tone = (id: string) => {
    const n = toneOf(id);
    return { '--k-bg': `var(--course-tone-${n}-bg)`, '--k-border': `var(--course-tone-${n}-border)`, '--k-fg': `var(--course-tone-${n}-fg)` } as CSSProperties;
};

type Open = { course?: string; topic?: string; material?: string; anchor?: string | null };

export default function KnowledgeApp({ catalog }: { catalog: KnowledgeCatalog }) {
    const { params, set } = useUrl();
    const wide = useWide();
    const [knowledge, setKnowledge] = useState<Knowledge | null>(null);
    const [failed, setFailed] = useState('');
    const [attempt, setAttempt] = useState(0);
    const [outline, setOutline] = useState(false);
    const [anchor, setAnchor] = useState<string | null>(null);
    useEffect(() => {
        const sync = () => setAnchor(decodeURIComponent(location.hash.slice(1)) || null);
        sync();
        addEventListener('popstate', sync);
        addEventListener('hashchange', sync);
        return () => { removeEventListener('popstate', sync); removeEventListener('hashchange', sync); };
    }, []);
    const topicId = params.get('topic');
    const materialPath = params.get('material');
    const courseId = params.get('course');
    const requested = Boolean(courseId || topicId || materialPath);
    const document = useDocument(requested);
    useEffect(() => {
        if (!requested || knowledge) return;
        let current = true;
        setFailed('');
        void loadKnowledge().then(index => { if (current) setKnowledge(index); })
            .catch(() => { if (current) { void reloadIfGone(); setFailed('知识暂时无法加载。'); } });
        return () => { current = false; };
    }, [requested, knowledge, attempt]);
    const topic = knowledge?.topics.find(item => item.id === topicId) ?? null;
    const material = knowledge?.materials.find(item => item.path === materialPath) ?? null;
    // The course in view: as asked, or the one that teaches the topic, or the one the document belongs to.
    const course = knowledge?.courses.find(item => item.id === (courseId ?? topic?.taught_by[0] ?? material?.course)) ?? null;

    const open = (to: Open) => {
        set({ course: to.course ?? null, topic: to.topic ?? null, material: to.material ?? null }, { push: true });
        history.replaceState(null, '', `${location.pathname}${location.search}${to.anchor ? `#${encodeURIComponent(to.anchor)}` : ''}`);
        setAnchor(to.anchor || null);
        setOutline(false);
        if (!to.anchor) scrollTo({ top: 0 });
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

    if (!requested) return <Home catalog={catalog} onOpen={id => open({ course: id })} />;
    if (!knowledge || !course || document.status !== 'ready') {
        const name = catalog.courses.find(item => item.id === courseId)?.name ?? '课程资料';
        const error = failed || (document.status === 'failed' ? '内容没能打开，请稍后重试。' : '')
            || (knowledge && !course ? '没有找到这个课程或资料。' : '');
        return <div className="sd page campus-entry knowledge"><div className="wrap">
            <CampusHeader className="kn-bar"><button className="back" onClick={() => open({})}><Back />知识</button></CampusHeader>
            <h1>{name}</h1>
            <p className="muted" role={error ? 'alert' : 'status'}>{error || '正在打开课程资料…'}</p>
            {failed || document.status === 'failed' ? <TextAction refresh onClick={() => { setAttempt(value => value + 1); document.retry(); }}>重试</TextAction> : null}
        </div></div>;
    }

    const tree = <Outline course={course} knowledge={knowledge} topic={topic} material={material} onOpen={open} />;
    return <DocPlaceProvider value={place}>
        <div className="sd page campus-entry knowledge" style={tone(course.id)}>
            <div className={`kn${!topic && !material ? ' kn-home' : ''}`}>
                {wide && (topic || material) ? <aside className="kn-tree">{tree}</aside> : null}
                <main className="kn-main">
                    <CampusHeader className="kn-bar">
                        <button className="back" onClick={() => open({})}><Back />知识</button>
                        {!wide && (topic || material) ? <button className="kn-course-switch" aria-label={`${course.name}课程目录`} aria-expanded={outline} onClick={() => setOutline(true)}><span>{course.name}</span><Chevron /></button> : null}
                    </CampusHeader>
                    {topic ? <>
                        <TopicView topic={topic} />
                        <TopicReferences topic={topic} knowledge={knowledge} course={course} onOpen={open} />
                    </>
                        : material ? <MaterialView material={material} anchor={anchor} onTopic={href => place.open(href)?.()} />
                            : <CourseView course={course} knowledge={knowledge} onOpen={open} />}
                    {!wide && topic ? <Relations key={topic.id} topic={topic} knowledge={knowledge} course={course} onOpen={open} /> : null}
                    {!wide && material ? <MaterialTopics material={material} knowledge={knowledge} onOpen={open} course={course} /> : null}
                </main>
                {wide ? <aside className="kn-side">
                    {topic ? <Relations key={topic.id} topic={topic} knowledge={knowledge} course={course} onOpen={open} />
                        : material ? <MaterialTopics material={material} knowledge={knowledge} onOpen={open} course={course} />
                            : <Materials course={course} knowledge={knowledge} onOpen={open} />}
                </aside> : null}
            </div>
            {outline ? <Sheet title={course.name} onClose={() => setOutline(false)}>{tree}</Sheet> : null}
        </div>
    </DocPlaceProvider>;
}

/** Documents and diagrams need the kernel; browsing the course catalogue does not. */
function useDocument(needed: boolean) {
    const [status, setStatus] = useState<'pending' | 'ready' | 'failed'>('pending');
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        if (!needed) return;
        let current = true;
        setStatus('pending');
        void docReady().then(() => { if (current) setStatus('ready'); })
            .catch(() => { if (current) setStatus('failed'); });
        return () => { current = false; };
    }, [needed, attempt]);
    return { status, retry: () => setAttempt(value => value + 1) };
}

const safeMermaidLabel = (text: string) => text.replace(/["\[\]{}]/g, '').replace(/[（(][^）)]*[）)]/g, '').trim() || text.replace(/["\[\]{}]/g, '');

const TERM_TITLES = ['', '大一上', '大一下', '大二上', '大二下', '大三上', '大三下', '大四上', '大四下'];
const GRADE_OPTIONS: [string, number | null][] = [['全部', null], ['大一', 1], ['大二', 2], ['大三', 3], ['大四', 4]];
const primaryCodeLabel = (codes: string[]) => codes.length > 1 ? `${codes[0]} +${codes.length - 1}` : codes[0] || '培养方案课程';
type FilterDraft = { cohort: string; major: string; grade: string; category: string; nature: string; inheritCohort: boolean; inheritMajor: boolean };
const courseMajors = (curriculum: CatalogCurriculum[], cohort: string) => {
    const preferred = ['计算机科学与技术', '软件工程', '信息安全', '计算机科学与技术(创新班)'];
    const found = new Set(curriculum.flatMap(item => item.plans.filter(plan => plan.grade === cohort).map(plan => plan.major)));
    return ['全部专业', ...preferred.filter(item => found.has(item)), ...[...found].filter(item => !preferred.includes(item))];
};

/** Every course in the unified training-plan model: term-grouped course cards (like RoomsBrowse) + curriculum dependency graph. */
function Home({ catalog: { courses: catalog, curriculum }, onOpen }: { catalog: KnowledgeCatalog; onOpen: (code: string) => void }) {
    const { params, set } = useUrl();
    const { prefs } = usePreferences();
    const [classes, setClasses] = useState<TeachingClass[]>([]);
    useEffect(() => { if (prefs.class) void loadClasses().then(setClasses).catch(() => undefined); }, [prefs.class]);
    const person = classes.find(item => item.id === prefs.class) ?? null;
    const scope = catalogScope(curriculum, person, { cohort: params.get('cohort'), major: params.get('major') });
    const query = params.get('q') ?? '';
    const view = params.get('view') === 'graph' ? 'graph' : 'list';
    const document = useDocument(view === 'graph');
    const category = params.get('category') ?? '全部';
    const nature = params.get('nature') ?? '全部';
    const grade = params.get('grade') ?? '全部';
    const major = scope.major;
    const planYear = scope.cohort;
    const [draft, setDraft] = useState<FilterDraft | null>(null);
    const advanced = [grade, category, nature].filter(value => value !== '全部').length;
    const focus = params.get('focus') ?? '';
    const wide = useWide();
    const cohorts = [...new Set(curriculum.flatMap(course => course.plans.map(plan => plan.grade)))].sort().reverse();
    const inPlan = (plan: CatalogCurriculum['plans'][number]) => plan.grade === planYear && (major === '全部专业' || plan.major === major)
        && (category === '全部' || plan.category === category) && (nature === '全部' || plan.nature === nature);

    const byCode = useMemo(() => {
        const map = new Map<string, CatalogCurriculum>();
        for (const item of curriculum) map.set(item.code, item);
        return map;
    }, [curriculum]);

    const compiledByCode = useMemo(() => {
        const map = new Map<string, CatalogCourse>();
        for (const c of catalog) {
            for (const code of [...c.codes, ...c.former]) map.set(code, c);
        }
        return map;
    }, [catalog]);

    const courseMeta = useMemo(() => {
        const meta = new Map<string, { categories: string[]; natures: string[]; majors: string[]; credits: number[]; terms: number[] }>();
        for (const c of catalog) {
            const matched = [...new Set([...c.codes, ...c.former].map(code => byCode.get(code)).filter((x): x is CatalogCurriculum => Boolean(x)))].flatMap(course => course.plans).filter(inPlan);
            const categories = [...new Set(matched.map(m => m.category).filter(Boolean))];
            const natures = [...new Set(matched.map(m => m.nature).filter(Boolean))];
            const majors = [...new Set(matched.map(m => m.major).filter(Boolean))];
            const credits = [...new Set(matched.map(m => m.credits).filter((n): n is number => n !== null && n > 0))].sort((a, b) => a - b);
            const terms = [...new Set(matched.map(m => m.term).filter((term): term is number => term !== null))].sort((a, b) => a - b);
            meta.set(c.id, { categories, natures, majors, credits, terms });
        }
        return meta;
    }, [catalog, byCode, planYear, major, category, nature]);

    const categories = useMemo(() => {
        const all = new Set(['专业基础课', '专业课', '通识教育课']);
        for (const m of courseMeta.values()) for (const c of m.categories) all.add(c);
        return ['全部', ...['专业基础课', '专业课', '通识教育课'].filter(c => all.has(c))];
    }, [courseMeta]);

    const majors = useMemo(() => courseMajors(curriculum, draft?.cohort ?? planYear), [curriculum, draft?.cohort, planYear]);

    const q = query.trim().toLowerCase();
    const targetGrade = GRADE_OPTIONS.find(([label]) => label === grade)?.[1] ?? null;
    const courses = useMemo(() => {
        return catalog.filter(course => {
            const meta = courseMeta.get(course.id);
            if (category !== '全部' && !meta?.categories.includes(category)) return false;
            if (nature !== '全部' && !meta?.natures.includes(nature)) return false;
            if (major !== '全部专业' && !meta?.majors.includes(major)) return false;
            if (targetGrade !== null && !meta?.terms.some(t => Math.ceil(t / 2) === targetGrade)) return false;
            if (!q) return true;
            return course.name.toLowerCase().includes(q)
                || course.codes.some(c => c.toLowerCase().includes(q))
                || course.chapters.some(title => title.toLowerCase().includes(q));
        });
    }, [catalog, courseMeta, category, nature, major, targetGrade, q]);

    const groupedByTerm = useMemo(() => {
        const groups = new Map<number, CatalogCourse[]>();
        for (const course of courses) {
            const terms = courseMeta.get(course.id)?.terms ?? [];
            const matching = terms.filter(term => term >= 1 && term <= 8 && (targetGrade === null || Math.ceil(term / 2) === targetGrade));
            for (const term of matching.length ? matching : [99]) {
                const bucket = groups.get(term) ?? [];
                bucket.push(course);
                groups.set(term, bucket);
            }
        }
        return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([term, list]) => ({
            term,
            title: term >= 1 && term <= 8 ? TERM_TITLES[term]! : '其他与通识课程',
            sub: term >= 1 && term <= 8 ? `第 ${term} 学期 · ${list.length} 门` : `${list.length} 门`,
            courses: list,
        }));
    }, [courses, courseMeta, targetGrade]);

    const selected = useMemo(() => curriculum.filter(item => item.plans.some(plan => inPlan(plan) && (targetGrade === null || plan.term !== null && Math.ceil(plan.term / 2) === targetGrade))
        && (!q || item.name.toLowerCase().includes(q) || item.code.toLowerCase().includes(q))), [curriculum, planYear, major, category, nature, targetGrade, q]);
    const overview = useMemo(() => courseRelations(curriculum, selected), [curriculum, selected]);
    const graphFocus = focus === 'all' || overview.choices.some(course => course.code === focus) ? focus : wide ? 'all' : overview.choices[0]?.code ?? 'all';
    const relations = useMemo(() => courseRelations(curriculum, selected, graphFocus), [curriculum, selected, graphFocus]);
    const graphNodes = useMemo(() => {
        const idOf = new Map(relations.nodes.map((node, i) => [node.code, `P${i}`]));
        const lines = ['```mermaid', `flowchart ${wide ? 'LR' : 'TB'}`];
        for (const node of relations.nodes) lines.push(`  ${idOf.get(node.code)}["${safeMermaidLabel(node.name)}"]`);
        for (const edge of relations.edges) lines.push(`  ${idOf.get(edge.from)} --> ${idOf.get(edge.to)}`);
        lines.push('```');
        const linked = [...new Map(relations.nodes.flatMap(node => { const course = compiledByCode.get(node.code); return course ? [[course.id, course] as const] : []; })).values()];
        return { doc: relations.edges.length ? lines.join('\n') : '', linked, planned: relations.nodes.filter(node => !compiledByCode.has(node.code)) };
    }, [relations.nodes, relations.edges, compiledByCode, wide]);

    return <div className="sd page campus-entry knowledge"><div className="wrap">
        <CampusHeader className="ph"><div><h1>知识</h1></div></CampusHeader>
        <div className="kn-tools">
            <input className="kn-search" type="search" value={query} onChange={e => set({ q: e.target.value })} placeholder={view === 'graph' ? '搜索课程或代码' : '搜索课程、代码或章节'} aria-label="筛选课程" />
            <div className="kn-view-row"><div className="kn-tabs" role="tablist" aria-label="视图切换">
                <button role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => set({ view: null })}>课程目录</button>
                <button role="tab" aria-selected={view === 'graph'} className={view === 'graph' ? 'on' : ''} onClick={() => set({ view: 'graph' })}>课程关系</button>
            </div><TextAction muted onClick={() => setDraft({ cohort: planYear, major, grade, category, nature, inheritCohort: !params.has('cohort'), inheritMajor: !params.has('major') })}>筛选</TextAction></div>
        </div>
        <p className="kn-scope"><span>{planYear}级 · {major}</span>{advanced ? <small>{advanced} 项筛选</small> : null}</p>
        {view === 'graph' ? <div className="kn-focus"><label>查看课程<select className="kn-select" value={graphFocus} onChange={e => set({ focus: e.target.value })}>
                <option value="all">全部关系</option>{overview.choices.map(course => <option key={course.code} value={course.code}>{course.name}</option>)}
            </select></label></div> : null}
        {view === 'graph'
            ? <div className="kn-graph">
                <p className="fine">箭头表示作者整理的建议先修顺序，学期安排以培养方案为准。</p>
                {!graphNodes.doc ? <p className="muted">当前筛选暂无已收录的先修关系。课程仍可在课程目录查看。</p> : document.status === 'ready' ? <DocText text={graphNodes.doc} />
                    : document.status === 'failed' ? <div role="alert" className="content-failure"><p>课程关系暂时无法加载。</p><TextAction refresh onClick={document.retry}>重试</TextAction></div>
                        : <p className="muted" role="status">正在打开课程关系…</p>}
                {relations.unlinked > 0 && graphNodes.doc ? <p className="fine">仅显示已收录的关系，未连线课程仍可在课程目录查看。</p> : null}
                {graphNodes.linked.length ? <div className="kn-graph-links">
                    <small>查看课程内容</small>
                    <div>{graphNodes.linked.map(c => <button key={c.id} style={tone(c.id)} onClick={() => onOpen(c.id)}>{c.name}</button>)}</div>
                </div> : null}
                {graphNodes.planned.length ? <details className="kn-planned"><summary>{graphNodes.planned.length} 门课程暂未收录内容</summary><p className="fine">{graphNodes.planned.map(course => course.name).join('、')}</p></details> : null}
            </div>
            : groupedByTerm.length === 0
                ? <p className="empty">没有符合当前筛选条件的课程</p>
                : <div className="kn-term-groups">{groupedByTerm.map(section => (
                    <section key={section.term} className="kn-term-group">
                        <header className="kn-term-head"><h2>{section.title}</h2><small>{section.sub}</small></header>
                        <div className="kn-courses">{section.courses.map(course => {
                            const meta = courseMeta.get(course.id);
                            const badges = [
                                primaryCodeLabel(course.codes),
                                meta?.categories[0],
                                meta?.natures.join('/'),
                                meta?.credits.length ? `${meta.credits.join("/")} 学分` : null,
                            ].filter(Boolean);
                            return <button key={course.id} className="kn-course" style={tone(course.id)} onClick={() => onOpen(course.id)}>
                                <b>{course.name}</b>
                                <small>{badges.join(' · ')}</small>
                                <span>{course.chapters.length} 章 · {course.topics} 个知识点 · {course.materials} 份资料</span>
                                <Chevron />
                            </button>;
                        })}</div>
                    </section>
                ))}</div>}
        {draft ? <Sheet title="筛选课程" className="knowledge-filter-sheet" onClose={() => setDraft(null)}>
            <div className="kn-filter-fields">
                <label>入学年份<select className="tf" value={draft.cohort} onChange={e => {
                    const cohort = e.target.value;
                    const nextMajor = draft.inheritMajor ? catalogScope(curriculum, person, { cohort }).major : courseMajors(curriculum, cohort).includes(draft.major) ? draft.major : '全部专业';
                    setDraft({ ...draft, cohort, major: nextMajor, inheritCohort: false });
                }}>{cohorts.map(year => <option key={year} value={year}>{year} 级</option>)}</select></label>
                <label>专业<select className="tf" value={draft.major} onChange={e => setDraft({ ...draft, major: e.target.value, inheritMajor: false })}>{majors.map(item => <option key={item}>{item}</option>)}</select></label>
                <label>学年<select className="tf" value={draft.grade} onChange={e => setDraft({ ...draft, grade: e.target.value })}>{GRADE_OPTIONS.map(([item]) => <option key={item} value={item}>{item === '全部' ? '全部学年' : item}</option>)}</select></label>
                <label>课程类别<select className="tf" value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })}>{categories.map(item => <option key={item}>{item}</option>)}</select></label>
                <label>修读要求<select className="tf" value={draft.nature} onChange={e => setDraft({ ...draft, nature: e.target.value })}>{['全部', '必修', '限选'].map(item => <option key={item}>{item}</option>)}</select></label>
            </div>
            <div className="kn-filter-actions"><TextAction muted onClick={() => {
                const defaults = catalogScope(curriculum, person, {});
                setDraft({ ...defaults, grade: '全部', category: '全部', nature: '全部', inheritCohort: true, inheritMajor: true });
            }}>重置</TextAction><span /><TextAction muted onClick={() => setDraft(null)}>取消</TextAction><button className="btn go" onClick={() => {
                set({ cohort: draft.inheritCohort ? null : draft.cohort, major: draft.inheritMajor ? null : draft.major, grade: draft.grade === '全部' ? null : draft.grade, category: draft.category === '全部' ? null : draft.category, nature: draft.nature === '全部' ? null : draft.nature, focus: null }, { push: true });
                setDraft(null);
            }}>应用筛选</button></div>
        </Sheet> : null}
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
    const [loaded, setLoaded] = useState<{ path: string; text: string | null; failed: boolean } | null>(null);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let current = true;
        setLoaded(null);
        void loadKnowledgeText(path).then(text => { if (current) setLoaded({ path, text, failed: false }); }).catch(() => { if (current) setLoaded({ path, text: null, failed: true }); });
        return () => { current = false; };
    }, [path, attempt]);
    return { text: loaded?.path === path ? loaded.text : null, failed: loaded?.path === path && loaded.failed, retry: () => setAttempt(value => value + 1) };
}

function TextFailure({ onRetry }: { onRetry: () => void }) {
    return <div role="alert" className="content-failure"><p className="muted">内容暂时无法加载</p><TextAction refresh onClick={onRetry}>重试</TextAction></div>;
}

function CourseView({ course, knowledge, onOpen }: { course: KnowledgeCourse; knowledge: Knowledge; onOpen: (to: Open) => void }) {
    const { text, failed, retry } = useText(course.path);
    const topics = course.chapters.flatMap(chapter => chapter.topics).map(id => knowledge.topics.find(item => item.id === id)!).filter(Boolean);
    const most = [...topics].sort((a, b) => b.references.length - a.references.length).filter(item => item.references.length).slice(0, 6);
    return <article className="kn-doc">
        {text === null ? <h2 className="kn-title">{course.name}</h2> : null}
        {failed ? <TextFailure onRetry={retry} /> : text === null ? <p className="muted">正在打开…</p> : <DocText text={text} />}
        {most.length ? <section className="kn-most"><h2>资料中的知识点</h2>{most.map(item => {
            const count = referenced(item);
            return <button key={item.id} onClick={() => onOpen({ topic: item.id, course: course.id })}><b>{item.title}</b><small>{count.references} 处 · {count.materials} 份资料</small></button>;
        })}</section> : null}
    </article>;
}

function TopicView({ topic }: { topic: KnowledgeTopic }) {
    const { text, failed, retry } = useText(topic.path);
    const count = referenced(topic);
    return <article className="kn-doc">
        {text === null ? <h2 className="kn-title">{topic.title}</h2> : null}
        {count.references ? <p className="kn-count">关联 {count.references} 处 · 出现在 {count.materials} 份资料里</p> : <p className="kn-count">收录的资料里还没有与它关联的片段</p>}
        {failed ? <TextFailure onRetry={retry} /> : text === null ? <p className="muted">正在打开…</p> : <DocText text={text} />}
    </article>;
}

function MaterialView({ material, anchor, onTopic }: { material: KnowledgeMaterial; anchor: string | null; onTopic: (href: string) => void }) {
    const documentRef = useRef<HTMLElement>(null);
    const { text, failed, retry } = useText(material.path);
    const parts = useMemo(() => {
        if (text === null) return null;
        const stream = new DocStream(); stream.push(text); const { blocks } = stream.finish(); stream.free();
        return materialParts(blocks);
    }, [text]);
    const [shown, setShown] = useState<Set<string>>(new Set());
    useEffect(() => { setShown(new Set()); }, [material.path]);
    const owner = parts?.find(part => part.kind === 'section' && anchor && part.answer.some(piece => containsAnchor(piece.blocks, anchor)));
    const ownerAnchor = owner?.kind === 'section' ? owner.anchor : null;
    useEffect(() => { if (ownerAnchor) setShown(current => new Set([...current, ownerAnchor])); }, [ownerAnchor]);
    useEffect(() => {
        const article = documentRef.current;
        if (!article || !anchor) return;
        // Pictures and formulas can still grow after the address opens. Follow that address until the reader
        // takes control, including while its text is loading or its containing answer is being revealed.
        const intent = new AbortController();
        let frame = 0;
        const align = () => {
            frame = 0;
            if (intent.signal.aborted) return;
            const target = document.getElementById(anchor);
            if (target && article.contains(target)) target.scrollIntoView({ block: 'start', behavior: 'instant' });
        };
        const schedule = () => { if (!intent.signal.aborted && !frame) frame = requestAnimationFrame(align); };
        const observer = new ResizeObserver(schedule);
        const stop = () => { intent.abort(); observer.disconnect(); cancelAnimationFrame(frame); };
        const options = { capture: true, passive: true, signal: intent.signal };
        addEventListener('wheel', stop, options);
        addEventListener('touchstart', stop, options);
        addEventListener('pointerdown', stop, options);
        addEventListener('keydown', event => {
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) stop();
        }, options);
        observer.observe(article);
        schedule();
        return stop;
    }, [material.path, anchor]);
    const all = parts?.filter(part => part.kind === 'section' && part.answer.length).length ?? 0;
    return <article className="kn-doc" ref={documentRef}>
        {text === null ? <h2 className="kn-title">{material.title}</h2> : null}
        <p className="kn-count"><span className="kn-kind" style={{ '--kind': `var(--${KIND_TONE[material.kind] ?? 'muted'})` } as CSSProperties}>{material.kind}</span>{[material.term].filter(Boolean).map(term => ` · ${term}`)}{material.sections ? ` · ${material.sections} 处关联` : ''}{/^https?:\/\//.test(material.source) ? <> · <a href={material.source} target="_blank" rel="noreferrer">原件</a></> : null}
            {all && material.kind !== '课件' ? <button className="kn-toggle" onClick={() => setShown(shown.size ? new Set() : new Set(parts!.flatMap(part => part.kind === 'section' ? [part.anchor] : [])))}>{shown.size ? '收起全部解答' : '展开全部解答'}</button> : null}</p>
        {failed ? <TextFailure onRetry={retry} /> : parts === null ? <p className="muted">正在打开…</p> : parts.map((part, at) => {
            if (part.kind === 'text') return <Doc key={at} blocks={part.blocks} />;
            if (part.kind === 'group') return <h2 key={at} id={part.anchor} className="kn-group">{part.title}{part.sections ? <small>{part.sections} 节</small> : null}</h2>;
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
    const [more, setMore] = useState(false);
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
        {miniGraph ? <section><h3>相关知识点</h3><div className="kn-mini-graph"><DocText text={miniGraph} /></div></section> : null}
        {topic.requires.length ? <section><h3>先要懂</h3>{(more ? topic.requires : topic.requires.slice(0, 5)).map(link)}</section> : null}
        {topic.leads_to.length ? <section><h3>用到它的</h3>{(more ? topic.leads_to : topic.leads_to.slice(0, 5)).map(link)}</section> : null}
        {topic.requires.length > 5 || topic.leads_to.length > 5 ? <button className="kn-more" onClick={() => setMore(value => !value)} aria-expanded={more}>{more ? '收起' : '展开全部相关知识点'}</button> : null}
        {!topic.requires.length && !topic.leads_to.length ? <section><h3>相关知识点</h3><p className="muted">暂未收录相关知识点</p></section> : null}
    </div>;
}

/** Below a topic's core explanation: every material passage that names it, grouped by material. */
function TopicReferences({ topic, knowledge, course, onOpen }: { topic: KnowledgeTopic; knowledge: Knowledge; course: KnowledgeCourse; onOpen: (to: Open) => void }) {
    const byMaterial = new Map<string, typeof topic.references>();
    for (const ref of topic.references) byMaterial.set(ref.material, [...(byMaterial.get(ref.material) ?? []), ref]);
    return <section className="kn-most kn-tested">
        <h2>关联资料</h2>
        {byMaterial.size ? [...byMaterial].map(([path, refs]) => <ReferenceGroup key={`${topic.id}:${path}`} path={path} refs={refs} material={knowledge.materials.find(item => item.path === path)} onOpen={anchor => onOpen({ material: path, anchor, course: course.id })} />)
            : <p className="muted">暂未收录相关资料。</p>}
    </section>;
}

function ReferenceGroup({ path, refs, material, onOpen }: { path: string; refs: KnowledgeTopic['references']; material?: KnowledgeMaterial; onOpen: (anchor: string) => void }) {
    const [expanded, setExpanded] = useState(false);
    const { text, failed, retry } = useText(path);
    const previews = useMemo(() => text === null ? new Map() : referencePreviews(readDoc(text).map(block => ({ block }))), [text]);
    const shown = expanded ? refs : refs.slice(0, 3);
    return <div className="kn-refs">
        <div className="kn-ref-head"><b>{material?.title ?? '课程资料'}</b><small>{refs.length} 处</small></div>
        {refs.length > 3 ? <button className="kn-more" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>{expanded ? '收起' : `展开全部 ${refs.length} 处`}</button> : null}
        {failed ? <p className="muted">题干预览暂时无法加载 <TextAction refresh onClick={retry}>重试</TextAction></p> : null}
        <div className="kn-ref-list">{shown.map(ref => {
            const preview = previews.get(ref.anchor);
            return <button key={ref.anchor} onClick={() => onOpen(ref.anchor)}>
                <span><b>{preview?.context ? `${preview.context} · ` : ''}{preview?.title ?? ref.heading}</b>{preview?.excerpt ? <small>{preview.excerpt}</small> : null}</span><Chevron />
            </button>;
        })}</div>
    </div>;
}

/** Beside a document: the topics its passages name, most linked first. */
function MaterialTopics({ material, knowledge, course, onOpen }: { material: KnowledgeMaterial; knowledge: Knowledge; course: KnowledgeCourse; onOpen: (to: Open) => void }) {
    const [expanded, setExpanded] = useState(false);
    const counts = knowledge.topics.map(topic => ({ topic, n: topic.references.filter(ref => ref.material === material.path).length })).filter(row => row.n).sort((a, b) => b.n - a.n);
    return <div className="kn-rel"><section><h3>这份资料关联的知识点</h3>{(expanded ? counts : counts.slice(0, 8)).map(({ topic, n }) =>
        <button key={topic.id} onClick={() => onOpen({ topic: topic.id, course: course.id })}>{topic.title}<small>{n} 处</small></button>)}{counts.length > 8 ? <button className="kn-more" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>{expanded ? '收起' : `展开全部 ${counts.length} 个知识点`}</button> : null}</section></div>;
}

function Materials({ course, knowledge, onOpen }: { course: KnowledgeCourse; knowledge: Knowledge; onOpen: (to: Open) => void }) {
    return <div className="kn-rel"><section><h3>资料</h3>{knowledge.materials.filter(item => item.course === course.id).map(item =>
        <button key={item.path} onClick={() => onOpen({ material: item.path, course: course.id })}>{item.title}<small>{item.sections ? `${item.sections} 处关联` : item.kind}</small></button>)}</section></div>;
}
