import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, ClipboardList, Eye, ListFilter, Plus, Search, Tags, UsersRound } from 'lucide-react';
import { api, errorText, PlatformError, session } from '../api';
import type { EditorMode } from './Editor';
import { Details, WorkspaceLink, type Navigate } from './Detail';
import { badge } from './Submission';
import { collectionLoginUrl, collectionStatus, displayTime, itemRoute, roundIsOpen, toCollectionUrl, viewLabels, type Catalog, type Detail, type Item, type Submission, type View, type WorkspaceView } from './model';

const CollectionEditor = lazy(() => import('./Editor').then(module => ({ default: module.CollectionEditor })));

type Display = 'time' | 'tags';
type CollectionGroup = { id: string; label: string; items: Item[] };
const month = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', timeZone: 'Asia/Shanghai' });
const searchText = (value: string) => value.normalize('NFKC').toLowerCase().trim();

function tagsFor(item: Item) {
    return [
        ...(item.course ? [{ id: `course:${item.course.id || item.course.code}`, label: `${item.course.name} · ${item.course.code}` }] : []),
        ...item.tags.map(tag => ({ id: `tag:${tag}`, label: tag })),
    ];
}

function groupItems(items: Item[], display: Display) {
    const groups = new Map<string, CollectionGroup>();
    const sorted = [...items].sort((left, right) => (right.publishedAt || right.updatedAt).localeCompare(left.publishedAt || left.updatedAt) || right.id.localeCompare(left.id));
    for (const item of sorted) {
        const date = item.publishedAt || item.updatedAt;
        const dateGroup = Number.isFinite(Date.parse(date)) ? month.format(new Date(date)) : '时间未设置';
        const tags = tagsFor(item);
        const buckets = display === 'time' ? [{ id: item.term || dateGroup, label: item.termLabel || dateGroup }]
            : tags.length ? tags : [{ id: 'untagged', label: '未加标签' }];
        for (const bucket of buckets) {
            const group = groups.get(bucket.id) || { ...bucket, items: [] };
            group.items.push(item);
            groups.set(bucket.id, group);
        }
    }
    return [...groups.values()];
}

function mineHref(query: URLSearchParams) {
    const params = new URLSearchParams({ mine: '1' });
    const view = query.get('view');
    if (view) params.set('view', view);
    return `/forms/?${params}`;
}

function ItemRow({ item, navigate }: { item: Item; navigate: Navigate }) {
    const open = item.rounds.filter(round => round.open ?? roundIsOpen(item, round));
    const next = [...open].filter(round => round.deadline && Date.parse(round.deadline) > Date.now()).sort((a, b) => a.deadline.localeCompare(b.deadline))[0];
    const received = item.rounds.filter(round => round.myStatus && round.myStatus !== 'missing');
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
        <span className="cw-item-time">{next ? `截止 ${displayTime(next.deadline)}` : open.length ? open.some(round => !round.deadline) ? '不限时' : '可迟交' : item.publishedAt ? displayTime(item.publishedAt).split(' ')[0] : '—'}</span>
        <span className={`cw-status cw-status-${item.status === 'published' && !open.length ? 'closed' : item.status}`}>{item.status === 'published' && !open.length ? '已截止' : received.length && received.length === item.rounds.length && !item.canManage ? '已提交' : collectionStatus[item.status]}</span>
        <ArrowRight className="cw-item-arrow" size={17} />
    </WorkspaceLink>;
}

function List({ catalog, query, navigate, display, setDisplay }: { catalog: Catalog; query: URLSearchParams; navigate: Navigate; display: Display; setDisplay: (value: Display) => void }) {
    const [text, setText] = useState('');
    const [showArchived, setShowArchived] = useState(false);
    const [term, setTerm] = useState('');
    const [tag, setTag] = useState('');
    const search = searchText(text);
    const manageable = catalog.items.some(item => item.canManage);
    const groups = useMemo(() => groupItems(catalog.items.filter(item => (item.status === 'archived') === showArchived
        && (!search || searchText([item.name, item.description, item.course?.code, item.course?.name, ...item.tags, item.issuer.organizationName].join(' ')).includes(search))), display), [catalog.items, display, showArchived, search]);
    const groupFilter = display === 'time' ? term : tag;
    const currentGroup = groups.some(group => group.id === groupFilter) ? groupFilter : '';
    const canReadMine = catalog.viewer && catalog.view !== 'guest' && catalog.view === catalog.viewer.role;
    return <div className="cw-catalog">
        <aside className="cw-sidebar">
            <section><div className="cw-side-label">分类</div><div className="cw-side-select" role="group" aria-label="收集分类">
                <button type="button" className="cw-side-link" aria-pressed={display === 'time'} onClick={() => setDisplay('time')}><CalendarDays size={18} />按时间</button>
                <button type="button" className="cw-side-link" aria-pressed={display === 'tags'} onClick={() => setDisplay('tags')}><Tags size={18} />按标签</button>
            </div></section>
            {canReadMine && <section><WorkspaceLink className="cw-side-link" navigate={navigate} href={mineHref(query)}><ClipboardList size={18} />我的提交</WorkspaceLink></section>}
            {catalog.viewer?.isStaff && catalog.view === catalog.viewer.role && <section><a className="cw-side-link" href="/members/"><UsersRound size={18} />组织与成员</a></section>}
        </aside>
        <div className="cw-list">
            <div className="cw-list-controls">
                <label className="cw-search"><Search size={19} /><span className="cw-sr-only">搜索收集</span><input type="search" value={text} onChange={event => setText(event.target.value)} placeholder="搜索收集、课程编号或标签" /></label>
                <label className="cw-list-select"><ListFilter size={17} /><span className="cw-sr-only">{display === 'time' ? '按学期或月份筛选' : '按标签筛选'}</span>
                    <select value={currentGroup} onChange={event => (display === 'time' ? setTerm : setTag)(event.target.value)}>
                        <option value="">{display === 'time' ? '所有时间' : '所有标签'}</option>
                        {groups.map(group => <option key={group.id} value={group.id}>{group.label}</option>)}
                    </select></label>
                {manageable && catalog.items.some(item => item.status === 'archived') && <button type="button" className="cw-button" aria-pressed={showArchived} onClick={() => setShowArchived(!showArchived)}>{showArchived ? '返回收集列表' : '查看归档'}</button>}
            </div>
            {groups.length ? groups.filter(group => !currentGroup || currentGroup === group.id).map(group => <section className="cw-group" key={group.id}>
                <div className="cw-group-head"><h2>{group.label}</h2><span>{group.items.length} 项</span></div>
                <div className="cw-items">{group.items.map(item => <ItemRow key={item.id} item={item} navigate={navigate} />)}</div>
            </section>) : <div className="cw-empty"><ClipboardList size={30} /><h2>{search ? '找不到匹配的收集' : showArchived ? '暂无归档收集' : '暂无可查看的收集'}</h2>
                {search ? <button type="button" className="cw-button" onClick={() => setText('')}>清除搜索</button> : catalog.view === 'guest' && !catalog.viewer && <a className="cw-button" href="/login/?next=%2Fforms%2F">登录查看开放给你的收集</a>}</div>}
        </div>
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
                    <span className="cw-item-time">{displayTime(item.submittedAt)}</span>{badge(item.status)}<ArrowRight className="cw-item-arrow" size={17} />
                </WorkspaceLink>)}</div>}
    </section>;
}

export default function Workspace() {
    const [query, setQuery] = useState(() => new URLSearchParams(location.search));
    const [catalog, setCatalog] = useState<{ view: string; version: number; data: Catalog }>();
    const [viewControls, setViewControls] = useState<Pick<WorkspaceView, 'viewer' | 'views'>>();
    const [detail, setDetail] = useState<{ key: string; data: Detail }>();
    const [failure, setFailure] = useState<{ key: string; message: string; status?: number }>();
    const [editor, setEditor] = useState<EditorMode>();
    const [version, refresh] = useState(0);
    const [display, setDisplay] = useState<Display>('time');
    const [notice, setNotice] = useState('');
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
            if (!controller.signal.aborted) { setCatalog({ view: requestedView, version, data }); setViewControls({ viewer: data.viewer, views: data.views }); setFailure(previous => previous?.key === requestedView ? undefined : previous); }
        }).catch(error => { if (!controller.signal.aborted) setFailure({ key: requestedView, message: errorText(error), status: error instanceof PlatformError ? error.status : undefined }); });
        return () => controller.abort();
    }, [needsCatalog, requestedView, viewQuery, version]);
    useEffect(() => {
        if (!id) return;
        const controller = new AbortController();
        api<Detail>(`${itemRoute(id)}${viewQuery}`, undefined, { signal: controller.signal }).then(data => {
            if (!controller.signal.aborted) { setDetail({ key: detailKey, data }); setViewControls({ viewer: data.viewer, views: data.views }); setFailure(previous => previous?.key === detailKey ? undefined : previous); }
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
    const round = item?.rounds.find(value => value.id === roundId) || item?.rounds.find(value => value.open) || item?.rounds[0];
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
        {id && activeDetail ? <Details key={detailKey} detail={activeDetail} chosenRound={roundId} receiptId={query.get('receipt') || ''} navigate={navigate} version={version} edit={setEditor} authorize={authorize} onChanged={created => {
            if (created) navigate(toCollectionUrl(created));
            refresh(version + 1);
        }} /> : !id && mine && info ? <Mine key={requestedView} info={info} navigate={navigate} /> : !id && activeCatalog ? <List key={requestedView} catalog={activeCatalog} query={query} navigate={navigate} display={display} setDisplay={setDisplay} />
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
