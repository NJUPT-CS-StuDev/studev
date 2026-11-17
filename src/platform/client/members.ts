import { api, avatarImg, el, errorText, message, PlatformError, q, session, type MemberPage, type MemberProfile } from './api';

const status = q<HTMLElement>('[data-members-status]');
const list = q<HTMLElement>('[data-members-list]');
const profile = q<HTMLElement>('[data-members-profile]');
const search = q<HTMLInputElement>('[data-members-search]');
const form = q<HTMLFormElement>('[data-members-search-form]');
const count = q<HTMLElement>('[data-members-count]');
const more = q<HTMLButtonElement>('[data-members-more]');
const retry = q<HTMLButtonElement>('[data-members-retry]');
const back = q<HTMLAnchorElement>('[data-members-back]');
const title = q<HTMLElement>('[data-members-title]');
let pending: AbortController | null = null;
let debounce: ReturnType<typeof setTimeout> | undefined;
let offset = 0;
let loadMoreFailed = false;
let authorized = false;

function listUrl(): URL { const url = new URL(location.href); url.searchParams.delete('id'); return url; }
function avatar(member: MemberProfile) { return avatarImg(member, { width:44, className:'p-member-avatar', lazy:true }); }
function row(member: MemberProfile): HTMLAnchorElement {
    const link = el('a', undefined, 'p-member-row');
    const url = listUrl(); url.searchParams.set('id', member.id); link.href = url.pathname + url.search;
    const copy = el('div', undefined, 'p-member-copy'); copy.append(el('strong', member.nickname));
    if (member.signature) copy.append(el('p', member.signature));
    const chevron = el('span', '›', 'p-member-chevron'); chevron.setAttribute('aria-hidden','true');
    link.append(avatar(member), copy, chevron);
    link.addEventListener('click', event => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate(url); });
    return link;
}
function navigate(url: URL) { history.pushState(null,'',url.pathname+url.search); void load(); }

async function load(append = false) {
    clearTimeout(debounce); pending?.abort(); const controller = new AbortController(); pending = controller;
    const signal = AbortSignal.any([controller.signal,AbortSignal.timeout(10_000)]);
    const url = new URL(location.href), id = url.searchParams.get('id');
    form.hidden = !!id; count.hidden = !!id; list.hidden = !!id; title.hidden = !!id; back.hidden = !id;
    profile.hidden = true; profile.replaceChildren(); back.href = listUrl().pathname + listUrl().search;
    if (!append) { offset=0; list.replaceChildren(); count.textContent=''; }
    search.value = url.searchParams.get('query') ?? '';
    more.hidden = true; retry.hidden = true; loadMoreFailed = false;
    message(status, append ? '正在读取更多成员…' : id ? '正在读取成员资料…' : '正在读取成员…');
    try {
        if (id) {
            const result = await api<{member:MemberProfile}>(`/members/${encodeURIComponent(id)}`, undefined, {signal});
            if (controller.signal.aborted) return;
            const member = result.member;
            profile.append(avatar(member),el('h1',member.nickname),el('p',member.signature || '还没有签名'));
            profile.hidden=false; document.title=`${member.nickname} — StuDev`;
        } else {
            const params = new URLSearchParams({query:search.value.trim(),offset:String(offset),limit:'50'});
            const page = await api<MemberPage>(`/members?${params}`,undefined,{signal});
            if (controller.signal.aborted) return;
            list.append(...page.items.map(row)); offset=page.offset+page.items.length;
            count.textContent=`${page.total} 位成员`; more.hidden=offset>=page.total;
            document.title='成员 — StuDev';
            if (!page.total) { message(status, search.value.trim() ? '没有找到这个昵称' : '暂无成员'); return; }
        }
        message(status);
    } catch (error) {
        if (controller.signal.aborted) return;
        loadMoreFailed=append;
        message(status,error instanceof PlatformError && error.status===404 ? '找不到这位成员' : errorText(error),'error');
        retry.hidden=false;
    }
}
function query() {
    const url=listUrl(), value=search.value.trim();
    if (value) url.searchParams.set('query',value); else url.searchParams.delete('query');
    history.replaceState(null,'',url.pathname+url.search); void load();
}
search.addEventListener('input',()=>{ clearTimeout(debounce); pending?.abort(); debounce=setTimeout(query,250); });
form.addEventListener('submit',event=>{ event.preventDefault(); query(); });
more.addEventListener('click',()=>void load(true));
retry.addEventListener('click',()=>void (authorized ? load(loadMoreFailed) : start()));
back.addEventListener('click',event=>{ if(event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return; event.preventDefault(); navigate(listUrl()); });
window.addEventListener('popstate',()=>void load());
async function start() {
    retry.hidden=true; message(status,'正在读取成员…');
    try { if (await session(true)) { authorized=true; await load(); } }
    catch (error) { message(status,errorText(error),'error'); retry.hidden=false; }
}
void start();
