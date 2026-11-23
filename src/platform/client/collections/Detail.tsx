import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarClock, ClipboardList, Copy, Download, FileArchive, Pencil, Plus, Settings2, Trash2, Undo2, UsersRound } from 'lucide-react';
import { api, errorText } from '../api';
import { collectionProgress, pinnedCollections, semesterLabel } from '../../collections.mjs';
import ExportDialog from './ExportDialog';
import './Board.css';
import { GroupProgress, ParticipantProgress, ProgressSummary } from './Progress';
import { AnswerForm, ReceiptSummary, badge } from './Submission';
import { Dialog } from './Dialog';
import { collectionLoginUrl, collectionStatus, comparePeople, displayTime, groupBoardRows, itemRoute, itemState, matchesBoardFilter, roundState, roundRoute, studentKey, submissionRoute, toCollectionUrl, type BoardTableRow, type Detail as CollectionDetail, type Item, type Policy, type Round, type RoundBoardData, type Submission } from './model';
import type { EditorMode } from './Editor';

export type Navigate = (url: string, replace?: boolean) => void;

export function CollectionBadge({ state }: { state: keyof typeof collectionStatus }) {
    return <span className={`cw-status cw-status-${state}`}>{collectionStatus[state]}</span>;
}

export function WorkspaceLink({ href, navigate, children, className, current, labelledBy }: { href: string; navigate: Navigate; children: React.ReactNode; className?: string; current?: boolean; labelledBy?: string }) {
    return <a href={href} className={className} aria-labelledby={labelledBy} aria-current={current ? 'page' : undefined} onClick={event => {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(href);
    }}>{children}</a>;
}

function RoundBoard({ detail, round, version, authorize, refresh }: {
    detail: CollectionDetail; round: Round; version: number; authorize: () => Promise<void>; refresh: () => void;
}) {
    const path = roundRoute(detail.item.id, round.id);
    const initial = detail.initialBoard?.roundId === round.id ? detail.initialBoard.data : undefined;
    const [results, setResults] = useState<RoundBoardData | undefined>(initial);
    const [loadError, setLoadError] = useState('');
    const [actionError, setActionError] = useState('');
    const [filter, setFilter] = useState('all');
    const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
    const [flat, setFlat] = useState(false);
    const [opened, setOpened] = useState('');
    const [current, setCurrent] = useState<Submission>();
    const [viewError, setViewError] = useState('');
    const [viewAttempt, retryView] = useState(0);
    const [limit, setLimit] = useState(25);
    const [exporting, setExporting] = useState(false);
    const [message, setMessage] = useState('');
    const [attempt, retry] = useState(0);
    useEffect(() => {
        if (initial && !attempt) {
            setResults(initial);
            setLoadError('');
            return;
        }
        const controller = new AbortController();
        api<RoundBoardData>(`${path}/submissions`, undefined, { signal: controller.signal }).then(result => {
            if (!controller.signal.aborted) { setResults(result); setLoadError(''); }
        }).catch(error => {
            if (!controller.signal.aborted) setLoadError(errorText(error));
        });
        return () => controller.abort();
    }, [initial, path, version, attempt]);

    const selected = detail.item.targetMode === 'selected';
    const rows = useMemo(() => {
        if (!results) return [];
        const roster = new Map(detail.item.recipients?.map(person => [studentKey(person.studentId), person]));
        const people = new Map(results.board.filter(person => person.studentId).map(person => [studentKey(person.studentId), person]));
        const records: BoardTableRow[] = results.items.map(submission => {
            const student = studentKey(submission.studentId);
            const recipient = roster.get(student);
            const person = people.get(student);
            return {
                id: submission.id,
                studentId: submission.studentId || undefined,
                personId: submission.personId,
                name: person?.name || submission.studentName || '填写者',
                groupId: person?.orgId || recipient?.groupId || '',
                groupLabel: person?.orgLabel || recipient?.groupLabel || (selected ? '待核对' : ''),
                status: submission.complete === false ? 'uploading' : submission.status,
                complete: submission.complete,
                hasFiles: submission.hasFiles,
                late: submission.complete !== false && submission.late,
                submissionId: submission.id,
                submittedAt: submission.submittedAt,
                expected: !!recipient,
            };
        });
        if (!selected) return records.sort(comparePeople);

        const latest = new Map<string, BoardTableRow>();
        for (const record of records) {
            if (!record.expected) continue;
            const student = studentKey(record.studentId);
            const previous = latest.get(student);
            // Prefer an effective receipt. A partial imported record still has
            // a detail page, while it leaves the recipient on the missing list.
            const effective = matchesBoardFilter(record, 'submitted');
            const previousEffective = previous && matchesBoardFilter(previous, 'submitted');
            if (!previous || (effective && !previousEffective)
                || (effective === previousEffective && (previous.submittedAt || '') < (record.submittedAt || ''))) {
                latest.set(student, record);
            }
        }
        const expectedRows: BoardTableRow[] = [...roster].map(([student, recipient]) => {
            const person = people.get(student);
            const record = latest.get(student);
            const status = person?.statuses[round.id] || 'missing';
            return {
                ...record,
                id: `person-${student}`,
                studentId: recipient.studentId,
                name: recipient.name,
                groupId: person?.orgId || recipient.groupId || '',
                groupLabel: person?.orgLabel || recipient.groupLabel || '待核对',
                status,
                late: status !== 'missing' && !!record?.late,
                expected: true,
            };
        });
        if (round.submissionMode === 'replace') {
            return [...expectedRows, ...records.filter(record => !record.expected)].sort(comparePeople);
        }
        const waiting = expectedRows.filter(row => row.status === 'missing')
            .map(row => ({ ...row, submissionId: undefined, submittedAt: undefined }));
        return [...records, ...waiting].sort(comparePeople);
    }, [detail.item.recipients, results, round.id, round.submissionMode, selected]);

    const groups = useMemo(() => groupBoardRows(rows), [rows]);
    const groupProgress = results?.progress.groups || [];
    const hasGroups = groupProgress.some(group => !!group.id);
    const activeGroup = groupProgress.find(group => group.id === activeGroupId);
    const scopeGroupId = activeGroup?.id ?? null;
    const scopedRows = groups.find(group => group.id === scopeGroupId)?.rows ?? rows;
    const stats = activeGroup ?? results?.progress;
    const groupedView = hasGroups && !flat && !activeGroup;
    const orderedRows = groupedView ? groups.flatMap(group => group.rows) : scopedRows;
    const visible = orderedRows.filter(row => matchesBoardFilter(row, filter));
    const visibleSet = new Set(visible.slice(0, limit).map(row => row.id));
    const tableGroups = groupedView
        ? groups.map(group => ({ id: group.id, label: group.label, rows: group.rows.filter(row => visibleSet.has(row.id)) })).filter(group => group.rows.length)
        : [{ id: '', label: '', rows: visible.slice(0, limit) }];
    const missing = useMemo(() => collectionProgress(scopedRows, selected).missingRows, [scopedRows, selected]);

    useEffect(() => {
        if (!opened) return;
        const controller = new AbortController();
        api<{ submission: Submission }>(submissionRoute(opened), undefined, { signal: controller.signal })
            .then(result => { if (!controller.signal.aborted) { setCurrent(result.submission); setViewError(''); } })
            .catch(error => { if (!controller.signal.aborted) setViewError(errorText(error)); });
        return () => controller.abort();
    }, [opened, viewAttempt, version]);

    function chooseGroup(id: string | null) {
        setActiveGroupId(id);
        setLimit(25);
        setMessage('');
        setActionError('');
    }

    async function copyMissing() {
        setActionError('');
        try {
            await navigator.clipboard.writeText(missing.map(row => `${row.studentId}\t${row.name}`).join('\n'));
            setMessage(activeGroup ? `已复制${activeGroup.label}的未交名单` : '已复制全部未交名单');
        } catch (error) {
            setActionError(errorText(error));
        }
    }

    return <section className="cw-board">
        <ProgressSummary label={activeGroup ? `${activeGroup.label}统计` : '批次汇总'} selected={selected} counts={stats} />
        {hasGroups && <div className="cw-board-groups">
            <div className="cw-board-group-head"><h3>按组织查看</h3>
                <button type="button" className="cw-button cw-board-all" aria-pressed={scopeGroupId === null} onClick={() => chooseGroup(null)}>全部组织</button>
            </div>
            <div className="cw-board-group-list">{groupProgress.map(group => <button type="button" className="cw-board-group-card" key={group.id}
                aria-pressed={scopeGroupId === group.id} onClick={() => chooseGroup(group.id)}>
                <GroupProgress group={group} />
            </button>)}</div>
        </div>}
        <div className="cw-panel">
            <div className="cw-board-head"><h2>{activeGroup ? `${activeGroup.label} · 提交记录` : '提交记录'}</h2><div className="cw-inline">
                {selected && missing.length > 0 && <button type="button" className="cw-button" onClick={copyMissing}><Copy size={16} />复制未交名单</button>}
                <a className="cw-button" href={`/api/platform${path}/csv`} title="下载整个批次的提交记录"><Download size={16} />{hasGroups ? '全批次 CSV' : '导出 CSV'}</a>
                {results && (rows.length > 0 || selected) && <button type="button" className="cw-button cw-primary" onClick={() => setExporting(true)}><FileArchive size={16} />打包附件</button>}
            </div></div>
            <div className="cw-board-controls">
                <label>提交状态 <select value={filter} onChange={event => { setFilter(event.target.value); setLimit(25); }}>
                    <option value="all">全部状态</option><option value="submitted">已提交</option><option value="late">补交</option>{selected && <option value="missing">未提交</option>}
                    {round.requireReview && <><option value="pending_review">待审核</option><option value="accepted">已通过</option><option value="rejected">已退回</option></>}
                </select></label>
                {hasGroups && !activeGroup && <label>查看方式 <select value={flat ? 'flat' : 'grouped'} onChange={event => { setFlat(event.target.value === 'flat'); setLimit(25); }}>
                    <option value="grouped">按组织分组</option><option value="flat">按学号平铺</option>
                </select></label>}
                {message && <span role="status">{message}</span>}{actionError && <span role="alert" className="cw-failure">{actionError}</span>}
            </div>
            {loadError && <div className="cw-inline"><p className="cw-failure" role="alert">{loadError}</p><button type="button" className="cw-button" onClick={() => retry(attempt + 1)}>重试</button></div>}
            {visible.length ? <div className="cw-table-scroll"><table><thead><tr><th scope="col">填写者</th><th scope="col">状态</th><th scope="col">提交时间</th><th scope="col"><span className="cw-sr-only">操作</span></th></tr></thead>
                {tableGroups.map(group => <tbody key={group.id}>
                    {group.label && <tr className="cw-board-group-label"><th colSpan={4} scope="rowgroup">{group.label}</th></tr>}
                    {group.rows.map(row => <tr key={row.id}><td><b>{row.name}</b>{row.studentId && <small className="cw-mono">{row.studentId}</small>}{flat && row.groupLabel && <small>{row.groupLabel}</small>}</td>
                        <td>{badge(row.status, row.late)}</td><td>{row.submittedAt ? displayTime(row.submittedAt) : '—'}</td>
                        <td>{row.submissionId && <button type="button" className="cw-plain" aria-haspopup="dialog" onClick={() => { setCurrent(undefined); setViewError(''); setOpened(row.submissionId!); }}>查看</button>}</td></tr>)}
                </tbody>)}</table></div>
                : <p className="cw-muted cw-board-empty">{results ? '当前没有符合条件的记录。' : loadError ? '提交记录暂不可用。' : '正在加载提交记录…'}</p>}
            {visible.length > limit && <button type="button" className="cw-button cw-more" onClick={() => setLimit(limit + 25)}>显示更多（{limit}/{visible.length}）</button>}
            {opened && <Dialog title="提交详情" onClose={() => setOpened('')} wide><div className="cw-board-receipt">
                {current ? <ReceiptSummary key={current.id} submission={current} manage={round.requireReview} authorize={authorize} onChanged={refresh} />
                    : viewError ? <><p role="alert" className="cw-failure">{viewError}</p><button type="button" className="cw-button" onClick={() => { setViewError(''); retryView(value => value + 1); }}>重试</button></>
                    : <p className="cw-muted" role="status">正在加载提交内容…</p>}
            </div></Dialog>}
            {exporting && <ExportDialog path={path} title={detail.item.name} round={round} rows={rows} activeGroupId={scopeGroupId}
                activeFilter={filter} selected={selected} onClose={() => setExporting(false)} />}
        </div>
    </section>;
}

export function Details({ detail, round, now, receiptId, version, navigate, edit, authorize, onChanged, onRoundPolicyChanged, onDeleted }: {
    detail: CollectionDetail; round?: Round; now: number; receiptId: string; version: number; navigate: Navigate; edit: (mode: EditorMode) => void;
    authorize: () => Promise<void>; onChanged: (id?: string) => void; onRoundPolicyChanged: (updated: Item<Round>, roundId: string, policy: Policy) => void; onDeleted: () => void;
}) {
    const { item, viewer } = detail;
    const [panel, setPanel] = useState<'board' | 'fill'>(item.canManage && !receiptId ? 'board' : 'fill');
    const [saved, setSaved] = useState<Record<string, Submission>>({});
    const [editingRound, setEditingRound] = useState('');
    const [savedNotice, setSavedNotice] = useState<{ roundId: string; message: string }>();
    const [failure, setFailure] = useState('');
    const [duplicating, setDuplicating] = useState(false);
    const [confirm, setConfirm] = useState(false);
    const [changing, setChanging] = useState(false);
    const [changeError, setChangeError] = useState('');
    const [timingUpdate, setTimingUpdate] = useState<{ roundId: string; busy: boolean; error?: string }>();
    const manage = item.canManage;
    const participantProgress = !manage && !!item.canViewProgress;
    const draft = item.status === 'draft';
    const pinned = pinnedCollections.includes(item.id);
    const actionLabel = draft ? '删除草稿' : '取消发布';
    const state = round ? roundState(item, round, now) : 'closed';
    const deadlineLabel = round?.deadline ? displayTime(round.deadline) : '未设截止时间';
    const accepts = state === 'collecting' || state === 'makeup';
    const timingAction = state === 'makeup' ? { label: '停止补交', policy: 'strict' }
        : state === 'expired' ? { label: '开放补交', policy: 'allow-late' }
        : state === 'collecting' ? { label: '停止收集', policy: 'closed' }
        : { label: '恢复收集', policy: 'strict' };
    const canSubmit = !!viewer && accepts && (item.targetMode === 'open' || item.inRecipients);
    const byId = new Map(detail.mySubmissions.filter(submission => submission.roundId === round?.id).map(submission => [submission.id, submission]));
    for (const submission of Object.values(saved)) {
        if (submission.roundId === round?.id && (byId.get(submission.id)?.revision ?? -1) < submission.revision) byId.set(submission.id, submission);
    }
    const own = [...byId.values()].sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
    const prior = round?.submissionMode === 'replace' ? own[0] : undefined;
    const displayedOwn = [...own].sort((left, right) => Number(right.id === receiptId) - Number(left.id === receiptId));
    const showFill = panel === 'fill' || (!manage && !participantProgress);
    const limitReached = !!round && round.submissionMode === 'multiple' && own.length >= round.maxPerUser;
    const writing = editingRound === round?.id;
    const showComposer = !own.length || writing;
    const loginUrl = !viewer && accepts ? collectionLoginUrl() : undefined;
    let submitNote = '';
    if (!accepts) submitNote = state === 'expired' ? '这个批次已截止。' : '这个批次暂时不能提交。';
    else if (viewer && !canSubmit) submitNote = '只有指定成员可以填写。';
    else if (limitReached) submitNote = `你已交满 ${round?.maxPerUser} 份。`;
    else if (state === 'makeup') submitNote = canSubmit ? '本次提交将记为补交。' : '补交已开放，登录后可填写。';
    async function changeTiming() {
        if (!round || timingUpdate?.busy) return;
        setTimingUpdate({ roundId: round.id, busy: true });
        try {
            await authorize();
            const { item: updated } = await api<{ item: Item<Round> }>(roundRoute(item.id, round.id), { revision: item.revision, policy: timingAction.policy });
            const changed = updated.rounds.find(value => value.id === round.id);
            if (changed) onRoundPolicyChanged(updated, round.id, changed.policy);
            setTimingUpdate(undefined);
        } catch (error) { setTimingUpdate({ roundId: round.id, busy: false, error: errorText(error) }); }
    }
    async function duplicate() {
        setFailure('');
        setDuplicating(true);
        try {
            await authorize();
            const { item: copy } = await api<{ item: { id: string } }>(`${itemRoute(item.id)}/duplicate`, {});
            onChanged(copy.id);
        } catch (error) { setFailure(errorText(error)); }
        finally { setDuplicating(false); }
    }
    async function changePublication() {
        setChangeError('');
        setChanging(true);
        try {
            await authorize();
            const path = itemRoute(item.id);
            const body = { revision: item.revision };
            if (draft) {
                await api(path, body, { method: 'DELETE' });
                onDeleted();
            } else {
                await api(`${path}/unpublish`, body);
                setConfirm(false);
                onChanged();
            }
        } catch (error) { setChangeError(errorText(error)); }
        finally { setChanging(false); }
    }
    return <>
        <WorkspaceLink className="cw-back" href={toCollectionUrl()} navigate={navigate}><ArrowLeft size={17} />全部收集</WorkspaceLink>
        <div className="cw-detail-head">
            <div className="cw-detail-title"><div className="cw-inline cw-meta-line">
                <CollectionBadge state={itemState(item, now)} />
                <span>{semesterLabel(item.term)}</span>
                {item.course && <span className="cw-tag"><span className="cw-mono">{item.course.code}</span> {item.course.name}</span>}
                {item.tags.map(tag => <span className="cw-tag" key={tag}>{tag}</span>)}
            </div><h1 tabIndex={-1}>{item.name}</h1><p className="cw-muted">{[item.issuer.organizationName, item.issuer.title, item.issuer.name].filter(Boolean).join(' · ')}</p></div>
            {manage && <div className="cw-inline cw-detail-actions"><button type="button" className="cw-button" onClick={() => edit('item')}><Settings2 size={17} />收集设置</button>
                <button type="button" className="cw-button" disabled={duplicating} onClick={duplicate}><Copy size={16} />{duplicating ? '复制中…' : '复制为草稿'}</button>
                {!pinned && <button type="button" className={draft ? 'cw-button cw-danger' : 'cw-button'} onClick={() => { setChangeError(''); setConfirm(true); }}>
                    {draft ? <Trash2 size={16} /> : <Undo2 size={16} />}{actionLabel}
                </button>}</div>}
        </div>
        {failure && <p className="cw-failure" role="alert">{failure}</p>}
        {item.description && <p className="cw-description">{item.description}</p>}
        <div className="cw-detail-layout">
            <aside className="cw-sidebar cw-detail-sidebar">
                <section><div className="cw-side-label"><ClipboardList size={17} />填写批次</div><nav aria-label="填写批次">
                    {item.rounds.map(value => <WorkspaceLink className="cw-side-link" key={value.id} href={toCollectionUrl(item.id, value.id)} navigate={navigate} current={round?.id === value.id}>
                        <span>{value.label}</span>{(value.myStatus && value.myStatus !== 'missing' || Object.values(saved).some(record => record.roundId === value.id)) && <span className="cw-dot" aria-label="已有提交" />}
                    </WorkspaceLink>)}
                </nav>{manage && <button type="button" className="cw-button cw-side-add" onClick={() => edit('new-round')}><Plus size={16} />新增批次</button>}</section>
            </aside>
            {round && <div className="cw-round">
                <section className="cw-round-head cw-panel">
                    <div className="cw-round-title"><h2>{round.label}</h2><CollectionBadge state={state} /></div><div className="cw-round-facts">
                        <div><span><CalendarClock size={16} />截止时间</span>{manage
                            ? <button type="button" className="cw-fact-action" aria-label={`修改截止时间，当前 ${deadlineLabel}`} onClick={() => edit('deadline')}>{deadlineLabel}<Pencil size={15} /></button>
                            : <strong>{deadlineLabel}</strong>}</div>
                        <div><span><UsersRound size={16} />填写对象</span>{manage && !pinned
                            ? <button type="button" className="cw-fact-action" aria-label="编辑收集的填写对象，各批次共用" onClick={() => edit('recipients')}>{item.targetMode === 'selected' ? `${item.recipientCount} 人` : '登录后可填写'}<Pencil size={15} /></button>
                            : <strong>{item.targetMode === 'selected' ? '指定成员' : '登录后可填写'}</strong>}</div>
                    </div>
                    {manage && <div className="cw-inline">
                        {item.status === 'published' && <button type="button" className="cw-button" disabled={timingUpdate?.busy} onClick={changeTiming}>{timingUpdate?.busy && timingUpdate.roundId === round.id ? '正在处理…' : timingAction.label}</button>}
                        <button type="button" className="cw-button" onClick={() => edit('round')}>编辑批次</button>
                    </div>}
                    {timingUpdate?.roundId === round.id && timingUpdate.error && <p className="cw-failure" role="alert">{timingUpdate.error}</p>}
                </section>
                {(manage || participantProgress) && <div className="cw-segment" role="group" aria-label="批次内容">
                    {manage && <button type="button" aria-pressed={panel === 'board'} onClick={() => setPanel('board')}>提交记录</button>}
                    <button type="button" aria-pressed={panel === 'fill'} onClick={() => setPanel('fill')}>{!manage && displayedOwn.length ? '我的提交' : canSubmit ? '填写表单' : '查看表单'}</button>
                    {participantProgress && <button type="button" aria-pressed={panel === 'board'} onClick={() => setPanel('board')}>提交进度</button>}
                </div>}
                {showFill ? <div className="cw-panel cw-fill-panel">
                    {displayedOwn.length > 0 && <>
                        <h2>我的提交</h2>
                        {savedNotice?.roundId === round.id && <p role="status">{savedNotice.message}</p>}
                        {displayedOwn.map(record => <ReceiptSummary key={record.id} submission={record} manage={false}
                            editable={round.submissionMode === 'multiple' && canSubmit && round.allowEdit} authorize={authorize} onChanged={onChanged} />)}
                    </>}
                    {!showComposer && canSubmit && !limitReached && <button type="button" className="cw-button" onClick={() => setEditingRound(round.id)}>{prior ? '更新提交' : '再交一份'}</button>}
                    {showComposer && <>
                        <h2>{prior ? '更新提交' : '填写内容'}</h2>
                        <AnswerForm key={`${round.id}/${prior?.id || ''}`} round={round} path={roundRoute(item.id, round.id)} replacing={prior} canSubmit={canSubmit && !limitReached}
                            focus={writing} makeup={state === 'makeup'} loginUrl={loginUrl} authorize={authorize} onDismiss={writing ? () => setEditingRound('') : undefined} onSaved={submission => {
                                setSaved(previous => ({ ...previous, [submission.id]: submission }));
                                setSavedNotice({ roundId: round.id, message: prior ? '已更新提交。' : submission.late ? '补交成功。' : '提交成功。' });
                                setEditingRound('');
                            }} />
                    </>}
                    {submitNote && <p className="cw-muted">{submitNote}</p>}
                </div> : manage ? <RoundBoard key={round.id} detail={detail} round={round} version={version} authorize={authorize} refresh={() => onChanged()} />
                    : <ParticipantProgress key={round.id} path={roundRoute(item.id, round.id)} selected={item.targetMode === 'selected'} version={version} />}
            </div>}
        </div>
        {confirm && <Dialog title={actionLabel} busy={changing} onClose={() => setConfirm(false)}>
            <div className="cw-dialog-form">
                <p>{draft ? '删除后无法恢复。有提交记录的草稿会保留。' : '收集将撤回为草稿并停止接收新提交。已提交的人仍可在「我的提交」中查看自己的记录。'}</p>
                {changeError && <p className="cw-failure" role="alert">{changeError}</p>}
                <div className="cw-dialog-actions">
                    <button type="button" className="cw-button" disabled={changing} onClick={() => setConfirm(false)}>返回</button>
                    <button type="button" className="cw-button cw-danger" disabled={changing} onClick={changePublication}>{changing ? '正在处理…' : actionLabel}</button>
                </div>
            </div>
        </Dialog>}
    </>;
}
