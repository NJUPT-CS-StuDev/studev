import { useEffect, useState } from 'react';
import { ArrowLeft, CalendarClock, ClipboardList, Copy, Download, FileArchive, Pencil, Plus, Settings2, Trash2, Undo2, UsersRound } from 'lucide-react';
import { api, errorText } from '../api';
import { pinnedCollections, semesterLabel } from '../../collections.mjs';
import { downloadZip } from './attachments';
import { AnswerForm, ReceiptSummary, badge } from './Submission';
import { Dialog } from './Dialog';
import { collectionLoginUrl, collectionStatus, displayTime, itemRoute, roundIsOpen, roundRoute, toCollectionUrl, type Detail as CollectionDetail, type Round, type RoundBoardData, type Submission, type SubmissionStatus } from './model';
import type { EditorMode } from './Editor';

export type Navigate = (url: string, replace?: boolean) => void;

export function WorkspaceLink({ href, navigate, children, className, current }: { href: string; navigate: Navigate; children: React.ReactNode; className?: string; current?: boolean }) {
    return <a href={href} className={className} aria-current={current ? 'page' : undefined} onClick={event => {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(href);
    }}>{children}</a>;
}

function RoundBoard({ detail, round, version, authorize, refresh }: {
    detail: CollectionDetail; round: Round; version: number; authorize: () => Promise<void>; refresh: () => void;
}) {
    const path = roundRoute(detail.item.id, round.id);
    const [results, setResults] = useState<RoundBoardData>();
    const [loadError, setLoadError] = useState('');
    const [actionError, setActionError] = useState('');
    const [filter, setFilter] = useState('all');
    const [opened, setOpened] = useState('');
    const [limit, setLimit] = useState(25);
    const [transfer, setTransfer] = useState<AbortController>();
    const [message, setMessage] = useState('');
    const [attempt, retry] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        api<RoundBoardData>(`${path}/submissions`, undefined, { signal: controller.signal }).then(result => {
            if (!controller.signal.aborted) { setResults(result); setLoadError(''); }
        }).catch(error => { if (!controller.signal.aborted) setLoadError(errorText(error)); });
        return () => controller.abort();
    }, [path, version, attempt]);
    useEffect(() => () => transfer?.abort(), [transfer]);
    const submissions = results?.items || [];
    const byStudent = new Map<string, Submission>();
    for (const record of submissions) {
        if (!record.studentId) continue;
        const current = byStudent.get(record.studentId);
        if (!current || current.submittedAt < record.submittedAt) byStudent.set(record.studentId, record);
    }
    const stat = results?.roundStats.find(value => value.roundId === round.id);
    const selected = detail.item.targetMode === 'selected';
    const people = (results?.board || []).map(person => ({ id: `person-${person.studentId}`, name: person.name, studentId: person.studentId, organization: person.orgLabel, submission: byStudent.get(person.studentId), status: person.statuses[round.id] || 'missing' }));
    const records = submissions.map(submission => ({ id: submission.id, name: submission.studentName || '填写者', studentId: submission.studentId, organization: '', submission, status: submission.status }));
    const rows = selected ? round.submissionMode === 'replace' ? people : [...records, ...people.filter(person => person.status === 'missing')] : records;
    const visible = rows.filter(row => filter === 'all' || row.status === filter || row.submission?.status === filter);
    const current = submissions.find(item => item.id === opened);
    async function zip() {
        setActionError('');
        const controller = new AbortController();
        setTransfer(controller);
        setMessage('正在准备附件…');
        try { await downloadZip(path, detail.item.name + ' - ' + round.label, setMessage, controller.signal); setMessage('附件已打包'); }
        catch (error) { if (!controller.signal.aborted) setActionError(errorText(error)); setMessage(''); }
        finally { setTransfer(undefined); }
    }
    async function copyMissing() {
        setActionError('');
        try {
            await navigator.clipboard.writeText(rows.filter(row => row.status === 'missing').map(row => `${row.studentId}\t${row.name}`).join('\n'));
            setMessage('未交名单已复制');
        } catch (error) { setActionError(errorText(error)); }
    }
    return <section className="cw-board">
        <div className="cw-stats">
            <div><span>已提交</span><strong>{stat?.submitted ?? '—'}</strong></div>
            {selected && <><div><span>未提交</span><strong>{stat?.missing ?? '—'}</strong></div>
                <div><span>提交进度</span><strong>{stat?.total ? `${Math.round(100 * stat.submitted / stat.total)}%` : '—'}</strong></div></>}
            <div><span>迟交</span><strong>{stat?.late ?? '—'}</strong></div>
        </div>
        <div className="cw-panel">
            <div className="cw-board-head"><h2>提交记录</h2><div className="cw-inline">
                {selected && !!stat?.missing && <button type="button" className="cw-button" onClick={copyMissing}><Copy size={16} />复制未交名单</button>}
                <a className="cw-button" href={`/api/platform${path}/csv`}><Download size={16} />导出 CSV</a>
                {submissions.some(record => record.files.length > 0) && <button type="button" className="cw-button" onClick={() => { if (transfer) transfer.abort(); else void zip(); }}><FileArchive size={16} />{transfer ? '取消打包' : '打包附件'}</button>}
            </div></div>
            <div className="cw-board-controls"><label>提交状态 <select value={filter} onChange={event => { setFilter(event.target.value); setLimit(25); }}>
                <option value="all">全部状态</option><option value="submitted">已提交</option><option value="late">迟交</option>{selected && <option value="missing">未提交</option>}
                {round.requireReview && <><option value="pending_review">待审核</option><option value="accepted">已通过</option><option value="rejected">已退回</option></>}
            </select></label>{message && <span role="status">{message}</span>}{actionError && <span role="alert" className="cw-failure">{actionError}</span>}</div>
            {loadError && <div className="cw-inline"><p className="cw-failure" role="alert">{loadError}</p><button type="button" className="cw-button" onClick={() => retry(attempt + 1)}>重试</button></div>}
            {visible.length ? <div className="cw-table-scroll"><table><thead><tr><th scope="col">填写者</th><th scope="col">状态</th><th scope="col">提交时间</th><th scope="col"><span className="cw-sr-only">操作</span></th></tr></thead>
                <tbody>{visible.slice(0, limit).map(row => <tr key={row.id}><td><b>{row.name}</b>{row.studentId && <small className="cw-mono">{row.studentId}</small>}{row.organization && <small>{row.organization}</small>}</td>
                    <td>{badge(row.submission?.status || row.status as SubmissionStatus | 'missing')}</td><td>{row.submission ? displayTime(row.submission.submittedAt) : '—'}</td>
                    <td>{row.submission && <button type="button" className="cw-plain" aria-haspopup="dialog" onClick={() => setOpened(row.submission!.id)}>查看</button>}</td></tr>)}</tbody></table></div>
                : <p className="cw-muted cw-board-empty">{results ? '当前没有符合条件的记录。' : loadError ? '提交记录暂不可用。' : '正在加载提交记录…'}</p>}
            {visible.length > limit && <button type="button" className="cw-button cw-more" onClick={() => setLimit(limit + 25)}>显示更多（{limit}/{visible.length}）</button>}
            {current && <Dialog title="提交详情" onClose={() => setOpened('')} wide><div className="cw-board-receipt"><ReceiptSummary key={current.id} submission={current} manage={round.requireReview} authorize={authorize} onChanged={refresh} /></div></Dialog>}
        </div>
    </section>;
}

export function Details({ detail, chosenRound, receiptId, version, navigate, edit, authorize, onChanged, onDeleted }: {
    detail: CollectionDetail; chosenRound: string; receiptId: string; version: number; navigate: Navigate; edit: (mode: EditorMode) => void;
    authorize: () => Promise<void>; onChanged: (id?: string) => void; onDeleted: () => void;
}) {
    const { item, view } = detail;
    const round = item.rounds.find(value => value.id === chosenRound) || item.rounds.find(value => value.open) || item.rounds[0];
    const [panel, setPanel] = useState<'board' | 'fill'>(receiptId ? 'fill' : 'board');
    const [latest, setLatest] = useState<Submission>();
    const [replaceRound, setReplace] = useState('');
    const replace = replaceRound === round?.id;
    const [failure, setFailure] = useState('');
    const [duplicating, setDuplicating] = useState(false);
    const [confirm, setConfirm] = useState(false);
    const [changing, setChanging] = useState(false);
    const [changeError, setChangeError] = useState('');
    const manage = item.canManage;
    const draft = item.status === 'draft';
    const pinned = pinnedCollections.includes(item.id);
    const actionLabel = draft ? '删除草稿' : '取消发布';
    const preview = detail.viewer && view !== detail.viewer.role;
    const accepts = !!round && (round.open ?? roundIsOpen(item, round));
    const canSubmit = !!detail.viewer && !preview && view !== 'guest' && accepts && (item.targetMode === 'open' || item.inRecipients);
    const mostRecent = (latest?.roundId === round?.id ? latest : undefined);
    const self = detail.mySubmissions.filter(submission => submission.roundId === round?.id);
    const own = mostRecent ? [mostRecent, ...self.filter(record => record.id !== mostRecent.id)] : self;
    const prior = round?.submissionMode === 'replace' ? own[0] : undefined;
    const displayedOwn = [...own].sort((left, right) => Number(right.id === receiptId) - Number(left.id === receiptId));
    const showFill = !manage || panel === 'fill';
    const limitReached = !!round && round.submissionMode === 'multiple' && round.maxPerUser > 0 && own.length >= round.maxPerUser;
    const loginUrl = !detail.viewer && accepts ? collectionLoginUrl() : undefined;
    let submitNote = '';
    if (!accepts) submitNote = '本批次当前不收集提交。';
    else if (preview) submitNote = '预览视角下可以查看填写内容。';
    else if (detail.viewer && !canSubmit) submitNote = '本批次面向指定填写对象。';
    else if (limitReached) submitNote = '已达到本批次的个人提交次数上限。';
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
                <span className={`cw-status cw-status-${item.status}`}>{collectionStatus[item.status]}</span>
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
                        <span>{value.label}</span>{value.myStatus && value.myStatus !== 'missing' && <span className="cw-dot" aria-label="已有提交" />}
                    </WorkspaceLink>)}
                </nav>{manage && <button type="button" className="cw-button cw-side-add" onClick={() => edit('new-round')}><Plus size={16} />新增批次</button>}</section>
            </aside>
            {round && <div className="cw-round">
                <section className="cw-round-head cw-panel">
                    <h2>{round.label}</h2><div className="cw-round-facts">
                        <div><span><CalendarClock size={16} />截止时间</span>{manage
                            ? <button type="button" className="cw-fact-action" aria-label={`修改截止时间，当前 ${displayTime(round.deadline)}`} onClick={() => edit('deadline')}>{displayTime(round.deadline)}<Pencil size={15} /></button>
                            : <strong>{displayTime(round.deadline)}</strong>}</div>
                        <div><span><UsersRound size={16} />填写对象</span>{manage && !pinned
                            ? <button type="button" className="cw-fact-action" onClick={() => edit('recipients')}>{item.targetMode === 'selected' ? `${item.recipientCount} 人` : '所有可访问用户'}<Pencil size={15} /></button>
                            : <strong>{item.targetMode === 'selected' ? '指定成员' : '所有可访问用户'}</strong>}</div>
                    </div>
                    {manage && <button type="button" className="cw-button" onClick={() => edit('round')}>编辑批次</button>}
                </section>
                {manage && <div className="cw-segment" role="group" aria-label="批次内容">
                    <button type="button" aria-pressed={panel === 'board'} onClick={() => setPanel('board')}>提交记录</button>
                    <button type="button" aria-pressed={panel === 'fill'} onClick={() => setPanel('fill')}>{canSubmit ? '填写与我的提交' : '查看填写内容'}</button>
                </div>}
                {showFill ? <div className="cw-panel cw-fill-panel">
                    <h2>{prior ? '我的提交' : '填写内容'}</h2>
                    {displayedOwn.map(record => <ReceiptSummary key={record.id} submission={record} manage={false} editable={canSubmit && round.allowEdit} authorize={authorize} onChanged={() => { setLatest(undefined); onChanged(); }} />)}
                    {prior && canSubmit && !replace && <button type="button" className="cw-button" onClick={() => setReplace(round.id)}>重新填写</button>}
                    {(!prior || replace) && <AnswerForm key={`${round.id}/${prior?.id || ''}`} round={round} path={roundRoute(item.id, round.id)} replacing={prior} canSubmit={canSubmit && !limitReached}
                        loginUrl={loginUrl} authorize={authorize} onSaved={submission => { setLatest(submission); setReplace(''); onChanged(); }} />}
                    {submitNote && <p className="cw-muted">{submitNote}</p>}
                </div> : <RoundBoard key={round.id} detail={detail} round={round} version={version} authorize={authorize} refresh={() => onChanged()} />}
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
