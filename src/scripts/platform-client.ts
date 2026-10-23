export type Role = 'owner' | 'admin' | 'member';
export interface User {
    id: string;
    qq: string;
    nickname: string;
    studentId:string;
    realName:string;
    identityVerified:boolean;
    profileComplete:boolean;
    email: string;
    emailVerified: boolean;
    role: Role;
    status: 'active' | 'disabled';
    revision: number;
    totpEnabled: boolean;
    mustChangePassword: boolean;
}
export interface Session {
    user: User;
    csrfToken: string;
    mfaVerified: boolean;
    enrollmentRequired?: boolean;
    passwordChangeRequired?: boolean;
    mfaRequired?: boolean;
    profileRequired?:boolean;
}
export interface Field {
    id: string;
    type: 'text' | 'textarea' | 'select' | 'checkbox' | 'number' | 'date' | 'file';
    label: string;
    description?: string;
    required: boolean;
    options?: string[];
    maxLength?: number;
    min?: number;
    max?: number;
    maxFiles?: number;
    maxFileBytes?: number;
    extensions?: string[];
}
export interface FormDefinition {
    id: string;
    title: string;
    description: string;
    status: 'draft' | 'published' | 'closed' | 'archived';
    access: 'public' | 'members';
    deadline: string;
    requireReview: boolean;
    allowEdit: boolean;
    maxPerUser: number;
    maxSubmissions: number;
    fields: Field[];
    revision: number;
    createdAt?: string;
    updatedAt?: string;
}
export interface SubmissionFile {
    id: string;
    fieldId: string;
    name: string;
    size: number;
    type: string;
}
export interface Submission {
    id: string;
    formId: string;
    formTitle: string;
    userId?: string;
    submitterName: string;
    submitterIdentity?: {studentId:string;realName:string;identityVerified:boolean};
    answers: Record<string, unknown>;
    files: SubmissionFile[];
    status: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
    review?: {
        comment?: string;
        status?: string;
        createdAt?: string;
        updatedAt?: string;
    };
}
export interface SubmitterContact {qq:string;email:string;emailVerified:boolean;nickname:string;studentId?:string;realName?:string;identityVerified?:boolean;}
export class PlatformError extends Error {
    constructor(message: string, public status = 0, public code = '') { super(message); this.name = 'PlatformError'; }
}
let currentSession: Session | null = null;
let sessionRequest: Promise<Session | null> | null = null;
export const labels: Record<string, string> = { owner: '所有者', admin: '管理员', member: '成员', draft: '草稿', published: '收集中', closed: '已停止', archived: '已归档', public: '访客可填', members: '成员填写', uploading: '待完成', submitted: '已提交', pending_review: '待审核', accepted: '已通过', rejected: '已退回', active: '启用', disabled: '停用' };
export function q<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T { const value = root.querySelector<T>(selector); if (!value)
    throw new Error(`页面组件缺失：${selector}`); return value; }
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] { const node = document.createElement(tag); if (text !== undefined)
    node.textContent = text; if (className)
    node.className = className; return node; }
export function button(text: string, fn: () => void | Promise<void>, style = 'secondary small'): HTMLButtonElement {
    const b = el('button', text, `p-button ${style}`);
    b.type = 'button';
    b.addEventListener('click', async () => {
        const result = fn();
        if (result instanceof Promise) {
            b.disabled = true;
            try { await result; }
            finally { b.disabled = false; }
        }
    });
    return b;
}
export function link(text: string, href: string, style = 'secondary'): HTMLAnchorElement { const a = el('a', text, `p-button ${style}`); a.href = href; return a; }
export function initPasswordToggles(root: Document | HTMLElement = document) {
    const eyeIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    const eyeOffIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
    root.querySelectorAll<HTMLButtonElement>('[data-toggle-password]').forEach(button => {
        button.innerHTML = eyeIcon;
        button.addEventListener('click', () => {
            const wrap = button.closest('.p-password-wrap');
            const input = wrap?.querySelector<HTMLInputElement>('input');
            if (!input) return;
            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            button.innerHTML = isPassword ? eyeOffIcon : eyeIcon;
            const isInvite = input.id.includes('invite');
            button.setAttribute('aria-label', isPassword ? (isInvite ? '隐藏邀请码' : '隐藏密码') : (isInvite ? '显示邀请码' : '显示密码'));
        });
    });
}
export function pill(state: string): HTMLElement { const n = el('span', labels[state] || state, 'p-pill'); n.dataset.state = state; return n; }
export function message(node: HTMLElement, text = '', kind = 'info') { node.textContent = text; node.dataset.kind = kind; }
export function errorText(error: unknown): string { return error instanceof Error ? error.message : '操作未完成，请稍后重试。'; }
export async function api<T>(path: string, body?: unknown, options: RequestInit = {}): Promise<T> { if (!path.startsWith('/') || path.startsWith('//'))
    throw new PlatformError('请求路径无效。'); let response: Response; try {
    response = await fetch(`/api/platform${path}`, { ...options, method: options.method || (body === undefined ? 'GET' : 'POST'), credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(body !== undefined && currentSession ? { 'X-CSRF-Token': currentSession.csrfToken } : {}), ...options.headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
catch {
    throw new PlatformError('网络连接中断，请检查网络后重试。');
} let data: unknown; try {
    data = await response.json();
}
catch {
    throw new PlatformError('服务暂时无法响应，请稍后重试。', response.status);
} if (!response.ok) {
    const e = data as {
        error?: {
            message?: string;
            code?: string;
        };
    };
    throw new PlatformError(e.error?.message || '操作未完成，请稍后重试。', response.status, e.error?.code);
} return data as T; }
async function loadSession(): Promise<Session | null> {
    // PlatformShell and each functional page ask for the session at the same
    // time. Share that in-flight request so one navigation performs one Blob
    // backed authentication lookup.
    sessionRequest ||= (async () => {
        try {
            currentSession = await api<Session>('/auth/session');
            if (currentSession?.user) {
                try {
                    localStorage.setItem('studev_auth_user', JSON.stringify({
                        nickname: currentSession.user.nickname,
                        role: currentSession.user.role || 'member'
                    }));
                } catch {}
            }
        }
        catch (e) {
            if (e instanceof PlatformError && e.status === 401) {
                currentSession = null;
                try { localStorage.removeItem('studev_auth_user'); } catch {}
            }
            else
                throw e;
        }
        return currentSession;
    })().finally(() => { sessionRequest = null; });
    return sessionRequest;
}
export async function session(required = false, staff = false): Promise<Session | null> {
    await loadSession();
    if (required && !currentSession) {
    location.replace(`/login/?next=${encodeURIComponent(location.pathname + location.search)}`);
    return null;
} if (currentSession&&!['/account/','/login/'].includes(location.pathname)&&(currentSession.profileRequired||currentSession.passwordChangeRequired||currentSession.enrollmentRequired||currentSession.mfaRequired)) {
    location.replace('/account/?setup=1');
    return null;
} if (staff && currentSession) {
    if (currentSession.user.role === 'member')
        throw new PlatformError('只有管理员可以进入管理后台。', 403);
    if (!currentSession.mfaVerified || currentSession.enrollmentRequired || currentSession.passwordChangeRequired || currentSession.profileRequired) {
        location.replace('/account/?setup=1');
        return null;
    }
} return currentSession; }
export function rememberSession(s: Session | null) { currentSession = s; }
export function safeNext(raw: string | null): string { if (!raw || !raw.startsWith('/') || raw.startsWith('//') || /[\\\x00-\x20]/.test(raw))
    return '/forms/'; try {
    const u = new URL(raw, location.origin);
    return u.origin === location.origin && !['/login/', '/login'].includes(u.pathname) ? u.pathname + u.search + u.hash : '/forms/';
}
catch {
    return '/forms/';
} }
export function formatTime(value?: string) { if (!value)
    return '—'; const date = new Date(value); return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
export function bytes(value: number) { return value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1048576).toFixed(1).replace(/\.0$/, '')} MB`; }
export async function copy(text: string, status?: HTMLElement) { try {
    await navigator.clipboard.writeText(text);
    if (status)
        message(status, '已复制。', 'success');
}
catch {
    if (status)
        message(status, '浏览器未允许复制，请手动选择并复制。', 'error');
} }
export async function busy<T>(b: HTMLButtonElement, fn: () => Promise<T>): Promise<T> { const original = b.textContent; b.disabled = true; b.textContent = '请稍候…'; try {
    return await fn();
}
finally {
    b.disabled = false;
    b.textContent = original;
} }
export function empty(title: string, description = '') { const box = el('div', undefined, 'p-empty'); box.append(el('h2', title)); if (description) box.append(el('p', description)); return box; }
export function safeStorageUrl(raw: string): string { const url = new URL(raw); if (url.origin !== 'https://fgws3-ocloud.ihep.ac.cn' || url.username || url.password)
    throw new PlatformError('文件地址无法验证，请联系管理员。'); return url.href; }
export function saveBlob(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const a = el('a'); a.href = url; a.download = name.replace(/[\\/\x00-\x1f]/g, '_'); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
export async function downloadFile(submission: Submission, file: SubmissionFile, receipt?: string) { const result = await api<{
    download: {
        url: string;
        headers: Record<string, string>;
        fileName: string;
    };
}>(`/submissions/${encodeURIComponent(submission.id)}/files/${encodeURIComponent(file.id)}/download`, {}, receipt ? { headers: { 'X-Receipt-Token': receipt } } : {}); let response: Response; try {
    response = await fetch(safeStorageUrl(result.download.url), { headers: result.download.headers, credentials: 'omit', cache: 'no-store', redirect: 'error' });
}
catch {
    throw new PlatformError('文件下载连接失败，请重新点击下载。');
} if (!response.ok)
    throw new PlatformError('下载链接已过期或文件已变化，请重新点击下载。'); saveBlob(await response.blob(), result.download.fileName || file.name); }
export function renderFields(root: HTMLElement, fields: Field[], answers: Record<string, unknown> = {}, editing = false) { root.replaceChildren(); for (const field of fields) {
    const wrap = el('div', undefined, 'p-field');
    const id = `answer-${field.id}`;
    const label = el('label', field.label);
    label.htmlFor = id;
    if (field.required)
        label.append(el('span', '*', 'p-required'));
    wrap.append(label);
    const value = answers[field.id];
    if (field.type === 'checkbox') {
        const group = el('div', undefined, 'p-option-group');
        group.id = id;
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', field.label);
        for (const option of field.options || []) {
            const item = el('label', undefined, 'p-checkbox');
            const input = el('input');
            input.type = 'checkbox';
            input.name = field.id;
            input.value = option;
            input.checked = Array.isArray(value) && value.includes(option);
            item.append(input, el('span', option));
            group.append(item);
        }
        wrap.append(group);
    }
    else {
        let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        if (field.type === 'textarea') {
            input = el('textarea');
            input.rows = 4;
            input.maxLength = field.maxLength || 4000;
        }
        else if (field.type === 'select') {
            input = el('select');
            const placeholder = el('option', '请选择');
            placeholder.value = '';
            input.append(placeholder);
            for (const option of field.options || []) {
                const n = el('option', option);
                n.value = option;
                input.append(n);
            }
        }
        else {
            input = el('input');
            input.type = field.type === 'file' ? 'file' : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';
            if (field.type === 'file') {
                input.multiple = (field.maxFiles || 1) > 1;
                input.accept = (field.extensions || []).map(v => v.startsWith('.') ? v : `.${v}`).join(',');
                input.disabled = editing;
            }
            else if (field.type === 'number') {
                if (field.min !== undefined)
                    input.min = String(field.min);
                if (field.max !== undefined)
                    input.max = String(field.max);
                input.step = 'any';
            }
            else if (field.type === 'text') {
                input.maxLength = field.maxLength || 1000;
            }
        }
        input.id = id;
        input.name = field.id;
        input.required = field.required && !(editing && field.type === 'file');
        if (field.type !== 'file')
            input.value = value === undefined || value === null ? '' : String(value);
        wrap.append(input);
        if (field.type === 'file') {
            const help = el('p', editing ? '附件保留原件；需要更换附件时请新建一条提交。' : `最多 ${field.maxFiles || 1} 个文件，每个不超过 ${bytes(field.maxFileBytes || 20971520)}。${field.extensions?.length ? `支持 ${field.extensions.join('、')}。` : ''}`, 'p-help');
            wrap.append(help);
            const summary = el('p', '', 'p-help');
            input.addEventListener('change', () => { summary.textContent = Array.from((input as HTMLInputElement).files || []).map(f => `${f.name} · ${bytes(f.size)}`).join('；'); });
            wrap.append(summary);
        }
    }
    if (field.description) {
        const help = el('p', field.description, 'p-help');
        help.id = `help-${field.id}`;
        wrap.append(help);
        wrap.querySelector('input,select,textarea')?.setAttribute('aria-describedby', help.id);
    }
    root.append(wrap);
} }
export function readAnswers(root: ParentNode, fields: Field[]): Record<string, unknown> { const values: Record<string, unknown> = {}; for (const f of fields) {
    if (f.type === 'file')
        continue;
    if (f.type === 'checkbox') {
        const selected = Array.from(root.querySelectorAll<HTMLInputElement>(`input[name="${f.id}"]:checked`)).map(v => v.value);
        if (f.required && !selected.length)
            throw new PlatformError(`请选择“${f.label}”。`);
        values[f.id] = selected;
    }
    else {
        const n = q<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${f.id}"]`, root);
        values[f.id] = f.type === 'number' && n.value !== '' ? Number(n.value) : n.value;
    }
} return values; }
export function renderSubmission(root: HTMLElement, submission: Submission, form: FormDefinition, onError: (e: unknown) => void, receipt?: string) { const meta = el('dl', undefined, 'p-meta'); for (const [k, v] of [['回执编号', submission.id], ['填写者', submission.submitterName || '—'], ['提交时间', formatTime(submission.createdAt)], ['状态', labels[submission.status] || submission.status]])
    meta.append(el('dt', k), el('dd', v)); if(submission.submitterIdentity){meta.append(el('dt','提交时学号'),el('dd',submission.submitterIdentity.studentId),el('dt','提交时姓名'),el('dd',submission.submitterIdentity.realName),el('dt','提交时核验'),el('dd',submission.submitterIdentity.identityVerified?'已核验':'未核验'));} root.append(meta, el('hr', undefined, 'p-divider')); for (const field of form.fields) {
    if (field.type === 'file')
        continue;
    const v = submission.answers[field.id];
    const block = el('div', undefined, 'p-field');
    block.append(el('span', field.label, 'p-label'), el('div', Array.isArray(v) ? v.join('、') : v === undefined || v === '' ? '—' : String(v), 'p-description'));
    root.append(block);
} if (submission.files?.length) {
    root.append(el('h3', '附件'));
    const list = el('ul', undefined, 'p-file-list');
    for (const file of submission.files) {
        const item = el('li');
        const text = el('span', `${file.name} · ${bytes(file.size)}`);
        const b = button('下载', async () => { try {
            await busy(b, () => downloadFile(submission, file, receipt));
        }
        catch (e) {
            onError(e);
        } });
        item.append(text, b);
        list.append(item);
    }
    root.append(list);
} if (submission.review) {
    const review = el('div', undefined, 'p-message');
    review.append(el('strong', '处理结果'), el('p', submission.review.comment || labels[submission.review.status || submission.status] || '已处理'));
    root.append(review);
} }
