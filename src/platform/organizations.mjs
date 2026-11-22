/**
 * @typedef {object} OrgRecord
 * @property {string} id
 * @property {string} name
 * @property {string | null} parentId
 * @property {string} [kind]
 * @property {boolean} [publicRoster]
 * @property {number} [order]
 * @property {string[]} titles
 * @property {string} [term]
 */

export const defaultClassTitles = ['班长', '副班长', '团支书', '学习委员', '生活委员', '文体委员'];

/** @type {OrgRecord & { term: string }} */
export const studentCenter = {
  id: 'student-development',
  name: '学生发展中心',
  term: '2026-2027',
  parentId: null,
  kind: 'club',
  publicRoster: true,
  order: 10,
  titles: ['主席', '执行主席', '分管主席'],
};

/** @type {OrgRecord[]} */
const departments = [
  { id: 'operations', name: '运营支持部', order: 20 },
  { id: 'yiban', name: '易班建设部', order: 30 },
  { id: 'media', name: '媒体宣传部', order: 40 },
  { id: 'mental-health', name: '心理工作部', order: 50 },
].map(({ id, name, order }) => ({
  id: `${studentCenter.id}/${id}`,
  name,
  parentId: studentCenter.id,
  kind: 'club',
  publicRoster: true,
  order,
  titles: ['部长', '副部长', '部员'],
}));

/** @type {OrgRecord[]} */
export const namedOrganizations = [studentCenter, ...departments];

/**
 * @param {OrgRecord[]} [custom]
 * @returns {OrgRecord[]}
 */
export function mergeOrganizations(custom = []) {
  const byId = new Map(namedOrganizations.map(org => [org.id, { ...org, titles: [...org.titles] }]));
  for (const item of custom || []) {
    if (!item || typeof item.id !== 'string' || !item.id) continue;
    const prev = byId.get(item.id);
    byId.set(item.id, {
      id: item.id,
      name: item.name || prev?.name || item.id,
      parentId: item.parentId ?? null,
      kind: item.kind || prev?.kind || 'other',
      publicRoster: Boolean(item.publicRoster),
      order: Number.isSafeInteger(item.order) ? item.order : (prev?.order ?? 500),
      titles: Array.isArray(item.titles) ? item.titles : (prev?.titles ?? []),
      ...(prev?.term || item.term ? { term: item.term || prev?.term } : {}),
    });
  }
  return [...byId.values()];
}

/**
 * @param {string | null | undefined} id
 * @param {OrgRecord[]} [orgs]
 * @returns {OrgRecord | null}
 */
export function organization(id, orgs = namedOrganizations) {
  if (typeof id !== 'string' || !id) return null;
  const known = orgs.find(org => org.id === id);
  if (known) return known;
  const klass = /^class:([A-Z][0-9]{6,9})$/.exec(id);
  if (klass) {
    return {
      id: klass[0],
      name: `${klass[1]} 班`,
      parentId: null,
      kind: 'academic',
      publicRoster: false,
      order: 500,
      titles: [...defaultClassTitles],
    };
  }
  return null;
}

/**
 * @param {string | null | undefined} id
 * @param {OrgRecord[]} [orgs]
 * @returns {OrgRecord[]}
 */
export function childrenOf(id, orgs = namedOrganizations) {
  return orgs
    .filter(org => (org.parentId ?? null) === (id ?? null))
    .sort((a, b) => (a.order ?? 500) - (b.order ?? 500) || a.name.localeCompare(b.name, 'zh-CN'));
}

/**
 * @param {string | null | undefined} id
 * @param {OrgRecord[]} [orgs]
 * @returns {OrgRecord[]}
 */
export function organizationPath(id, orgs = namedOrganizations) {
  const chain = [];
  const seen = new Set();
  for (let org = organization(id, orgs); org && !seen.has(org.id); org = org.parentId ? organization(org.parentId, orgs) : null) {
    seen.add(org.id);
    chain.unshift(org);
  }
  return chain;
}

/**
 * @param {string | null | undefined} id
 * @param {OrgRecord[]} [orgs]
 * @returns {string}
 */
export function organizationName(id, orgs = namedOrganizations) {
  return organizationPath(id, orgs).map(org => org.name).join(' › ');
}

/**
 * @param {string | null | undefined} id
 * @param {string} scope
 * @param {OrgRecord[]} [orgs]
 * @returns {boolean}
 */
export function isWithin(id, scope, orgs = namedOrganizations) {
  return organizationPath(id, orgs).some(org => org.id === scope);
}

/**
 * @param {OrgRecord[]} [orgs]
 */
export function flattenOrganizationTree(orgs = namedOrganizations) {
  const result = [];
  const visited = new Set();
  const byId = new Map(orgs.map(o => [o.id, o]));

  /** @param {OrgRecord} node @param {number} depth */
  function visit(node, depth) {
    if (!node || visited.has(node.id)) return;
    visited.add(node.id);
    result.push({
      ...node,
      depth,
      fullName: organizationName(node.id, orgs),
    });
    for (const child of childrenOf(node.id, orgs)) {
      visit(child, depth + 1);
    }
  }

  const roots = orgs
    .filter(org => !org.parentId || !byId.has(org.parentId))
    .sort((a, b) => (a.order ?? 500) - (b.order ?? 500) || a.name.localeCompare(b.name, 'zh-CN'));
  for (const root of roots) visit(root, 0);
  for (const org of orgs) {
    if (!visited.has(org.id)) visit(org, 0);
  }
  return result;
}

/**
 * @param {{ title?: string; overseesOrganizationId?: string }} pos
 * @param {OrgRecord[]} [orgs]
 * @returns {string}
 */
export function positionLabel({ title, overseesOrganizationId }, orgs = namedOrganizations) {
  const oversees = overseesOrganizationId ? organization(overseesOrganizationId, orgs) : null;
  return title && oversees ? `${title} · 分管${oversees.name}` : (title || '');
}
