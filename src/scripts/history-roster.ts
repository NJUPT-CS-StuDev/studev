interface RosterPerson {
  name: string;
  nickname?: string;
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
  article.id = `member-${person.name}`;

  const img = document.createElement('img');
  img.className = 'member-avatar';
  img.src = person.avatarUrl;
  img.alt = `${person.name}的头像`;
  img.width = featured ? 68 : 58;
  img.height = featured ? 68 : 58;
  img.loading = featured ? 'eager' : 'lazy';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  article.append(img);

  const copy = document.createElement('div');
  copy.className = 'member-copy';

  const h4 = document.createElement('h4');
  h4.textContent = person.name;
  if (person.nickname && person.nickname !== person.name) {
    const nick = document.createElement('span');
    nick.className = 'member-nick';
    nick.textContent = person.nickname;
    h4.append(nick);
  }
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

function renderRoster(container: HTMLElement, countNode: HTMLElement | null, data: RosterSnapshot) {
  if (countNode) {
    countNode.textContent = `${data.totalCount} 人`;
  }
  container.replaceChildren();
  data.groups.forEach((group, index) => {
    const groupSec = document.createElement('section');
    groupSec.className = 'member-group';
    const headingId = `group-${index}`;
    groupSec.setAttribute('aria-labelledby', headingId);

    const h3 = document.createElement('h3');
    h3.id = headingId;
    h3.textContent = group.name;
    groupSec.append(h3);

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

function scrollToHashTarget() {
  if (!location.hash || location.hash === '#people') return;
  try {
    const rawId = decodeURIComponent(location.hash.slice(1));
    const target = document.getElementById(rawId);
    if (target) {
      target.classList.add('member-highlight');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } catch {}
}

async function initRoster() {
  const section = document.querySelector<HTMLElement>('[data-roster-term]');
  const container = document.querySelector<HTMLElement>('[data-roster-container]');
  const countNode = document.querySelector<HTMLElement>('[data-roster-count]');
  if (!section || !container) return;

  const term = section.dataset.rosterTerm || '2026-2027';
  const cacheKey = `studev_roster_${term}`;
  let cachedRaw = '';

  // 0ms instant hydration from local cache (SWR)
  try {
    const saved = localStorage.getItem(cacheKey);
    if (saved) {
      const parsed = JSON.parse(saved) as RosterSnapshot;
      if (parsed && parsed.schema === 3 && Array.isArray(parsed.groups) && parsed.groups.length > 0) {
        cachedRaw = JSON.stringify(parsed.groups);
        renderRoster(container, countNode, parsed);
        scrollToHashTarget();
      }
    }
  } catch {}

  try {
    const res = await fetch(`/api/platform/public/roster?term=${encodeURIComponent(term)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as RosterSnapshot;
    const freshRaw = JSON.stringify(data.groups);
    try {
      localStorage.setItem(cacheKey, JSON.stringify(data));
    } catch {}
    if (freshRaw !== cachedRaw) {
      renderRoster(container, countNode, data);
      scrollToHashTarget();
    }
  } catch {
    if (!cachedRaw) {
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
}

void initRoster();
