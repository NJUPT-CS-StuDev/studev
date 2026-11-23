import { avatarImg } from '../../platform/client/api';
import { addDays } from '../../campus/world/time';
import { validAcademicYear } from '../../platform/organizations.mjs';

interface RosterPerson {
  id: string;
  name?: string;
  nickname: string;
  role?: string;
  avatarUrl: string;
  signature?: string;
  featured?: boolean;
  startsOn: string;
  endsBefore: string;
}

interface RosterGroup {
  name: string;
  people: RosterPerson[];
}

interface Roster {
  view: 'today' | 'year';
  year: string;
  years: string[];
  today: string;
  totalCount: number;
  groups: RosterGroup[];
}

function createMemberNode(person: RosterPerson, featured: boolean, first: boolean, showPeriod: boolean): HTMLElement {
  const article = document.createElement('article');
  article.className = featured ? 'member member-featured' : 'member';
  if (first) article.id = 'member-' + person.id;
  article.append(avatarImg(person, { width: featured ? 52 : 48, className: 'member-avatar', lazy: !featured }));

  const copy = document.createElement('div');
  copy.className = 'member-copy';

  const h4 = document.createElement('h4');
  h4.textContent = person.name || person.nickname;
  if (person.name && person.nickname && person.nickname !== person.name) {
    const nick = document.createElement('small');
    nick.className = 'member-nickname';
    nick.textContent = person.nickname;
    h4.append(' ', nick);
  }
  copy.append(h4);

  if (person.role) {
    const role = document.createElement('p');
    role.className = 'member-role';
    role.textContent = person.role;
    copy.append(role);
  }

  if (showPeriod) {
    const period = document.createElement('p');
    period.className = 'member-period';
    const start = document.createElement('time');
    const end = document.createElement('time');
    start.dateTime = start.textContent = person.startsOn;
    end.dateTime = end.textContent = addDays(person.endsBefore, -1);
    period.append(start, ' 至 ', end);
    copy.append(period);
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
  data: Roster
) {
  if (countNode) {
    countNode.textContent = `${data.totalCount} 人`;
  }
  if (tabCountNode) {
    tabCountNode.textContent = String(data.totalCount);
  }
  container.replaceChildren();
  if (!data.groups.length) {
    const empty = document.createElement('p');
    empty.className = 'roster-empty';
    empty.textContent = data.view === 'today' ? '目前没有公开的在任成员。' : '该学年暂无公开任职记录。';
    container.append(empty);
    return;
  }
  const anchored = new Set<string>();
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
      grid.append(createMemberNode(person, Boolean(person.featured ?? isFeatured), !anchored.has(person.id), data.view === 'year'));
      anchored.add(person.id);
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

function initMobileTabs(showRoster: () => void) {
  const viewRoot = document.querySelector<HTMLElement>('[data-history-view]');
  if (!viewRoot) return;
  const triggers = viewRoot.querySelectorAll<HTMLButtonElement>('[data-tab-trigger]');
  triggers.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tabTrigger === 'people' ? 'people' : 'events';
      setActiveTab(targetTab);
      if (targetTab === 'people') showRoster();
    });
  });
}

function scrollToHashTarget(activateTab = true) {
  if (!location.hash) return;
  try {
    const rawId = decodeURIComponent(location.hash.slice(1));
    if (activateTab) {
      if (rawId === 'people' || rawId.startsWith('member-')) setActiveTab('people');
      else if (rawId === 'events') setActiveTab('events');
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

function initRoster() {
  const section = document.querySelector<HTMLElement>('[data-roster-year]');
  const container = document.querySelector<HTMLElement>('[data-roster-container]');
  const countNode = document.querySelector<HTMLElement>('[data-roster-count]');
  const tabCountNode = document.querySelector<HTMLElement>('[data-roster-tab-count]');
  const selector = document.querySelector<HTMLSelectElement>('[data-roster-selector]');
  const retry = document.querySelector<HTMLButtonElement>('[data-roster-retry]');
  if (!section || !container || !countNode || !selector || !retry) return;

  const defaultYear = section.dataset.rosterYear || 'today';
  const selected = () => {
    const year = new URLSearchParams(location.search).get('year') ?? defaultYear;
    return year === 'today' || validAcademicYear(year) ? year : defaultYear;
  };
  let pending: { year: string; controller: AbortController } | undefined;
  let drawnYear: string | undefined;
  const load = async (year: string) => {
    pending?.controller.abort();
    const request = new AbortController();
    pending = { year, controller: request };
    selector.value = year;
    retry.hidden = true;
    countNode.textContent = '正在读取名册';
    container.setAttribute('aria-busy', 'true');
    if (drawnYear && drawnYear !== year) {
      drawnYear = undefined;
      container.replaceChildren();
    }
    const url = new URL('/api/platform/public/roster', location.origin);
    if (year !== 'today') url.searchParams.set('year', year);
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' }, cache: 'no-store',
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Roster;
      if (request.signal.aborted) return;
      const years = [...new Set([data.year, ...data.years])].filter(validAcademicYear).sort().reverse();
      selector.replaceChildren(new Option('当前在任', 'today'), ...years.map(value => new Option(`${value} 学年`, value)));
      selector.value = data.view === 'today' ? 'today' : data.year;
      selector.disabled = false;
      drawnYear = year;
      renderRoster(container, countNode, tabCountNode, data);
      scrollToHashTarget(false);
    } catch {
      if (request.signal.aborted) return;
      drawnYear = undefined;
      countNode.textContent = '名册暂不可用';
      if (tabCountNode) tabCountNode.textContent = '—';
      container.replaceChildren();
      retry.hidden = false;
    } finally {
      if (!request.signal.aborted) {
        pending = undefined;
        container.removeAttribute('aria-busy');
      }
    }
  };

  selector.addEventListener('change', () => {
    const year = selector.value;
    const url = new URL(location.href);
    if (year === defaultYear) url.searchParams.delete('year');
    else url.searchParams.set('year', year);
    if (!url.hash.startsWith('#member-')) url.hash = 'people';
    history.pushState(history.state, '', url);
    void load(year);
  });
  retry.addEventListener('click', () => void load(selected()));
  const showRoster = () => {
    const year = selected();
    if ((pending?.year ?? drawnYear) !== year) void load(year);
  };
  const showVisibleRoster = () => {
    if (section.closest<HTMLElement>('[data-history-view]')?.dataset.activeTab === 'people') showRoster();
  };
  const showFromHash = () => {
    if (!location.hash && new URLSearchParams(location.search).has('year')) setActiveTab('people');
    scrollToHashTarget();
    showVisibleRoster();
  };
  initMobileTabs(showRoster);
  window.addEventListener('hashchange', showFromHash);
  window.addEventListener('popstate', showVisibleRoster);
  showFromHash();
}

initRoster();
