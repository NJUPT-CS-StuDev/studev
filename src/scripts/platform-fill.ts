import { api, bytes, busy, copy, el, errorText, formatTime, message, PlatformError, q, readAnswers, renderFields, safeStorageUrl, session, type FormDefinition, type Session, type Submission } from './platform-client';
import { receipts, rememberReceipt, receiptStorageAvailable, type LocalReceipt } from './platform-receipts';
import {saveBlob} from './platform-client';
interface Upload {
    fileId: string;
    url: string;
    method: string;
    headers: Record<string, string>;
    expiresAt: string;
}
const status = q<HTMLElement>('[data-fill-status]');
const formElement = q<HTMLFormElement>('[data-fill-form]');
let definition: FormDefinition;
let identity: Session | null = null;
let pending: LocalReceipt | null = null;
const activeXHR = new Set<XMLHttpRequest>();
let canceled = false;
let latestId = '';
let canSubmit = false;
let receiptBackup:LocalReceipt|null=null;

function saveReceipt(value:LocalReceipt) {
    receiptBackup={...value};
    const saved=rememberReceipt(value);
    q('[data-fill-storage-fallback]').hidden=!!identity;
    q('[data-receipt-backup-heading]').textContent=saved?'保存访客回执':'浏览器未能保存回执凭证，请立即下载';
    return saved;
}
function setLocked(locked: boolean) {
    q<HTMLFieldSetElement>('[data-fill-fieldset]').disabled = locked || !!pending || !canSubmit;
}
function pendingActions(visible: boolean) {
    q('[data-fill-complete]').hidden = !visible;
    q('[data-fill-abandon]').hidden = !visible;
}
function finish(submission: Submission) {
    if (pending) {
        pending.completed = true;
        saveReceipt(pending);
    }
    latestId = submission.id;
    q('[data-fill-receipt-id]').textContent = submission.id;
    q('[data-fill-success]').textContent = submission.status === 'pending_review'
        ? '你的填写和附件已收到，等待管理员审核。' : '你的填写和附件已收到。';
    q('[data-fill-receipt-note]').textContent = identity
        ? '可以随时在“我的提交”查看记录和处理结果。'
        : '访客回执凭证仅保存在当前浏览器标签页会话中，关闭会话或清理浏览器数据后可能无法再查询。可下载回执恢复文件妥善保存；使用共用设备时请注意隐私。';
    q('[data-fill-receipt]').hidden = false;
    formElement.hidden = true;
    q('[data-fill-progress]').hidden = true;
    pendingActions(false);
    message(status, '提交成功。', 'success');
    pending = null;
}
async function complete() {
    if (!pending)
        return;
    try {
        const result = await api<{
            submission: Submission;
        }>(`/submissions/${encodeURIComponent(pending.id)}/complete`, { receiptToken: pending.token });
        finish(result.submission);
    }
    catch (error) {
        pendingActions(true);
        setLocked(false);
        message(status, `${errorText(error)} 请先尝试“重试确认提交”。若附件没有成功上传，可明确放弃本次后重新填写；重新提交会占用新的次数。`, 'error');
    }
}
function upload(file: File, target: Upload, fileIndex: number, total: number, progress: Map<number, number>) {
    return new Promise<void>((resolve, reject) => {
        if (canceled) {
            reject(new Error('上传已取消。'));
            return;
        }
        const xhr = new XMLHttpRequest();
        activeXHR.add(xhr);
        xhr.open(target.method || 'PUT', safeStorageUrl(target.url));
        xhr.withCredentials = false;
        xhr.timeout = 300000;
        for (const [key, value] of Object.entries(target.headers || {})) {
            if (!['content-length', 'host'].includes(key.toLowerCase()))
                xhr.setRequestHeader(key, value);
        }
        xhr.upload.addEventListener('progress', event => {
            if (!event.lengthComputable)
                return;
            progress.set(fileIndex, event.loaded);
            const loaded = [...progress.values()].reduce((sum, value) => sum + value, 0);
            const percentage = Math.round(loaded / Math.max(total, 1) * 100);
            q<HTMLProgressElement>('[data-fill-bar]').value = percentage;
            q('[data-fill-progress-label]').textContent = `正在上传 ${file.name} · ${percentage}%（${bytes(loaded)} / ${bytes(total)}）`;
        });
        xhr.addEventListener('load', () => {
            activeXHR.delete(xhr);
            progress.set(fileIndex, file.size);
            if (xhr.status >= 200 && xhr.status < 300)
                resolve();
            else
                reject(new Error('文件上传失败或链接已过期，请先尝试确认提交。'));
        });
        xhr.addEventListener('error', () => { activeXHR.delete(xhr); reject(new Error('上传连接中断，请检查网络。')); });
        xhr.addEventListener('abort', () => { activeXHR.delete(xhr); reject(new Error('上传已取消。已申请的提交名额不会自动返还。')); });
        xhr.addEventListener('timeout', () => { activeXHR.delete(xhr); reject(new Error('上传超时，请检查网络后重试。')); });
        xhr.send(file);
    });
}
formElement.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!definition || !canSubmit || pending)
        return;
    try {
        if(!identity&&!receiptStorageAvailable())throw new Error('当前浏览器无法保存访客回执，请允许本站会话存储后重试，或先登录再填写。尚未申请提交次数。');
        const answers = readAnswers(formElement, definition.fields);
        const files: File[] = [];
        const metadata: {
            fieldId: string;
            name: string;
            size: number;
            type: string;
        }[] = [];
        for (const field of definition.fields.filter(item => item.type === 'file')) {
            const selected = Array.from(q<HTMLInputElement>(`[name="${field.id}"]`, formElement).files || []);
            if (field.required && !selected.length)
                throw new Error(`请选择“${field.label}”的附件。`);
            if (selected.length > (field.maxFiles || 1))
                throw new Error(`“${field.label}”最多 ${field.maxFiles || 1} 个文件。`);
            for (const file of selected) {
                if (file.size > (field.maxFileBytes || 20971520) || file.size < 1)
                    throw new Error(`“${file.name}”大小需为 1 B 至 ${bytes(field.maxFileBytes || 20971520)}。`);
                if (field.extensions?.length) {
                    const ext = file.name.split('.').pop()?.toLowerCase();
                    if (!ext || !field.extensions.some(value => value.replace(/^\./, '').toLowerCase() === ext))
                        throw new Error(`“${file.name}”的文件格式不符合要求。`);
                }
                files.push(file);
                metadata.push({ fieldId: field.id, name: file.name, size: file.size, type: file.type || 'application/octet-stream' });
            }
        }
        if (files.length > 10)
            throw new Error('每次提交最多 10 个附件。');
        if (files.reduce((sum, file) => sum + file.size, 0) > 20971520)
            throw new Error('本次所有附件合计超过 20 MB，请压缩或减少文件后提交。');
        setLocked(true);
        canceled = false;
        message(status, '正在创建提交，请不要关闭页面……');
        const result = await api<{
            submission: Submission;
            receiptToken: string;
            uploads: Upload[];
        }>(`/forms/${encodeURIComponent(definition.id)}/submissions`, {
            answers, files: metadata, submitterName: identity ? undefined : q<HTMLInputElement>('#guest-name').value.trim(),
        });
        pending = { id: result.submission.id, formId: definition.id, title: definition.title, token: result.receiptToken, createdAt: result.submission.createdAt || new Date().toISOString(), completed: false };
        saveReceipt(pending);
        if (result.uploads.length !== files.length)
            throw new Error('上传信息不完整，请联系管理员。');
        if (files.length) {
            q('[data-fill-progress]').hidden = false;
            q('[data-fill-cancel]').hidden = false;
            const total = files.reduce((sum, file) => sum + file.size, 0);
            const progress = new Map<number, number>();
            let next = 0;
            async function worker() {
                while (true) {
                    const index = next++;
                    if (index >= files.length) return;
                    await upload(files[index], result.uploads[index], index, total, progress);
                }
            }
            // A small bounded pool improves multi-file submissions while
            // keeping mobile radios and the OSCA gateway from being flooded.
            await Promise.all(Array.from({ length: Math.min(3, files.length) }, worker));
        }
        q('[data-fill-cancel]').hidden = true;
        message(status, '正在确认提交和附件，请稍候……');
        await complete();
    }
    catch (error) {
        q('[data-fill-progress]').hidden = true;
        message(status, errorText(error), 'error');
        if (pending)
            pendingActions(true);
        setLocked(false);
    }
});
q('[data-fill-cancel]').addEventListener('click', () => { canceled = true; for (const xhr of activeXHR) xhr.abort(); });
q<HTMLButtonElement>('[data-fill-complete]').addEventListener('click', event => {
    const b = event.currentTarget as HTMLButtonElement;
    void busy(b, async () => { message(status, '正在确认提交……'); await complete(); });
});
q('[data-fill-abandon]').addEventListener('click', () => {
    if (!pending || !window.confirm('放弃本次并重新填写？已申请的记录会保留，不退还提交次数；重新提交将占用新的次数。'))
        return;
    pending.abandoned = true;
    saveReceipt(pending);
    pending = null;
    pendingActions(false);
    formElement.reset();
    setLocked(false);
    message(status, '已放弃本次填写。你可以重新填写并申请新的提交。');
});
q('[data-fill-copy]').addEventListener('click', () => { void copy(latestId, status); });
q('[data-fill-save-receipt]').addEventListener('click',()=>{if(receiptBackup)saveBlob(new Blob([JSON.stringify({version:1,site:location.origin,...receiptBackup},null,2)],{type:'application/json'}),`StuDev-回执-${receiptBackup.id}.json`);});
q('[data-fill-another]').addEventListener('click', () => {
    formElement.reset();
    formElement.hidden = false;
    q('[data-fill-receipt]').hidden = true;
    setLocked(false);
    message(status);
    formElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
window.addEventListener('beforeunload', event => { if (activeXHR.size)
    event.preventDefault(); });
void (async () => {
    try {
        const id = new URLSearchParams(location.search).get('id');
        if (!id)
            throw new Error('此链接缺少表单信息，请从表单列表进入，或向管理员获取完整链接。');
        // Start the form request while the navigation/session request is in
        // flight. The form endpoint applies the cookie itself, so it does not
        // need to wait for the client-side session result.
        const formRequest = api<{
            form: FormDefinition;
            canSubmit: boolean;
            reason?: string;
        }>(`/forms/${encodeURIComponent(id)}`);
        identity = await session(true);
        if (!identity) return;
        pending = receipts().filter(value => value.formId === id && !value.completed && !value.abandoned).at(-1) || null;
        let result:{form:FormDefinition;canSubmit:boolean;reason?:string};
        try {result = await formRequest;}
        catch(error){
            if(!pending)throw error;
            const previous=await api<{submission:Submission;form:FormDefinition}>(`/submissions/${encodeURIComponent(pending.id)}`,undefined,{headers:{'X-Receipt-Token':pending.token}});
            result={form:previous.form,canSubmit:false,reason:'此表目前无法新填写。你仍可重试确认此前已申请的提交，或明确放弃。'};
        }
        definition = result.form;
        canSubmit = result.canSubmit;
        q('[data-fill-title]').textContent = definition.title;
        q('[data-fill-description]').textContent = definition.description || '请填写下方内容，确认无误后提交。';
        document.title = `${definition.title} — StuDev`;
        renderFields(q('[data-fill-fields]'), definition.fields);
        q('[data-guest-name]').hidden = !!identity;
        q<HTMLInputElement>('#guest-name').required = !identity;
        q('[data-fill-identity]').textContent = identity ? `以 ${identity.user.realName||identity.user.nickname}${identity.user.studentId?`（${identity.user.studentId}）`:""} 的身份提交；学号和姓名由账号自动关联，无需重复填写` : '';
        const rules = q('[data-fill-rules]');
        if (definition.requireReview)
            rules.append(el('span', '提交后审核', 'p-pill'));
        if (definition.allowEdit)
            rules.append(el('span', '提交后可修改', 'p-pill'));
        if (definition.deadline)
            rules.append(el('span', `截止 ${formatTime(definition.deadline)}`, 'p-pill'));
        rules.hidden = !rules.childElementCount;
        if (definition.allowEdit)
            rules.append(el('span', '允许修改文字信息', 'p-pill'));
        if (definition.deadline)
            rules.append(el('span', `截止 ${formatTime(definition.deadline)}`, 'p-pill'));
        q('[data-fill-card]').hidden = false;
        if (!canSubmit) {
            message(status, result.reason || '此表单暂时不能提交。');
            q('[data-fill-preview]').hidden = identity?.user.role === 'member' || !identity;
        }
        else
            message(status);
        setLocked(false);
        if (pending) {
            pendingActions(true);
            message(status, '当前会话有一条尚未确认的提交，已暂时锁定新提交。请先重试确认；若附件未上传成功，可放弃本次并重新填写（会占用新次数）。');
        }
    }
    catch (error) {
        message(status, errorText(error), 'error');
        if (error instanceof PlatformError && error.status === 401) {
            const login = el('a', '登录后填写', 'p-button');
            login.href = `/login/?next=${encodeURIComponent(location.pathname + location.search)}`;
            status.append(el('br'), login);
        }
    }
})();
