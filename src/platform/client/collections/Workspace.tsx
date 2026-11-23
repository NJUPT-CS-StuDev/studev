import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ClipboardList, Plus, Search, UsersRound } from 'lucide-react';
import { api, collectionAuthorized, errorText, PlatformError, session } from '../api';
import { pinnedCollections, semesterLabel } from '../../collections.mjs';
import type { EditorMode } from './Editor';
import { CollectionBadge, Details, WorkspaceLink, type Navigate } from './Detail';
import { badge } from './Submission';
import { chooseRound, collectionLoginUrl, displayTime, itemRoute, itemState, roundState, toCollectionUrl, type Catalog, type Detail, type Item, type Round, type Submission } from './model';

const loadEditor = () => import('./Editor');
const preloadEditor = () => { void loadEditor().catch(() => {}); };
const CollectionEditor = lazy(() => loadEditor().then(module => ({ default: module.CollectionEditor })));

const searchText = (value: string) => value.normalize('NFKC').toLowerCase().trim();

function groupItems(items: Item[]) {
    const groups = new Map<string, Item[]>();
    const sorted = [...items].sort((left, right) => (right.publishedAt || right.updatedAt).localeCompare(left.publishedAt || left.updatedAt) || right.id.localeCompare(left.id));
    for (const item of sorted) {
        const group = groups.get(item.term) || [];
        group.push(item);
        groups.set(item.term, group);
    }
    return [...groups].sort(([left], [right]) => right.localeCompare(left));
}

function CollectionCard({ item, now, navigate }: { item: Item; now: number; navigate: Navigate }) {
    const state = itemState(item, now);
    const deadlines = item.rounds.filter(round => roundState(item, round, now) === state && round.deadline)
        .map(round => round.deadline).sort();
    const deadline = state === 'collecting' ? deadlines[0] : deadlines.at(-1);
    const showDeadline = Boolean(deadline && (state === 'collecting' || state === 'makeup' || state === 'expired'));
    const date = showDeadline ? deadline : state === 'collecting' ? '' : item.publishedAt || item.updatedAt;
    const dateLabel = showDeadline ? state === 'makeup' ? '原截止' : '截止' : item.publishedAt ? '发布于' : '更新于';
    const dateText = date ? showDeadline ? displayTime(date) : displayTime(date).split(' ')[0] : '不限时';
    const issuer = [item.issuer.orgShortName || item.issuer.organizationName, item.issuer.title].filter(Boolean).join(' · ');
    const titleId = `collection-title-${item.id}`;
    return <WorkspaceLink href={toCollectionUrl(item.id)} navigate={navigate} className="cw-card" labelledBy={titleId}>
        <span className="cw-card-head">
            <span className="cw-card-title" id={titleId}>{item.name}</span>
            <CollectionBadge state={state} />
        </span>
        <span className="cw-card-time">{date ? <><span>{dateLabel}</span> <time dateTime={date}>{dateText}</time></> : dateText}</span>
        <span className="cw-card-meta">
            {item.course && <span className="cw-card-course"><span className="cw-mono">{item.course.code}</span>{item.course.name !== item.name && ` ${item.course.name}`}</span>}
            <span className="cw-card-foot"><span>{issuer}</span><span>{item.rounds.length} 个批次</span></span>
        </span>
    </WorkspaceLink>;
}
function List({ catalog, now, navigate }: { catalog: Catalog; now: number; navigate: Navigate }) {
    const [text, setText] = useState('');
    const search = searchText(text);
    const matches = useMemo(() => catalog.items.filter(item => !search || searchText([item.name, item.description, item.course?.code, item.course?.name, ...item.tags, item.issuer.organizationName].join(' ')).includes(search)), [catalog.items, search]);
    const pinned = pinnedCollections.map(id => matches.find(item => item.id === id)).filter(item => item !== undefined);
    const groups = useMemo(() => groupItems(matches.filter(item => !pinnedCollections.includes(item.id))), [matches]);
    return <div className="cw-list">
            <div className="cw-list-controls">
                <label className="cw-search"><Search size={19} /><span className="cw-sr-only">搜索收集</span><input type="search" value={text} onChange={event => setText(event.target.value)} placeholder="搜索收集、课程编号或标签" /></label>
                {catalog.viewer && <WorkspaceLink className="cw-button" navigate={navigate} href="/forms/?mine=1"><ClipboardList size={17} />我的提交</WorkspaceLink>}
                {catalog.viewer?.isStaff && <a className="cw-button" href="/members/"><UsersRound size={17} />组织与成员</a>}
            </div>
            {pinned.length > 0 && <section className="cw-group" aria-labelledby="cw-pinned-title">
                <div className="cw-group-head"><h2 id="cw-pinned-title">常用收集</h2>{!catalog.viewer && <span>公开 · 登录后填写</span>}</div>
                <div className="cw-card-grid">{pinned.map(item => <CollectionCard key={item.id} item={item} now={now} navigate={navigate} />)}</div>
            </section>}
            {groups.map(([term, items]) => <section className="cw-group" key={term}>
                <div className="cw-group-head"><h2>{semesterLabel(term)}</h2><span>{items.length} 项</span></div>
                <div className="cw-card-grid">{items.map(item => <CollectionCard key={item.id} item={item} now={now} navigate={navigate} />)}</div>
            </section>)}
            {!matches.length && <div className="cw-empty"><ClipboardList size={30} /><h2>{search ? '找不到匹配的收集' : '暂无可查看的收集'}</h2>
                {search ? <button type="button" className="cw-button" onClick={() => setText('')}>清除搜索</button> : !catalog.viewer && <a className="cw-button" href="/login/?next=%2Fforms%2F">登录查看开放给你的收集</a>}</div>}
    </div>;
}

function Mine({ navigate }: { navigate: Navigate }) {
    const [items, setItems] = useState<Submission[]>();
    const [error, setError] = useState('');
    const [attempt, retry] = useState(0);
    const [signedOut, setSignedOut] = useState(false);
    useEffect(() => {
        const controller = new AbortController();
        api<{ items: Submission[] }>('/collections/mine', undefined, { signal: controller.signal }).then(result => {
            if (!controller.signal.aborted) { setItems(result.items); setError(''); }
        }).catch(failure => {
            if (controller.signal.aborted) return;
            if (failure instanceof PlatformError && failure.status === 401) setSignedOut(true);
            else setError(errorText(failure));
        });
        return () => controller.abort();
    }, [attempt]);
    return <section className="cw-mine">
        <WorkspaceLink className="cw-back" href={toCollectionUrl()} navigate={navigate}><ArrowLeft size={17} />全部收集</WorkspaceLink>
        <h1 tabIndex={-1}>我的提交</h1>
        {signedOut ? <a className="cw-button cw-primary" href={collectionLoginUrl()}>登录后查看</a> : error ? <div className="cw-inline"><p className="cw-failure" role="alert">{error}</p><button type="button" className="cw-button" onClick={() => retry(attempt + 1)}>重试</button></div>
            : !items ? <p className="cw-muted" role="status">正在加载提交记录…</p> : !items.length ? <p className="cw-empty">暂无提交记录。</p> : <div className="cw-card-grid cw-receipt-grid">
                {items.map(item => {
                    const titleId = `receipt-title-${item.id}`;
                    return <WorkspaceLink key={item.id} href={`${toCollectionUrl(item.itemId, item.roundId)}&receipt=${encodeURIComponent(item.id)}`} navigate={navigate} className="cw-card" labelledBy={titleId}>
                        <span className="cw-card-head"><span className="cw-card-title" id={titleId}>{item.itemName || '查看收集'}</span>{badge(item.status, item.late)}</span>
                        <time className="cw-card-time" dateTime={item.submittedAt}>{displayTime(item.submittedAt)}</time>
                        <span className="cw-card-meta">{item.roundLabel}</span>
                    </WorkspaceLink>;
                })}</div>}
    </section>;
}

export default function Workspace() {
    const [query, setQuery] = useState(() => new URLSearchParams(location.search));
    const [catalog, setCatalog] = useState<{ version: number; data: Catalog; receivedAt: number }>();
    const [detail, setDetail] = useState<{ id: string; data: Detail; receivedAt: number }>();
    const [failure, setFailure] = useState<{ id: string; message: string; status?: number }>();
    const [editor, setEditor] = useState<EditorMode>();
    const [version, refresh] = useState(0);
    const [notice, setNotice] = useState('');
    const [clockTick, tick] = useState(0);
    const root = useRef<HTMLDivElement>(null);
    const focusedPage = useRef('');
    const authorization = useRef<ReturnType<typeof session> | null>(null);
    const id = query.get('id') || '';
    const mine = !id && query.has('mine');
    const roundId = query.get('round') || '';
    const activeCatalog = catalog?.data;
    const activeDetail = detail?.id === id ? detail.data : undefined;
    const info = activeDetail || activeCatalog;
    const clock = id ? activeDetail && detail : activeCatalog && catalog;
    const now = clock ? clock.data.serverTime + performance.now() - clock.receivedAt : Date.now();
    const timingItems: Item[] = activeDetail ? [activeDetail.item] : id ? [] : activeCatalog?.items || [];
    let nextDeadline = Infinity;
    for (const item of timingItems) {
        if (item.status !== 'published') continue;
        for (const round of item.rounds) {
            const deadline = Date.parse(round.deadline);
            if (deadline > now) nextDeadline = Math.min(nextDeadline, deadline);
        }
    }
    useEffect(() => {
        if (!clock || !Number.isFinite(nextDeadline)) return;
        const remaining = nextDeadline - clock.data.serverTime - performance.now() + clock.receivedAt;
        const timeout = setTimeout(() => tick(value => value + 1), Math.min(2_147_483_647, Math.ceil(remaining)));
        return () => clearTimeout(timeout);
    }, [clock, nextDeadline, clockTick]);
    const needsCatalog = !id && !mine && catalog?.version !== version;
    const currentError = failure?.id === id ? failure : undefined;
    useEffect(() => {
        const onPop = () => { setQuery(new URLSearchParams(location.search)); setEditor(undefined); setNotice(''); };
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, []);
    useEffect(() => {
        if (!needsCatalog) return;
        const controller = new AbortController();
        api<Catalog>('/collections', undefined, { signal: controller.signal }).then(data => {
            if (!controller.signal.aborted) { setCatalog({ version, data, receivedAt: performance.now() }); setFailure(previous => previous?.id === '' ? undefined : previous); }
        }).catch(error => { if (!controller.signal.aborted) setFailure({ id: '', message: errorText(error), status: error instanceof PlatformError ? error.status : undefined }); });
        return () => controller.abort();
    }, [needsCatalog, version]);
    useEffect(() => {
        if (!id) return;
        const controller = new AbortController();
        api<Detail>(itemRoute(id), undefined, { signal: controller.signal }).then(data => {
            if (!controller.signal.aborted) { setDetail({ id, data, receivedAt: performance.now() }); setFailure(previous => previous?.id === id ? undefined : previous); }
        }).catch(error => { if (!controller.signal.aborted) setFailure({ id, message: errorText(error), status: error instanceof PlatformError ? error.status : undefined }); });
        return () => controller.abort();
    }, [id, version]);
    useEffect(() => {
        const page = id ? `/items/${id}` : mine ? 'mine' : 'list';
        if ((!activeDetail && id) || (!mine && !info) || page === focusedPage.current) return;
        if (focusedPage.current) root.current?.querySelector('h1')?.focus({ preventScroll: true });
        focusedPage.current = page;
    }, [activeDetail, id, info, mine]);
    function updateQuery(url: string, replace = false) {
        if (url === location.pathname + location.search) return;
        const next = new URL(url, location.origin);
        const prior = new URLSearchParams(location.search);
        const params = next.searchParams;
        if (replace) history.replaceState(null, '', url);
        else history.pushState(null, '', url);
        setEditor(undefined);
        setNotice('');
        setQuery(new URLSearchParams(location.search));
        if (prior.get('id') !== params.get('id') || prior.has('mine') !== params.has('mine')) window.scrollTo({ top: 0, behavior: 'instant' });
    }
    async function authorize() {
        if (collectionAuthorized()) return;
        authorization.current ||= session(true);
        try {
            if (!await authorization.current) throw new Error('请先登录 StuDev。');
        } catch (error) { authorization.current = null; throw error; }
    }
    const navigate: Navigate = updateQuery;
    const item = activeDetail?.item;
    const round = item && chooseRound(item, roundId);
    return <div className="cw-workspace" ref={root}>
        {!id && !mine && <div className="cw-workspace-toolbar">
            <h1 tabIndex={-1}>收集</h1>
            {activeCatalog?.viewer?.canPublish && <button type="button" className="cw-button cw-primary" onFocus={preloadEditor} onPointerEnter={preloadEditor} onClick={() => setEditor('create')}><Plus size={18} />新建收集</button>}
        </div>}
        {notice && <p role="status" className="cw-notice">{notice}</p>}
        {id && activeDetail ? <Details key={id} detail={activeDetail} round={round} now={now} receiptId={query.get('receipt') || ''} navigate={navigate} version={version} edit={setEditor} authorize={authorize} onChanged={created => {
            if (created) navigate(toCollectionUrl(created));
            refresh(value => value + 1);
        }} onRoundPolicyChanged={(updated: Item<Round>, roundId, policy) => {
            setDetail(previous => previous?.id === id && previous.data.item.revision < updated.revision ? {
                ...previous, data: { ...previous.data, item: {
                    ...previous.data.item, revision: updated.revision, updatedAt: updated.updatedAt,
                    rounds: previous.data.item.rounds.map(round => round.id === roundId ? { ...round, policy } : round),
                } },
            } : previous);
            setCatalog(undefined);
        }} onDeleted={() => {
            setDetail(undefined);
            setCatalog(undefined);
            navigate(toCollectionUrl(), true);
            setNotice('草稿已删除');
            refresh(value => value + 1);
        }} /> : mine ? <Mine navigate={navigate} /> : !id && activeCatalog ? <List catalog={activeCatalog} now={now} navigate={navigate} />
            : currentError ? <div className="cw-empty"><p className="cw-failure" role="alert">{currentError.message}</p><div className="cw-inline"><button type="button" className="cw-button" onClick={() => refresh(version + 1)}>重试</button>
                {id && <WorkspaceLink className="cw-button" href={toCollectionUrl()} navigate={navigate}>返回收集</WorkspaceLink>}
                {(currentError.status === 401 || (id && !activeCatalog?.viewer && currentError.status === 404)) && <a className="cw-button cw-primary" href={collectionLoginUrl(query)}>登录后查看</a>}</div></div>
                : <div className="cw-loading" role="status"><span className="cw-spinner" />{id ? '正在加载收集…' : '正在加载收集列表…'}</div>}
        {editor && <Suspense fallback={<p className="cw-sr-only" role="status">正在加载编辑器…</p>}><CollectionEditor key={editor} mode={editor} catalog={activeCatalog} item={item} currentRound={round} authorize={authorize} onClose={() => setEditor(undefined)} onSaved={(savedId, savedRound) => {
            navigate(toCollectionUrl(savedId, savedRound));
            setEditor(undefined);
            setNotice('收集已保存');
            refresh(version + 1);
        }} /></Suspense>}
    </div>;
}
