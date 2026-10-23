interface RosterPerson {
  name: string;
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
  term: string;
  totalCount: number;
  activeCount: number;
  groups: RosterGroup[];
}

function createMemberNode(person: RosterPerson, featured: boolean): HTMLElement {
  const article = document.createElement('article');
  article.className = featured ? 'member member-featured' : 'member';

  const img = document.createElement('img');
  img.className = 'member-avatar';
  img.src = person.avatarUrl;
  img.alt = `${person.name}的头像`;
  img.width = featured ? 68 : 58;
  img.height = featured ? 68 : 58;
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  article.append(img);

  const copy = document.createElement('div');
  copy.className = 'member-copy';

  const h4 = document.createElement('h4');
  h4.textContent = person.name;
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

async function initRoster() {
  const section = document.querySelector<HTMLElement>('[data-roster-term]');
  const container = document.querySelector<HTMLElement>('[data-roster-container]');
  const countNode = document.querySelector<HTMLElement>('[data-roster-count]');
  if (!section || !container) return;

  const term = section.dataset.rosterTerm || '2026-2027';
  try {
    const res = await fetch(`/api/platform/public/roster?term=${encodeURIComponent(term)}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as RosterSnapshot;

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
      const isFeatured = index === 0 || group.name === '主席团与统筹';
      for (const person of group.people) {
        grid.append(createMemberNode(person, Boolean(person.featured ?? isFeatured)));
      }
      groupSec.append(grid);
      container.append(groupSec);
    });
  } catch {
    if (countNode) countNode.textContent = '名册暂不可用';
    container.innerHTML = '<p style="padding: 24px 0; color: var(--muted); font-size: .9rem;">名册加载未完成，请稍后刷新页面重试。</p>';
  }
}

void initRoster();
