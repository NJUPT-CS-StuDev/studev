import { api, avatarImg, el, errorText, message, PlatformError, q, session, type MemberPage, type MemberProfile, type Session } from './api';
import { renderManagedMembers, showAudit, showManagement } from './manage';

const shell = q('[data-members-shell]');
const status = q<HTMLElement>('[data-members-status]');
const directory = q('[data-members-directory]');
const list = q<HTMLElement>('[data-members-list]');
const head = q<HTMLTableSectionElement>('thead', list);
const body = q<HTMLTableSectionElement>('tbody', list);
const profile = q<HTMLElement>('[data-members-profile]');
const search = q<HTMLInputElement>('[data-members-search]');
const form = q<HTMLFormElement>('[data-members-search-form]');
const count = q<HTMLElement>('[data-members-count]');
const more = q<HTMLButtonElement>('[data-members-more]');
const retry = q<HTMLButtonElement>('[data-members-retry]');
const back = q<HTMLAnchorElement>('[data-members-back]');
const tools = q('[data-members-tools]');
const audit = q<HTMLButtonElement>('[data-members-audit]');
const orgsBtn = q<HTMLButtonElement>('[data-members-orgs]');
const importBtn = q<HTMLButtonElement>('[data-members-import]');
const auditPanel = q('[data-members-audit-panel]');
const filters = q('[data-members-filters]');
let pending: AbortController | null = null;
let debounce: ReturnType<typeof setTimeout> | undefined;
let offset = 0;
let loadMoreFailed = false;
let who: Session | null = null;
let auditOpen = false;

const listUrl = () => { const url = new URL(location.href); url.searchParams.delete('id'); return url; };
const avatar = (member: MemberProfile) => avatarImg(member, { width: 44, className: 'p-member-avatar', lazy: true });
const plainClick = (event: MouseEvent) => !event.button && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

function publicRow(member: MemberProfile) {
    const row = el('tr');
    const url = listUrl();
    url.searchParams.set('id', member.id);
    const link = el('a', undefined, 'p-member-row');
    link.href = url.pathname + url.search;
    const text = el('span', undefined, 'p-member-copy');
    text.append(el('strong', member.nickname));
    if (member.signature) text.append(el('span', member.signature, 'p-member-signature'));
    const chevron = el('span', '›', 'p-member-chevron');
    chevron.setAttribute('aria-hidden', 'true');
    link.append(avatar(member), text, chevron);
    link.addEventListener('click', event => { if (plainClick(event)) { event.preventDefault(); navigate(url); } });
    row.insertCell().append(link);
    return row;
}

function navigate(url: URL) {
    history.pushState(null, '', url.pathname + url.search);
    void load();
}

async function load(append = false) {
    if (!who || auditOpen) return;
    clearTimeout(debounce);
    pending?.abort();
    const request = new AbortController();
    pending = request;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
    const url = new URL(location.href);
    const id = url.searchParams.get('id');
    const publicView = Boolean(id) || who.user.role === 'user';
    shell.dataset.wide = String(!publicView);
    shell.dataset.memberView = publicView ? 'public' : 'management';
    filters.hidden = publicView;
    tools.hidden = publicView || who.user.role !== 'owner';
    audit.hidden = tools.hidden;
    orgsBtn.hidden = audit.hidden;
    importBtn.hidden = audit.hidden;
    form.hidden = !!id;
    count.hidden = !!id;
    list.hidden = !!id;
    back.hidden = !id;
    profile.hidden = true;
    profile.replaceChildren();
    back.href = listUrl().pathname + listUrl().search;
    search.placeholder = publicView ? '搜索昵称' : '搜索姓名、学号、QQ、组织或职务';
    search.setAttribute('aria-label', publicView ? '搜索昵称' : '搜索成员');
    search.maxLength = publicView ? 40 : 80;
    if (!append) {
        offset = 0;
        body.replaceChildren();
        head.replaceChildren();
        count.textContent = '';
    }
    head.hidden = publicView;
    more.hidden = true;
    retry.hidden = true;
    loadMoreFailed = false;
    message(status, append ? '正在读取更多成员…' : id ? '正在读取成员资料…' : '正在读取成员…');
    try {
        if (!publicView) {
            await showManagement(who, signal, request.signal);
        } else if (id) {
            const { member } = await api<{ member: MemberProfile }>('/members/' + encodeURIComponent(id), undefined, { signal });
            if (request.signal.aborted) return;
            profile.append(avatar(member), el('h2', member.nickname));
            if (member.signature) profile.append(el('p', member.signature));
            profile.hidden = false;
        } else {
            const params = new URLSearchParams({ query: search.value.trim(), offset: String(offset), limit: '50' });
            const result = await api<MemberPage>('/members?' + params, undefined, { signal });
            if (request.signal.aborted) return;
            body.append(...result.items.map(publicRow));
            offset = result.offset + result.items.length;
            count.textContent = result.total + ' 位成员';
            more.hidden = offset >= result.total;
            if (!result.total) { message(status, search.value.trim() ? '没有找到这个昵称' : '暂无成员'); return; }
        }
        if (!request.signal.aborted && (publicView || body.rows.length)) message(status);
    } catch (error) {
        if (request.signal.aborted) return;
        loadMoreFailed = append;
        message(status, error instanceof PlatformError && error.status === 404 ? '找不到这位成员' : errorText(error), 'error');
        retry.hidden = false;
    }
}

function query() {
    if (who?.user.role !== 'user') { renderManagedMembers(); return; }
    const url = listUrl();
    const value = search.value.trim();
    if (value) url.searchParams.set('query', value); else url.searchParams.delete('query');
    history.replaceState(null, '', url.pathname + url.search);
    void load();
}
search.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(query, 220); });
form.addEventListener('submit', event => { event.preventDefault(); clearTimeout(debounce); query(); });
filters.querySelectorAll('select').forEach(filter => filter.addEventListener('change', renderManagedMembers));
audit.addEventListener('click', () => {
    if (who?.user.role !== 'owner' || tools.hidden) return;
    auditOpen = !auditOpen;
    auditPanel.hidden = !auditOpen;
    directory.hidden = auditOpen;
    orgsBtn.hidden = auditOpen;
    importBtn.hidden = auditOpen;
    audit.textContent = auditOpen ? '返回成员' : '操作记录';
    if (auditOpen) { pending?.abort(); void showAudit(who); } else void load();
});
q('[data-audit-refresh]').addEventListener('click', () => { if (auditOpen && who?.user.role === 'owner') void showAudit(who); });
more.addEventListener('click', () => void load(true));
retry.addEventListener('click', () => void (who ? load(loadMoreFailed) : start()));
back.addEventListener('click', event => { if (plainClick(event)) { event.preventDefault(); navigate(listUrl()); } });
window.addEventListener('popstate', () => {
    const params = new URL(location.href).searchParams;
    search.value = params.get('query') ?? '';
    void load();
});
async function start() {
    retry.hidden = true;
    try {
        who = await session(true);
        if (!who) return;
        const params = new URL(location.href).searchParams;
        search.value = params.get('query') ?? '';
        await load();
    } catch (error) { message(status, errorText(error), 'error'); retry.hidden = false; }
}
void start();
