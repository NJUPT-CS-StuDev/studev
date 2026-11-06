// The one way in. Everything searchable is one document in one index, so a query has one
// ranking, one set of highlights and one way to page, here and in the app.
import { useEffect, useMemo, useRef, useState } from 'react';
import { SearchClient, type FilterOptions, type SearchFilters, type SearchResult, type SortMode } from 'wasm-search';
import type { TeachingMeeting } from '@/world/facts';
import { APP_CONFIG } from '@/world/config';
import { loadMeetings, loadPeriods, loadRoomDay } from '@/world/data';
import { courseName, roomLabel } from '@/world/names';
import { makeRoomReader } from '@/world/rooms';
import { hm, momentNow, WEEKDAYS } from '@/world/time';
import { useUrl } from '@/world/useUrl';
import { Back, Chevron, Magnifier, Sheet, WeekGlyph } from '@/world/ui';
import { campusConfig } from '../../../campus.config';
import '../campus.css';

const PAGE_SIZE = 10;
const CHANNELS = campusConfig.search.channels as readonly { id: string; label: string; sources?: readonly string[]; excluded?: readonly string[]; dated?: boolean }[];
const ENTITIES = new Set(Object.keys(campusConfig.search.entities));
const EXAMPLES = ['操作系统', '周浩', 'B240402', '教4-309', '一食堂', '奖学金', '高等数学', '校园网'];
const CATEGORIES: Record<string, string> = { notice_article: '通知', policy: '政策制度', workflow: '办事流程', download: '下载资源', exam: '考试信息', news: '新闻动态', external: '站外链接' };
const SINCE = [['', '全部时间'], ['1', '近一年'], ['3', '近三年'], ['5', '近五年']] as const;
const yearsAgo = (years: number) => { const date = new Date(); date.setUTCFullYear(date.getUTCFullYear() - years); return date.toISOString().slice(0, 10); };

/** Marks the kernel's ranges, which count Unicode scalar values. */
function Marked({ text, ranges }: { text: string; ranges: [number, number][] }) {
    if (!ranges.length) return <>{text}</>;
    const scalars = Array.from(text);
    const out: React.ReactNode[] = [];
    let cursor = 0;
    for (const [start, end] of ranges) {
        if (start > cursor) out.push(scalars.slice(cursor, start).join(''));
        out.push(<mark key={start}>{scalars.slice(start, end).join('')}</mark>);
        cursor = end;
    }
    out.push(scalars.slice(cursor).join(''));
    return <>{out}</>;
}

function Result({ result, roomState, onCourse }: { result: SearchResult; roomState: (id: string) => { busy: boolean; text: string } | null; onCourse: (name: string) => void }) {
    const title = <Marked text={result.title} ranges={result.titleHighlights ?? []} />;
    // A file's page often has no text but the file's own name, which says nothing new.
    const says = (text: string) => text.replace(/\.[a-z0-9]{1,5}$/i, '').trim();
    const adds = result.snippet && says(result.snippet) !== says(result.title) && !result.attachments.some(file => says(file.name) === says(result.snippet!));
    const snippet = adds ? <Marked text={result.snippet!} ranges={result.snippetHighlights ?? []} /> : null;
    if (ENTITIES.has(result.source)) {
        const room = result.source === 'rooms' ? roomState(result.id.slice('rooms/'.length)) : null;
        const body = <>
            <span className="kind">{result.sourceName}</span>
            <span className="m">
                <span className="a">{title}{result.section ? <small>{result.section}</small> : null}</span>
                {room ? <span className="b"><span className={`state-dot ${room.busy ? 'busy' : ''}`} />{room.text}</span> : snippet ? <span className="b">{snippet}</span> : null}
            </span>
            <Chevron />
        </>;
        return result.source === 'courses'
            ? <button className="hit entity" onClick={() => onCourse(result.title)}>{body}</button>
            : <a className="hit entity" href={result.url}>{body}</a>;
    }
    const date = result.publishedAt ?? result.updatedAt;
    const crumbs = [result.sourceName, result.section].filter(Boolean).join(' › ');
    return (
        <article className="hit doc">
            <div className="crumb">{crumbs}{date ? <time> · {date.slice(0, 10)}</time> : null}{result.kind === 'file' ? ' · 文件' : result.kind === 'link' ? ' · 站外' : ''}</div>
            <h3><a href={result.url} target="_blank" rel="noopener noreferrer">{title}</a></h3>
            {snippet ? <p>{snippet}</p> : result.snippet === null ? <p className="wait" aria-hidden="true" /> : null}
            {result.attachments.length > 0 && <div className="files">{result.attachments.slice(0, 4).map(file => <a key={file.url} href={file.url} target="_blank" rel="noopener noreferrer">{file.name}</a>)}{result.attachments.length > 4 && <span>等 {result.attachments.length} 个附件</span>}</div>}
        </article>
    );
}

function Pages({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
    const last = Math.ceil(total / PAGE_SIZE);
    if (last <= 1) return null;
    const from = Math.max(1, Math.min(page - 4, last - 8));
    const to = Math.min(last, from + 8);
    return (
        <nav className="pages" aria-label="翻页">
            <button disabled={page <= 1} aria-label="上一页" onClick={() => onPage(page - 1)}><Back />上一页</button>
            {Array.from({ length: to - from + 1 }, (_, index) => from + index).map(number => <button key={number} className={number === page ? 'on' : ''} aria-current={number === page ? 'page' : undefined} onClick={() => onPage(number)}>{number}</button>)}
            <button disabled={page >= last} aria-label="下一页" onClick={() => onPage(page + 1)}>下一页<Chevron /></button>
        </nav>
    );
}

export default function SearchApp() {
    const { params, set } = useUrl();
    const query = params.get('q') ?? '';
    const channel = CHANNELS.find(item => item.id === params.get('scope')) ?? CHANNELS[0]!;
    const page = Math.max(1, Number(params.get('page')) || 1);
    const source = params.get('source');
    const category = params.get('type');
    const since = params.get('since') ?? '';
    const sort: SortMode = params.get('sort') === 'date' ? 'date_desc' : 'relevance';
    const [text, setText] = useState(query);
    const [answer, setAnswer] = useState<{ key: string; results: SearchResult[]; total: number; seconds: number | null } | null>(null);
    const [failed, setFailed] = useState(false);
    const [options, setOptions] = useState<FilterOptions | null>(null);
    const [course, setCourse] = useState<string | null>(null);
    const [rooms, setRooms] = useState<((id: string) => { busy: boolean; text: string } | null) | null>(null);
    const input = useRef<HTMLInputElement>(null);
    const client = useMemo(() => new SearchClient({ baseUrl: APP_CONFIG.DATA_URLS.SEARCH }), []);
    useEffect(() => () => client.dispose(), [client]);
    useEffect(() => { if (!query) input.current?.focus({ preventScroll: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { void client.initialize().then(ready => setOptions(ready.filterOptions)).catch(() => setFailed(true)); }, [client]);

    const filters = useMemo<SearchFilters>(() => ({
        ...(source ? { sourceIds: [source] } : channel.sources ? { sourceIds: [...channel.sources] } : {}),
        // Several words can name one teaching class ("周浩 计算机通信"); one word would list them all.
        ...(!source && channel.excluded ? { excludedSourceIds: channel.id === 'all' && /\S\s+\S/.test(query) ? channel.excluded.filter(id => id !== 'teaching-classes') : [...channel.excluded] } : {}),
        ...(category ? { category } : {}),
        ...(since ? { publishedFrom: yearsAgo(Number(since)), includeUndated: false } : {}),
    }), [category, channel, query, since, source]);
    const key = JSON.stringify([query.trim(), filters, sort, page]);
    useEffect(() => {
        const trimmed = query.trim();
        if (trimmed.length < 2) { setAnswer(null); return; }
        let live = true;
        const started = performance.now();
        setFailed(false);
        const pending = client.search({ query: trimmed, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE, sort, filters }, ranked => {
            if (live) setAnswer({ key, results: ranked.results, total: ranked.totalCandidates, seconds: (performance.now() - started) / 1000 });
        });
        pending.response.then(done => {
            if (live) setAnswer(previous => ({ key, results: done.results, total: done.totalCandidates, seconds: previous?.key === key ? previous.seconds : (performance.now() - started) / 1000 }));
        }).catch(error => { if (live && !(error instanceof DOMException && error.name === 'AbortError')) setFailed(true); });
        return () => { live = false; client.cancel(pending.requestId); };
    }, [client, filters, key, page, query, sort]);

    const results = answer?.results ?? [];
    useEffect(() => {
        if (rooms || !results.some(result => result.source === 'rooms')) return;
        void Promise.all([loadPeriods(), loadRoomDay(momentNow().date)]).then(([periods, day]) => {
            const read = makeRoomReader(periods);
            const now = momentNow();
            setRooms(() => (id: string) => {
                if (!day) return null;
                const state = read(day, id, now.min);
                return { busy: state.busy, text: state.busy ? `上课中，到 ${hm(state.until)}` : `现在空闲，到 ${hm(state.until)}` };
            });
        });
    }, [results, rooms]);

    const type = (value: string) => { setText(value); set({ q: value, page: null }); };
    const go = (patch: Record<string, string | number | null>) => { set({ page: null, ...patch }, { push: true }); };
    const onPage = (next: number) => { set({ page: next > 1 ? next : null }, { push: true }); scrollTo({ top: 0 }); };
    const sources = channel.sources && channel.sources.length > 1
        ? channel.sources.map(id => ({ id, label: (campusConfig.search.entities as Record<string, string>)[id] ?? id }))
        : channel.dated ? (options?.sources ?? []).filter(item => !channel.excluded?.includes(item.id)).map(item => ({ id: item.id, label: item.label })) : [];
    const categories = channel.dated ? (options?.categories ?? []).filter(item => CATEGORIES[item.id]) : [];
    let intent = null;
    if (/空教室|自习/.test(query)) intent = <a className="intent" href="/map/"><span>看此刻的空教室<small>在地图上按“还能待多久”看</small></span><Chevron /></a>;
    else if (/^(考试|考表|放假|校历)/.test(query)) intent = <a className="intent" href="/?scale=term"><span>看整个学期<small>课、考试和假期在同一张表上</small></span><Chevron /></a>;
    const trimmed = query.trim();
    return (
        <div className="sd page search">
            <div className="wrap narrow">
                <div className="sfield"><Magnifier /><input ref={input} value={text} placeholder="搜课程、老师、班级、地点、通知、资料" aria-label="搜索" autoComplete="off" enterKeyHint="search" onChange={event => type(event.target.value)} /></div>
                {!trimmed ? <>
                    <div className="hint">课程、老师、班级、教室、地点、通知、考试资料、社区手册，都在这里</div>
                    <div className="hintrow">{EXAMPLES.map(example => <button key={example} className="ib" onClick={() => type(example)}>{example}</button>)}</div>
                </> : <>
                    <div className="chips" role="tablist">
                        {CHANNELS.map(item => <button key={item.id} role="tab" aria-selected={item.id === channel.id} className={`chip ${item.id === channel.id ? 'on' : ''}`} onClick={() => go({ scope: item.id === 'all' ? null : item.id, source: null, type: null, since: null, sort: null })}>{item.label}</button>)}
                    </div>
                    {(sources.length > 0 || channel.dated) && <div className="refine">
                        {sources.length > 0 && <select aria-label="来源" value={source ?? ''} onChange={event => go({ source: event.target.value || null })}><option value="">全部来源</option>{sources.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>}
                        {categories.length > 0 && <select aria-label="类型" value={category ?? ''} onChange={event => go({ type: event.target.value || null })}><option value="">全部类型</option>{categories.map(item => <option key={item.id} value={item.id}>{CATEGORIES[item.id]}</option>)}</select>}
                        {channel.dated && <select aria-label="时间" value={since} onChange={event => go({ since: event.target.value || null })}>{SINCE.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}
                        {channel.dated && <select aria-label="排序" value={sort === 'date_desc' ? 'date' : ''} onChange={event => go({ sort: event.target.value || null })}><option value="">按相关性</option><option value="date">按时间</option></select>}
                    </div>}
                    {trimmed.length < 2 ? <div className="empty">再多输入一个字</div> : <>
                        {answer && answer.total > 0 && <div className="tally">{answer.total >= 1000 ? '超过 1000' : `约 ${answer.total.toLocaleString('zh-CN')}`} 条结果{answer.seconds !== null ? `（${answer.seconds.toFixed(2)} 秒）` : ''}{page > 1 ? ` · 第 ${page} 页` : ''}</div>}
                        {page === 1 && intent}
                        {failed && <div className="empty">搜索暂时出了问题，请稍后重试。</div>}
                        <div className="hits">{results.map(result => <Result key={result.id} result={result} roomState={id => rooms?.(id) ?? null} onCourse={setCourse} />)}</div>
                        {answer?.key === key && answer.total === 0 && !failed && <div className="empty">没有找到“{trimmed}”{channel.id !== 'all' ? '，换到“全部”试试' : ''}</div>}
                        {answer?.key === key && answer.total > 0 && results.length === 0 && <div className="empty">结果只有 {Math.ceil(answer.total / PAGE_SIZE)} 页</div>}
                        {answer && <Pages page={page} total={answer.total} onPage={onPage} />}
                    </>}
                </>}
            </div>
            {course && <CourseSheet name={course} onClose={() => setCourse(null)} />}
        </div>
    );
}

function CourseSheet({ name, onClose }: { name: string; onClose: () => void }) {
    const [groups, setGroups] = useState<TeachingMeeting[][] | null>(null);
    useEffect(() => {
        void loadMeetings().then(all => {
            const byClass = new Map<string, TeachingMeeting[]>();
            for (const row of all) if (courseName(row.course.name) === name) byClass.set(row.teaching_class.id, [...(byClass.get(row.teaching_class.id) ?? []), row]);
            setGroups([...byClass.values()].sort((left, right) => right.length - left.length));
        });
    }, [name]);
    const slots = (rows: TeachingMeeting[]) => [...new Set(rows.map(row => `${WEEKDAYS[row.weekday]} ${row.periods[0]}–${row.periods[1]} 节`))].slice(0, 3).join('，');
    return (
        <Sheet title={name} onClose={onClose}>
            <div className="meta">{groups ? `${groups.length} 个教学班，点一个叠到你的课表上看看` : '正在读取…'}</div>
            <a className="kv" href={`/?who=course:${encodeURI(name)}&scale=week`}><span className="v">这门课的全部时段</span><Chevron /></a>
            <div className="sheet-list">{groups?.slice(0, 60).map(rows => (
                <a key={rows[0]!.teaching_class.id} className="res" href={`/?preview=${encodeURIComponent(rows[0]!.teaching_class.id)}&scale=week`}>
                    <span className="m"><span className="a">{[...new Set(rows.flatMap(row => row.teachers.map(teacher => teacher.name)))].join(' ') || '教师待定'}</span><span className="b">{slots(rows)}{rows[0]!.room ? ` · ${roomLabel(rows[0]!.room)}` : ''}</span></span>
                    <WeekGlyph slots={rows.map(row => ({ weekday: row.weekday, period: row.periods[0] }))} />
                </a>
            ))}</div>
        </Sheet>
    );
}
