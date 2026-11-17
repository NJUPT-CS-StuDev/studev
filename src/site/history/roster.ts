import { avatarImg } from '../../platform/client/api';

interface RosterPerson {
  id: string;
  nickname: string;
  role?: string;
  avatarUrl: string;
  signature?: string;
  featured?: boolean;
}

interface RosterGroup {
  name: string;
  people: RosterPerson[];
}

interface RosterSnapshot {
  schema?: number;
  term: string;
  totalCount: number;
  activeCount: number;
  groups: RosterGroup[];
}

function createMemberNode(person: RosterPerson, featured: boolean): HTMLElement {
  const article = document.createElement('article');
  article.className = featured ? 'member member-featured' : 'member';
  article.id = 'member-' + person.id;
  article.append(avatarImg(person, { width: featured ? 52 : 48, className: 'member-avatar', lazy: !featured }));

  const copy = document.createElement('div');
  copy.className = 'member-copy';

  const h4 = document.createElement('h4');
  h4.textContent = person.nickname;
  copy.append(h4);

  if (person.role) {
    const role = document.createElement('p');
    role.className = 'member-role';
    role.textContent = person.role;
    copy.append(role);
  }

  if (person.signature) {
    const sig = document.createElement('p');
    sig.className = 'member-signature';
    sig.textContent = person.signature;
    copy.append(sig);
  }

  article.append(copy);
  return article;
}

function renderRoster(
  container: HTMLElement,
  countNode: HTMLElement | null,
  tabCountNode: HTMLElement | null,
  data: RosterSnapshot
) {
  if (countNode) {
    countNode.textContent = `${data.totalCount} 人`;
  }
  if (tabCountNode) {
    tabCountNode.textContent = String(data.totalCount);
  }
  container.replaceChildren();
  data.groups.forEach((group, index) => {
    const groupSec = document.createElement('section');
    groupSec.className = 'member-group';
    const headingId = `group-${index}`;
    groupSec.setAttribute('aria-labelledby', headingId);

    const headRow = document.createElement('div');
    headRow.className = 'member-group-header';

    const h3 = document.createElement('h3');
    h3.id = headingId;
    h3.textContent = group.name;
    headRow.append(h3);

    const badge = document.createElement('span');
    badge.className = 'member-group-count';
    badge.textContent = String(group.people.length);
    headRow.append(badge);

    groupSec.append(headRow);

    const grid = document.createElement('div');
    grid.className = 'member-grid';
    const isFeatured = index === 0 || group.name === '主席团';
    for (const person of group.people) {
      grid.append(createMemberNode(person, Boolean(person.featured ?? isFeatured)));
    }
    groupSec.append(grid);
    container.append(groupSec);
  });
}

function setActiveTab(tab: 'events' | 'people') {
  const viewRoot = document.querySelector<HTMLElement>('[data-history-view]');
  if (!viewRoot) return;
  viewRoot.dataset.activeTab = tab;
  const triggers = viewRoot.querySelectorAll<HTMLButtonElement>('[data-tab-trigger]');
  triggers.forEach((btn) => {
    const isMatch = btn.dataset.tabTrigger === tab;
    btn.classList.toggle('is-active', isMatch);
    btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
  });
}

function initMobileTabs() {
  const viewRoot = document.querySelector<HTMLElement>('[data-history-view]');
  if (!viewRoot) return;
  const triggers = viewRoot.querySelectorAll<HTMLButtonElement>('[data-tab-trigger]');
  triggers.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tabTrigger === 'people' ? 'people' : 'events';
      setActiveTab(targetTab);
    });
  });
}

function scrollToHashTarget() {
  if (!location.hash) return;
  try {
    const rawId = decodeURIComponent(location.hash.slice(1));
    if (rawId === 'people' || rawId.startsWith('member-')) {
      setActiveTab('people');
    } else if (rawId === 'events') {
      setActiveTab('events');
    }
    if (rawId === 'people' || rawId === 'events') return;

    document.querySelectorAll('.member.member-highlight').forEach((el) => el.classList.remove('member-highlight'));
    const target = document.getElementById(rawId);
    if (target) {
      target.classList.add('member-highlight');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } catch {}
}

async function initRoster() {
  initMobileTabs();
  window.addEventListener('hashchange', scrollToHashTarget);

  const section = document.querySelector<HTMLElement>('[data-roster-term]');
  const container = document.querySelector<HTMLElement>('[data-roster-container]');
  const countNode = document.querySelector<HTMLElement>('[data-roster-count]');
  const tabCountNode = document.querySelector<HTMLElement>('[data-roster-tab-count]');
  if (!section || !container) return;

  scrollToHashTarget();

  const term = section.dataset.rosterTerm || '2026-2027';
  try {
    const res = await fetch(`/api/platform/public/roster?term=${encodeURIComponent(term)}`, {
      headers: { Accept: 'application/json' }, cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as RosterSnapshot;
    renderRoster(container, countNode, tabCountNode, data);
    scrollToHashTarget();
  } catch {
    if (countNode) countNode.textContent = '名册暂不可用';
    container.replaceChildren();
    const err = document.createElement('p');
    err.style.padding = '24px 0';
    err.style.color = 'var(--muted)';
    err.style.fontSize = '.9rem';
    err.textContent = '名册加载未完成，请稍后刷新页面重试。';
    container.append(err);
  }
}

void initRoster();
