import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ClipboardList, Eye, MapPin, MessageSquare, Plus, Search, Upload, UsersRound } from 'lucide-react';
import { api, errorText, PlatformError, session } from '../api';
import { pinnedCollections, semesterLabel } from '../../collections.mjs';
import type { EditorMode } from './Editor';
import { CollectionBadge, Details, WorkspaceLink, type Navigate } from './Detail';
import { badge } from './Submission';
import { chooseRound, collectionLoginUrl, displayTime, itemRoute, itemState, roundState, toCollectionUrl, viewLabels, type Catalog, type Detail, type Item, type Round, type Submission, type View, type WorkspaceView } from './model';

const CollectionEditor = lazy(() => import('./Editor').then(module => ({ default: module.CollectionEditor })));

const searchText = (value: string) => value.normalize('NFKC').toLowerCase().trim();
const pinnedIcons = [MapPin, MessageSquare, Upload];

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

function mineHref(query: URLSearchParams) {
    const params = new URLSearchParams({ mine: '1' });
    const view = query.get('view');
    if (view) params.set('view', view);
    return `/forms/?${params}`;
}

function ItemRow({ item, now, navigate }: { item: Item; now: number; navigate: Navigate }) {
    const state = itemState(item, now);
    const accepting = item.rounds.filter(round => roundState(item, round, now) === state);
    const deadlines = accepting.map(round => round.deadline).filter(Boolean).sort();
    const date = state === 'collecting' ? deadlines[0] : deadlines.at(-1);
    const time = state === 'collecting' ? date ? `截止 ${displayTime(date)}` : '不限时'
        : date && (state === 'makeup' || state === 'expired') ? `${state === 'makeup' ? '原截止' : '截止'} ${displayTime(date)}`
        : item.publishedAt ? displayTime(item.publishedAt).split(' ')[0] : '—';
    return <WorkspaceLink href={toCollectionUrl(item.id)} navigate={navigate} className="cw-item">
        <span className="cw-item-icon"><ClipboardList size={21} /></span>
        <span className="cw-item-body">
            <span className="cw-item-title">{item.name}</span>
            <span className="cw-item-info">
                {(item.course || item.tags.length > 0) && <span className="cw-inline cw-item-tags">{item.course && <span className="cw-tag"><span className="cw-mono">{item.course.code}</span> {item.course.name}</span>}
                    {item.tags.map(tag => <span key={tag} className="cw-tag">{tag}</span>)}</span>}
                <span>{[item.issuer.orgShortName || item.issuer.organizationName, item.issuer.title].filter(Boolean).join(' · ')}</span>
            </span>
        </span>
        <span className="cw-item-time">{time}</span>
        <CollectionBadge state={state} />
        <ArrowRight className="cw-item-arrow" size={17} />
    </WorkspaceLink>;
}

function List({ catalog, now, query, navigate }: { catalog: Catalog; now: number; query: URLSearchParams; navigate: Navigate }) {
    const [text, setText] = useState('');
    const search = searchText(text);
    const matches = useMemo(() => catalog.items.filter(item => !search || searchText([item.name, item.description, item.course?.code, item.course?.name, ...item.tags, item.issuer.organizationName].join(' ')).includes(search)), [catalog.items, search]);
    const pinned = pinnedCollections.flatMap((id, index) => {
        const item = matches.find(value => value.id === id);
        return item ? [{ item, Icon: pinnedIcons[index]! }] : [];
    });
    const groups = useMemo(() => groupItems(matches.filter(item => !pinnedCollections.includes(item.id))), [matches]);
    const canReadMine = catalog.viewer && catalog.view !== 'guest' && catalog.view === catalog.viewer.role;
    return <div className="cw-list">
            <div className="cw-list-controls">
                <label className="cw-search"><Search size={19} /><span className="cw-sr-only">搜索收集</span><input type="search" value={text} onChange={event => setText(event.target.value)} placeholder="搜索收集、课程编号或标签" /></label>
                {canReadMine && <WorkspaceLink className="cw-button" navigate={navigate} href={mineHref(query)}><ClipboardList size={17} />我的提交</WorkspaceLink>}
                {catalog.viewer?.isStaff && catalog.view === catalog.viewer.role && <a className="cw-button" href="/members/"><UsersRound size={17} />组织与成员</a>}
            </div>
            {pinned.length > 0 && <section className="cw-group" aria-labelledby="cw-pinned-title">
                <div className="cw-group-head"><h2 id="cw-pinned-title">常用收集</h2>{catalog.view === 'guest' && <span>公开 · 登录后填写</span>}</div>
                <div className="cw-pinned">{pinned.map(({ item, Icon }) => <WorkspaceLink key={item.id} href={toCollectionUrl(item.id)} navigate={navigate} className="cw-pinned-link">
                    <span className="cw-item-icon"><Icon size={21} /></span><span className="cw-item-title">{item.name}</span><ArrowRight className="cw-item-arrow" size={17} />
                </WorkspaceLink>)}</div>
            </section>}
            {groups.map(([term, items]) => <section className="cw-group" key={term}>
                <div className="cw-group-head"><h2>{semesterLabel(term)}</h2><span>{items.length} 项</span></div>
                <div className="cw-items">{items.map(item => <ItemRow key={item.id} item={item} now={now} navigate={navigate} />)}</div>
            </section>)}
            {!matches.length && <div className="cw-empty"><ClipboardList size={30} /><h2>{search ? '找不到匹配的收集' : '暂无可查看的收集'}</h2>
                {search ? <button type="button" className="cw-button" onClick={() => setText('')}>清除搜索</button> : catalog.view === 'guest' && !catalog.viewer && <a className="cw-button" href="/login/?next=%2Fforms%2F">登录查看开放给你的收集</a>}</div>}
    </div>;
}

function Mine({ info, navigate }: { info: WorkspaceView; navigate: Navigate }) {
    const [items, setItems] = useState<Submission[]>();
    const [error, setError] = useState('');
    const [attempt, retry] = useState(0);
    const allowed = info.viewer && info.view !== 'guest' && info.view === info.viewer.role;
    useEffect(() => {
        if (!allowed) return;
        const controller = new AbortController();
        api<{ items: Submission[] }>('/collections/mine', undefined, { signal: controller.signal }).then(result => {
            if (!controller.signal.aborted) { setItems(result.items); setError(''); }
        }).catch(failure => { if (!controller.signal.aborted) setError(errorText(failure)); });
        return () => controller.abort();
    }, [allowed, attempt]);
    return <section className="cw-mine">
        <WorkspaceLink className="cw-back" href={toCollectionUrl()} navigate={navigate}><ArrowLeft size={17} />全部收集</WorkspaceLink>
        <h1 tabIndex={-1}>我的提交</h1>
        {!allowed ? <p className="cw-muted">在自己的登录视角查看提交记录。</p> : error ? <div className="cw-inline"><p className="cw-failure" role="alert">{error}</p><button type="button" className="cw-button" onClick={() => retry(attempt + 1)}>重试</button></div>
            : !items ? <p className="cw-muted" role="status">正在加载提交记录…</p> : !items.length ? <p className="cw-empty">暂无提交记录。</p> : <div className="cw-items">
                {items.map(item => <WorkspaceLink key={item.id} href={`${toCollectionUrl(item.itemId, item.roundId)}&receipt=${encodeURIComponent(item.id)}`} navigate={navigate} className="cw-item">
                    <span className="cw-item-icon"><ClipboardList size={21} /></span><span className="cw-item-body"><span className="cw-item-title">{item.itemName || '查看收集'}</span><span className="cw-item-info">{item.roundLabel}</span></span>
                    <span className="cw-item-time">{displayTime(item.submittedAt)}</span>{badge(item.status, item.late)}<ArrowRight className="cw-item-arrow" size={17} />
                </WorkspaceLink>)}</div>}
    </section>;
}

export default function Workspace() {
    const [query, setQuery] = useState(() => new URLSearchParams(location.search));
    const [catalog, setCatalog] = useState<{ view: string; version: number; data: Catalog; receivedAt: number }>();
    const [viewControls, setViewControls] = useState<Pick<WorkspaceView, 'viewer' | 'views'>>();
    const [detail, setDetail] = useState<{ key: string; data: Detail; receivedAt: number }>();
    const [failure, setFailure] = useState<{ key: string; message: string; status?: number }>();
    const [editor, setEditor] = useState<EditorMode>();
    const [version, refresh] = useState(0);
    const [notice, setNotice] = useState('');
    const [clockTick, tick] = useState(0);
    const root = useRef<HTMLDivElement>(null);
    const focusedPage = useRef('');
    const authorization = useRef<ReturnType<typeof session> | null>(null);
    const requestedView = query.get('view') || '';
    const id = query.get('id') || '';
    const mine = !id && query.has('mine');
    const roundId = query.get('round') || '';
    const detailKey = `${requestedView}/${id}`;
    const activeCatalog = catalog?.view === requestedView ? catalog.data : undefined;
    const activeDetail = detail?.key === detailKey ? detail.data : undefined;
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
    const viewChoice = info || viewControls;
    const viewValue = info?.view || requestedView || viewChoice?.viewer?.role || 'guest';
    const catalogFresh = !!activeCatalog && catalog?.version === version;
    const needsCatalog = !id && !catalogFresh;
    const currentError = failure?.key === (id ? detailKey : requestedView) ? failure : undefined;
    const viewQuery = requestedView ? `?view=${encodeURIComponent(requestedView)}` : '';
    const browseGuest = () => {
        const params = new URLSearchParams(query);
        params.set('view', 'guest');
        params.delete('mine');
        updateQuery(`/forms/?${params}`);
    };
    useEffect(() => {
        const onPop = () => { setQuery(new URLSearchParams(location.search)); setEditor(undefined); setNotice(''); };
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, []);
    useEffect(() => {
        if (!needsCatalog) return;
        const controller = new AbortController();
        api<Catalog>(`/collections${viewQuery}`, undefined, { signal: controller.signal }).then(data => {
            if (!controller.signal.aborted) { setCatalog({ view: requestedView, version, data, receivedAt: performance.now() }); setViewControls({ viewer: data.viewer, views: data.views }); setFailure(previous => previous?.key === requestedView ? undefined : previous); }
        }).catch(error => { if (!controller.signal.aborted) setFailure({ key: requestedView, message: errorText(error), status: error instanceof PlatformError ? error.status : undefined }); });
        return () => controller.abort();
    }, [needsCatalog, requestedView, viewQuery, version]);
    useEffect(() => {
        if (!id) return;
        const controller = new AbortController();
        api<Detail>(`${itemRoute(id)}${viewQuery}`, undefined, { signal: controller.signal }).then(data => {
            if (!controller.signal.aborted) { setDetail({ key: detailKey, data, receivedAt: performance.now() }); setViewControls({ viewer: data.viewer, views: data.views }); setFailure(previous => previous?.key === detailKey ? undefined : previous); }
        }).catch(error => { if (!controller.signal.aborted) setFailure({ key: detailKey, message: errorText(error), status: error instanceof PlatformError ? error.status : undefined }); });
        return () => controller.abort();
    }, [id, requestedView, detailKey, viewQuery, version]);
    useEffect(() => {
        const page = id ? detailKey : mine ? 'mine' : 'list';
        if ((!activeDetail && id) || !info || page === focusedPage.current) return;
        if (focusedPage.current) root.current?.querySelector('h1')?.focus({ preventScroll: true });
        focusedPage.current = page;
    }, [activeDetail, detailKey, id, info, mine]);
    function updateQuery(url: string, replace = false) {
        if (url === location.pathname + location.search) return;
        const next = new URL(url, location.origin);
        const prior = new URLSearchParams(location.search);
        const params = next.searchParams;
        if ((prior.get('view') || '') !== (params.get('view') || '')) { setDetail(undefined); setCatalog(undefined); }
        if (replace) history.replaceState(null, '', url);
        else history.pushState(null, '', url);
        setEditor(undefined);
        setNotice('');
        setQuery(new URLSearchParams(location.search));
        if (prior.get('id') !== params.get('id') || prior.has('mine') !== params.has('mine')) window.scrollTo({ top: 0, behavior: 'instant' });
    }
    async function authorize() {
        authorization.current ||= session(true);
        try {
            if (!await authorization.current) throw new Error('请先登录 StuDev。');
        } catch (error) { authorization.current = null; throw error; }
    }
    const navigate: Navigate = updateQuery;
    const item = activeDetail?.item;
    const round = item && chooseRound(item, roundId);
    const isPreview = info?.viewer && info.view !== info.viewer.role;
    const showPublish = !id && !mine && info?.viewer?.canPublish && !isPreview;
    return <div className="cw-workspace" ref={root}>
        <div className={`cw-workspace-toolbar${!id && !mine ? ' cw-top' : ''}`}>
            {!id && !mine && <h1 tabIndex={-1}>收集</h1>}
            <div className="cw-inline cw-toolbar-actions">
                {viewChoice && viewChoice.views.length > 1 && <label className="cw-view"><Eye size={17} /><span>视角</span><select value={viewValue} onChange={event => {
                    const next = new URLSearchParams(query);
                    const selectedView = event.target.value as View;
                    if (selectedView === viewChoice.viewer?.role) next.delete('view');
                    else next.set('view', selectedView);
                    if (selectedView === 'guest') next.delete('mine');
                    navigate(`/forms/${next.size ? `?${next}` : ''}`);
                }}>{viewChoice.views.map(view => <option key={view} value={view}>{viewLabels[view]}</option>)}</select></label>}
                {showPublish && <button type="button" className="cw-button cw-primary" onClick={() => setEditor('create')}><Plus size={18} />新建收集</button>}
            </div>
        </div>
        {isPreview && <p className="cw-preview" role="status"><Eye size={17} />正在预览{viewLabels[info.view]}视角</p>}
        {notice && <p role="status" className="cw-notice">{notice}</p>}
        {id && activeDetail ? <Details key={detailKey} detail={activeDetail} round={round} now={now} receiptId={query.get('receipt') || ''} navigate={navigate} version={version} edit={setEditor} authorize={authorize} onChanged={created => {
            if (created) navigate(toCollectionUrl(created));
            refresh(value => value + 1);
        }} onRoundPolicyChanged={(updated: Item<Round>, roundId, policy) => {
            setDetail(previous => previous?.key === detailKey && previous.data.item.revision < updated.revision ? {
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
        }} /> : !id && mine && info ? <Mine key={requestedView} info={info} navigate={navigate} /> : !id && activeCatalog ? <List key={requestedView} catalog={activeCatalog} now={now} query={query} navigate={navigate} />
            : currentError ? <div className="cw-empty"><p className="cw-failure" role="alert">{currentError.message}</p><div className="cw-inline"><button type="button" className="cw-button" onClick={() => refresh(version + 1)}>重试</button>
                {id && <WorkspaceLink className="cw-button" href={toCollectionUrl()} navigate={navigate}>返回收集</WorkspaceLink>}
                {(currentError.status === 401 || (id && !viewChoice?.viewer && (!requestedView || requestedView === 'guest') && currentError.status === 404)) && <a className="cw-button cw-primary" href={collectionLoginUrl(query)}>登录后查看</a>}
                {currentError.status === 401 && requestedView !== 'guest' && <button type="button" className="cw-button" onClick={browseGuest}>以访客身份浏览</button>}</div></div>
                : <div className="cw-loading" role="status"><span className="cw-spinner" />{id ? '正在加载收集…' : '正在加载收集列表…'}</div>}
        {editor && <Suspense fallback={<p className="cw-sr-only" role="status">正在加载编辑器…</p>}><CollectionEditor key={editor} mode={editor} catalog={activeCatalog} item={item} currentRound={round} authorize={authorize} onClose={() => setEditor(undefined)} onSaved={(savedId, savedRound) => {
            navigate(toCollectionUrl(savedId, savedRound));
            setEditor(undefined);
            setNotice('收集已保存');
            refresh(version + 1);
        }} /></Suspense>}
    </div>;
}
