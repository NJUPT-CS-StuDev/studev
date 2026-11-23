import { useEffect, useId, useState, type FormEvent } from 'react';
import { CheckCircle2, Download, FileText, Pencil, Send } from 'lucide-react';
import { api, bytes, errorText } from '../api';
import { Dialog } from './Dialog';
import { downloadFile, uploadFile, type Upload } from './attachments';
import { displayTime, submissionRoute, submissionStatus, type Field, type Round, type Submission, type SubmissionFile } from './model';

type Answers = Record<string, unknown>;
type Files = Record<string, File[]>;
const stringValue = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const choices = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

export function badge(status: Submission['status'] | 'missing') {
    return <span className={`cw-status cw-status-${status}`}>{submissionStatus[status]}</span>;
}

function prefilled(fields: Field[]): Answers {
    const params = new URLSearchParams(location.search);
    return Object.fromEntries(fields.flatMap<[string, unknown]>(field => {
        const values = params.getAll(`a.${field.id}`);
        if (!values.length || field.type === 'file') return [];
        if (field.type === 'checkbox') return [[field.id, field.options?.filter(option => values.includes(option)) || []]];
        const value = values[0]!;
        if (field.type === 'select' && !field.options?.includes(value)) return [];
        if (field.type === 'number') return value && Number.isFinite(Number(value)) ? [[field.id, Number(value)]] : [];
        return [[field.id, value.slice(0, field.maxLength || 160)]];
    }));
}

function FileLink({ submissionId, file, authorize }: { submissionId: string; file: SubmissionFile; authorize: () => Promise<void> }) {
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState('');
    return <li><button type="button" className="cw-file" disabled={busy} onClick={async () => {
        setFailure('');
        setBusy(true);
        try { await authorize(); await downloadFile(submissionId, file); }
        catch (error) { setFailure(errorText(error)); }
        finally { setBusy(false); }
    }}><Download size={16} /><span>{file.name}</span><small>{busy ? '下载中…' : bytes(file.size)}</small></button>
        {failure && <small className="cw-failure" role="alert">{failure}</small>}</li>;
}

function AnswerFields({ fields, answers, disabled, files, kept, onAnswer, onFile, onKeep }: {
    fields: Field[]; answers: Answers; disabled: boolean; files?: Files; kept?: SubmissionFile[];
    onAnswer: (id: string, value: unknown) => void; onFile?: (id: string, value: File[]) => void; onKeep?: (id: string) => void;
}) {
    const prefix = useId();
    return <>{fields.map(field => {
        const id = `${prefix}-${field.id}`;
        const descriptionId = `${id}-description`;
        const value = answers[field.id];
        const title = <>{field.label}{field.required && <span className="cw-required" aria-label="必填"> *</span>}</>;
        const common = { id, 'aria-describedby': field.description ? descriptionId : undefined, disabled, required: field.required };
        if (field.type === 'checkbox') {
            const selected = choices(value);
            return <fieldset key={field.id} className="cw-choice" aria-describedby={common['aria-describedby']} aria-required={field.required}>
                <legend>{title}</legend>{field.description && <p className="cw-muted" id={descriptionId}>{field.description}</p>}
                {field.options?.map(option => <label key={option} className="cw-check"><input type="checkbox" disabled={disabled} checked={selected.includes(option)} onChange={event => onAnswer(field.id, event.target.checked ? [...selected, option] : selected.filter(other => other !== option))} />{option}</label>)}
            </fieldset>;
        }
        if (field.type === 'file') {
            if (!onFile) return null;
            const prior = kept?.filter(file => file.fieldId === field.id) || [];
            const picked = files?.[field.id] || [];
            return <div className="cw-upload-field" key={field.id}>
                <label htmlFor={id}>{title}</label>
                {field.description && <p className="cw-muted" id={descriptionId}>{field.description}</p>}
                <p className="cw-muted">{field.extensions?.map(extension => `.${extension}`).join('、')} · 每个上限 {bytes(field.maxFileBytes || 0)} · 最多 {field.maxFiles} 个</p>
                {prior.length > 0 && <ul className="cw-files">{prior.map(file => <li className="cw-inline" key={file.id}><FileText size={16} /><span>{file.name}</span><button type="button" className="cw-plain" disabled={disabled} onClick={() => onKeep?.(file.id)}>移除</button></li>)}</ul>}
                <input type="file" {...common} required={field.required && prior.length === 0} multiple={(field.maxFiles || 1) > 1} accept={field.extensions?.map(extension => `.${extension}`).join(',')} onChange={event => onFile(field.id, Array.from(event.target.files || []))} />
                {picked.length > 1 && <p className="cw-muted">{picked.map(file => file.name).join('、')}</p>}
            </div>;
        }
        const input = field.type === 'textarea' ? <textarea {...common} rows={4} maxLength={field.maxLength} value={stringValue(value)} onChange={event => onAnswer(field.id, event.target.value)} />
            : field.type === 'select' ? <select {...common} value={stringValue(value)} onChange={event => onAnswer(field.id, event.target.value)}><option value="">请选择</option>{field.options?.map(option => <option key={option}>{option}</option>)}</select>
                : <input {...common} type={field.type} min={field.min} max={field.max} step={field.type === 'number' ? 'any' : undefined} maxLength={field.maxLength} value={stringValue(value)} onChange={event => onAnswer(field.id, field.type === 'number' ? event.target.value === '' ? null : event.target.valueAsNumber : event.target.value)} />;
        return <div className="cw-answer-field" key={field.id}><label htmlFor={id}>{title}</label>{field.description && <p className="cw-muted" id={descriptionId}>{field.description}</p>}{input}</div>;
    })}</>;
}

type Receipt = { receiptId?: string; receiptToken?: string; uploads: Upload[]; submission: Submission };
type Pending = { receipt: Receipt; files: File[]; uploaded: Set<number> };

export function AnswerForm({ round, path, replacing, canSubmit, loginUrl, authorize, onSaved }: {
    round: Round; path: string; replacing?: Submission; canSubmit: boolean; loginUrl?: string; authorize: () => Promise<void>; onSaved: (submission: Submission) => void;
}) {
    const [answers, setAnswers] = useState(() => ({ ...prefilled(round.fields), ...Object.fromEntries(Object.entries(replacing?.answers || {}).filter(([id]) => round.fields.some(field => field.id === id && field.type !== 'file'))) }));
    const [files, setFiles] = useState<Files>({});
    const [kept, setKept] = useState(() => replacing?.files || []);
    const [busy, setBusy] = useState('');
    const [failure, setFailure] = useState('');
    const [pending, setPending] = useState<Pending>();
    useEffect(() => {
        if (!pending) return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [pending]);
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!canSubmit || busy) return;
        setFailure('');
        const reject = (message: string) => { throw new Error(message); };
        setBusy('正在提交…');
        try {
            let request = pending;
            if (!request) {
                for (const field of round.fields) {
                    if (field.type === 'checkbox' && field.required && !choices(answers[field.id]).length) reject(`请选择「${field.label}」。`);
                    if (field.type === 'file') {
                        const selected = files[field.id] || [];
                        if (selected.length + kept.filter(file => file.fieldId === field.id).length > (field.maxFiles || 1)) reject(`「${field.label}」附件数量超出限制。`);
                        if (selected.some(file => file.size < 1 || file.size > (field.maxFileBytes || 0))) reject(`「${field.label}」含有空文件或超出大小限制的附件。`);
                    }
                }
                const picked = Object.entries(files).flatMap(([fieldId, items]) => items.map(file => ({ fieldId, file })));
                await authorize();
                const receipt = await api<Receipt>(`${path}/submissions`, {
                    answers,
                    files: picked.map(({ fieldId, file }) => ({ fieldId, name: file.name, size: file.size, type: file.type || 'application/octet-stream' })),
                    keepFiles: kept.map(file => file.id),
                });
                request = { receipt, files: picked.map(({ file }) => file), uploaded: new Set() };
                setPending(request);
            }
            const { receipt, uploaded } = request;
            if (receipt.uploads.length) {
                const selected = request.files;
                setBusy(`正在上传附件 ${uploaded.size}/${selected.length}`);
                const results = await Promise.allSettled(receipt.uploads.map(async (upload, index) => {
                    if (uploaded.has(index)) return;
                    const file = selected[index];
                    if (!file) throw new Error('服务未返回有效的上传位置。');
                    await uploadFile(file, upload);
                    uploaded.add(index);
                    setBusy(`正在上传附件 ${uploaded.size}/${selected.length}`);
                }));
                const failed = results.find(result => result.status === 'rejected');
                if (failed?.status === 'rejected') throw failed.reason;
            }
            setBusy('正在确认提交…');
            const submission = receipt.receiptToken && receipt.receiptId ? { ...receipt.submission, ...(await api<{ submission: Pick<Submission, 'status' | 'revision' | 'submittedAt'> }>(`${submissionRoute(receipt.receiptId)}/complete`, { receiptToken: receipt.receiptToken })).submission } : receipt.submission;
            setPending(undefined);
            onSaved(submission);
        } catch (error) { setFailure(errorText(error)); }
        finally { setBusy(''); }
    }
    return <form className="cw-answer" onSubmit={submit}>
        <AnswerFields fields={round.fields} answers={answers} kept={kept} files={files} disabled={!canSubmit || !!busy || !!pending} onAnswer={(id, value) => setAnswers(previous => ({ ...previous, [id]: value }))}
            onFile={(id, value) => setFiles(previous => ({ ...previous, [id]: value }))} onKeep={id => setKept(previous => previous.filter(file => file.id !== id))} />
        {failure && <p role="alert" className="cw-failure">{failure}</p>}
        <div className="cw-inline">
            {canSubmit ? <button className="cw-button cw-primary" type="submit" formNoValidate={!!pending} disabled={!!busy}><Send size={16} />{busy || (pending ? '重试提交' : replacing ? '更新提交' : '提交')}</button>
                : loginUrl && <a href={loginUrl} className="cw-button cw-primary">登录后填写</a>}
            {pending && !busy && <button type="button" className="cw-button" onClick={() => { setPending(undefined); setFailure(''); }}>重新填写</button>}
        </div>
    </form>;
}

export function ReceiptSummary({ submission, manage, editable, authorize, onChanged }: {
    submission: Submission; manage: boolean; editable?: boolean; authorize: () => Promise<void>; onChanged: () => void;
}) {
    const [editing, edit] = useState(false);
    const [reviewing, review] = useState(false);
    return <article className="cw-receipt">
        <header className="cw-inline"><span><CheckCircle2 size={17} />{submission.studentName || '提交记录'}</span>{badge(submission.status)}<span className="cw-muted">{displayTime(submission.submittedAt)}</span></header>
        {submission.fields.some(field => field.type !== 'file') && <dl>{submission.fields.filter(field => field.type !== 'file').map(field => {
            const value = submission.answers[field.id];
            return <div key={field.id}><dt>{field.label}</dt><dd>{(Array.isArray(value) ? choices(value).join('、') : stringValue(value)) || '—'}</dd></div>;
        })}</dl>}
        {submission.files.length > 0 && <ul className="cw-files">{submission.files.map(file => <FileLink key={file.id} file={file} submissionId={submission.id} authorize={authorize} />)}</ul>}
        {submission.review?.comment && <p className="cw-review-note">{submission.review.comment}</p>}
        <div className="cw-inline">{editable && <button className="cw-button" type="button" onClick={() => edit(true)}><Pencil size={15} />修改答案</button>}
            {manage && submission.status !== 'uploading' && <button className="cw-button" type="button" onClick={() => review(true)}>审核提交</button>}</div>
        {editing && <ReceiptEditor submission={submission} authorize={authorize} onClose={() => edit(false)} onSaved={onChanged} />}
        {reviewing && <ReceiptEditor submission={submission} review authorize={authorize} onClose={() => review(false)} onSaved={onChanged} />}
    </article>;
}

function ReceiptEditor({ submission, review, authorize, onClose, onSaved }: {
    submission: Submission; review?: boolean; authorize: () => Promise<void>; onClose: () => void; onSaved: () => void;
}) {
    const [answers, setAnswers] = useState(submission.answers);
    const [comment, setComment] = useState(submission.review?.comment || '');
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState('');
    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy) return;
        const status = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value');
        setBusy(true);
        setFailure('');
        try {
            await authorize();
            await api(`${submissionRoute(submission.id)}/${review ? 'review' : 'edit'}`, review ? { revision: submission.revision, status, comment } : { revision: submission.revision, answers });
            onClose();
            onSaved();
        } catch (error) { setFailure(errorText(error)); }
        finally { setBusy(false); }
    }
    return <Dialog title={review ? '审核提交' : '修改答案'} busy={busy} onClose={onClose}>
        <form className="cw-dialog-form" onSubmit={save}>
            {review ? <label>审核意见<textarea rows={4} value={comment} maxLength={1000} onChange={event => setComment(event.target.value)} /></label>
                : <AnswerFields fields={submission.fields} answers={answers} disabled={busy} onAnswer={(id, value) => setAnswers(previous => ({ ...previous, [id]: value }))} />}
            {failure && <p role="alert" className="cw-failure">{failure}</p>}
            <div className="cw-dialog-actions">
                <button type="button" className="cw-button" onClick={onClose} disabled={busy}>取消</button>
                {review && <button type="submit" className="cw-button" value="rejected" disabled={busy}>退回</button>}
                <button type="submit" className="cw-button cw-primary" value="accepted" disabled={busy}>{review ? '通过' : '保存'}</button>
            </div>
        </form>
    </Dialog>;
}
