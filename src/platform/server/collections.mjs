import { randomUUID } from 'node:crypto';
import { fail, readJson, response, text } from './common.mjs';
import { loadOrganizations } from './organizations.mjs';
import {
  flattenOrganizationTree,
  isWithin,
  organization,
  organizationName,
  organizationPath,
  positionLabel,
} from '../organizations.mjs';

const API = '/api/platform/collections';
const CATALOG_KEY = 'collections/catalog.json';
const itemIndexKey = (itemId) => `collections/item-index/${itemId}.json`;
const ID = /^[a-zA-Z0-9_-]{4,80}$/;
const MAX_FILE = 50 * 1024 * 1024;
const DEFAULT_EXTS = ['doc', 'docx', 'pdf', 'zip', 'xlsx', 'pptx', 'jpg', 'png'];

function oscaConfig(env, itemId) {
  let endpoint;
  try { endpoint = new URL(env.OSCA_ENDPOINT); } catch { fail(503, 'NOT_CONFIGURED', '文件存储尚未配置。'); }
  if (
    endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
    endpoint.pathname !== '/' || !/^[a-zA-Z0-9._-]{1,150}$/.test(env.OSCA_BUCKET || '') ||
    ![env.OSCA_ACCESS_KEY_ID, env.OSCA_SECRET_ACCESS_KEY].every((v) => typeof v === 'string' && v)
  ) fail(503, 'NOT_CONFIGURED', '文件存储配置无效。');
  const prefix = env.OSCA_PREFIX || 'studev-submissions/';
  return {
    endpoint: endpoint.origin,
    bucket: env.OSCA_BUCKET,
    accessKeyId: env.OSCA_ACCESS_KEY_ID,
    secretAccessKey: env.OSCA_SECRET_ACCESS_KEY,
    region: env.OSCA_REGION || 'us-east-1',
    objectPrefix: `${prefix}collections/${itemId}/`,
  };
}

function csvCell(value) {
  const s = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function normSid(v) {
  return String(v || '').normalize('NFKC').trim().toUpperCase();
}

function parseExts(value) {
  const arr = Array.isArray(value)
    ? value
    : String(value || '').split(/[,/\s]+/);
  const cleaned = [...new Set(arr.map((v) => String(v || '').trim().replace(/^\./, '').toLowerCase()).filter(Boolean))];
  if (!cleaned.length || cleaned.length > 20 || cleaned.some((v) => !/^[a-z0-9]{1,10}$/.test(v))) {
    fail(400, 'INVALID_EXTENSIONS', '请填写有效的文件后缀（如 docx, pdf）。');
  }
  return cleaned;
}

function parseDeadline(value) {
  if (!value) return '';
  const s = String(value).trim();
  const parsed = Date.parse(s);
  if (!Number.isFinite(parsed)) fail(400, 'INVALID_DEADLINE', '截止时间格式无效。');
  return new Date(parsed).toISOString();
}

function parseFiles(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) fail(400, 'INVALID_FILES', '请设置 1–6 项提交要求。');
  return value.map((f, idx) => {
    const id = typeof f?.id === 'string' && /^[a-z0-9_-]{1,24}$/.test(f.id) ? f.id : `f${idx + 1}`;
    const name = text(f?.name, '提交项名称', 60, true);
    const extensions = parseExts(f?.extensions?.length ? f.extensions : DEFAULT_EXTS);
    const maxBytes = Number.isSafeInteger(f?.maxBytes) && f.maxBytes > 0 && f.maxBytes <= MAX_FILE ? f.maxBytes : 20 * 1024 * 1024;
    return { id, name, extensions, maxBytes };
  });
}

function parsePolicy(value) {
  const p = value || 'strict';
  if (!['strict', 'allow-late', 'closed'].includes(p)) fail(400, 'INVALID_POLICY', '提交状态无效。');
  return p;
}

function parseRecipients(value) {
  if (!Array.isArray(value)) return [];
  if (value.length > 1000) fail(400, 'TOO_MANY_RECIPIENTS', '单次收集最多选择 1000 人。');
  const map = new Map();
  for (const row of value) {
    const sid = normSid(row?.studentId);
    if (!/^[A-Z0-9]{4,24}$/.test(sid)) fail(400, 'INVALID_STUDENT_ID', `学号格式无效：${row?.studentId || ''}`);
    const name = text(row?.name || row?.realName || sid, '姓名', 40, true);
    map.set(sid, { studentId: sid, name });
  }
  return [...map.values()].sort((a, b) => a.studentId.localeCompare(b.studentId));
}

function computeStatus(sub, round) {
  if (!sub) return 'missing';
  if (round.deadline && sub.submittedAt && Date.parse(sub.submittedAt) > Date.parse(round.deadline)) return 'late';
  return 'submitted';
}

function safeFilePart(value) {
  return String(value || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '').replace(/\s+/g, '').slice(0, 60).replace(/^\.+$/, '') || 'item';
}

function uploadTarget(item, round, session, body, now) {
  const onBehalf = session.user.role === 'owner' && Boolean(body.studentId);
  const sid = normSid(onBehalf ? body.studentId : session.user.studentId);
  if (!/^[A-Z0-9]{1,80}$/.test(sid)) fail(400, 'INVALID_STUDENT_ID', '学号无效。');
  const recipient = (item.recipients || []).find((student) => student.studentId === sid);
  if (!onBehalf) {
    if (round.policy === 'closed') fail(400, 'ROUND_CLOSED', '当前批次已关闭提交。');
    if (round.policy === 'strict' && round.deadline && now > Date.parse(round.deadline)) fail(400, 'DEADLINE_PASSED', '已超过截止时间，无法提交。');
    if (item.targetMode !== 'open' && !['owner', 'admin'].includes(session.user.role) && !recipient) {
      fail(403, 'NOT_IN_RECIPIENTS', '你不在本次收集名单中。');
    }
  }
  const name = onBehalf ? text(body.studentName || recipient?.name || sid, '姓名', 40, true)
    : (recipient?.name || session.user.realName || session.user.nickname || sid);
  return { onBehalf, sid, name };
}

function buildIssuerOptions(user, orgs) {
  const flat = flattenOrganizationTree(orgs);
  const options = [];
  const seen = new Set();
  const pushOption = (organizationId, title, label) => {
    const key = `${organizationId}::${title}`;
    if (seen.has(key)) return;
    seen.add(key);
    const org = organization(organizationId, orgs);
    if (!org) return;
    options.push({
      organizationId: org.id,
      organizationName: organizationName(org.id, orgs),
      orgShortName: org.name,
      title,
      label,
    });
  };

  for (const m of user.memberships || []) {
    const org = organization(m.organizationId, orgs);
    if (!org) continue;
    const pos = positionLabel(m, orgs);
    pushOption(org.id, pos, pos ? `${org.name} · ${pos}` : org.name);
    const chain = organizationPath(org.id, orgs);
    for (let i = chain.length - 2; i >= 0; i--) {
      const anc = chain[i];
      const ancTitle = pos ? `${org.name} ${pos}` : org.name;
      pushOption(anc.id, ancTitle, `${anc.name}（${ancTitle}）`);
    }
  }

  if (user.role === 'owner') {
    for (const org of flat) {
      if (!options.some((o) => o.organizationId === org.id)) {
        pushOption(org.id, '', org.fullName);
      }
    }
  }
  return options;
}

function canIssueUnder(user, orgId, orgs) {
  if (user.role === 'owner') return true;
  return (user.memberships || []).some((m) => isWithin(m.organizationId, orgId, orgs));
}

function issuerView(issuer, orgs) {
  if (!issuer?.organizationId) {
    return {
      userId: issuer?.userId || '',
      name: issuer?.name || '',
      organizationId: '',
      organizationName: '',
      orgShortName: '',
      title: issuer?.title || '',
    };
  }
  const org = organization(issuer.organizationId, orgs);
  return {
    userId: issuer.userId || '',
    name: issuer.name || '',
    organizationId: issuer.organizationId,
    organizationName: organizationName(issuer.organizationId, orgs) || issuer.organizationId,
    orgShortName: org?.name || issuer.organizationId,
    title: issuer.title || '',
  };
}

function personOrgLabel(user, preferOrgId, orgs) {
  const memberships = user?.memberships || [];
  if (!memberships.length) return '';
  if (preferOrgId) {
    const matching = memberships.find((m) => isWithin(m.organizationId, preferOrgId, orgs));
    if (matching) return organization(matching.organizationId, orgs)?.name || '';
  }
  const academic = memberships.find((m) => organization(m.organizationId, orgs)?.kind === 'academic');
  const picked = academic || memberships[0];
  return organization(picked.organizationId, orgs)?.name || '';
}

function submissionsByStudent(submissions) {
  const grouped = new Map();
  for (const submission of submissions) {
    const own = grouped.get(submission.studentId);
    if (own) own.push(submission);
    else grouped.set(submission.studentId, [submission]);
  }
  return grouped;
}

export function createCollectionsService({ repo, identity, env, now = Date.now, getGateway }) {
  async function getOrgs() {
    if (typeof identity.loadOrganizations === 'function') return identity.loadOrganizations();
    return loadOrganizations(repo);
  }

  async function getAllUsers() {
    if (typeof identity.loadAllUsers === 'function') return identity.loadAllUsers();
    return [];
  }

  async function listItems() {
    const keys = await repo.list('collections/items/');
    const items = await Promise.all(keys.map((k) => repo.get(k)));
    return items.filter(Boolean).sort((a, b) => (b.term || '').localeCompare(a.term || '') || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  async function listRoundSubmissionsCanonical(itemId, roundId) {
    const keys = await repo.list(`collections/submissions/${itemId}/${roundId}/`);
    const rows = [];
    for (let offset = 0; offset < keys.length; offset += 32) {
      rows.push(...await Promise.all(keys.slice(offset, offset + 32).map((k) => repo.get(k))));
    }
    return rows.filter(Boolean);
  }

  function compactSub(s) {
    return {
      fileId: s.fileId,
      studentId: s.studentId,
      studentName: s.studentName || '',
      storedName: s.storedName,
      objectKey: s.objectKey,
      etag: s.etag || '',
      sizeBytes: s.sizeBytes || 0,
      submittedAt: s.submittedAt || '',
      revisions: s.revisions || 1,
    };
  }

  async function loadItemSubmissions(item, { refresh = false } = {}) {
    if (!refresh) {
      const idx = await repo.get(itemIndexKey(item.id));
      if (idx?.version === 1 && idx.byRound) {
        const subsByRound = {};
        for (const rd of item.rounds || []) {
          subsByRound[rd.id] = Object.values(idx.byRound[rd.id] || {});
        }
        return subsByRound;
      }
    }
    const byRound = {};
    const subsByRound = {};
    for (const rd of item.rounds || []) {
      const subs = await listRoundSubmissionsCanonical(item.id, rd.id);
      subsByRound[rd.id] = subs;
      const map = {};
      for (const s of subs) map[`${s.fileId}::${s.studentId}`] = compactSub(s);
      byRound[rd.id] = map;
    }
    await repo.put(itemIndexKey(item.id), { version: 1, byRound });
    return subsByRound;
  }

  function buildCatalogEntry(item, subsByRound) {
    const targetMode = item.targetMode === 'open' ? 'open' : 'selected';
    const recipientIds = targetMode === 'selected' ? (item.recipients || []).map((r) => r.studentId) : [];
    const recipientCount = recipientIds.length;
    const rounds = (item.rounds || []).map((rd) => {
      const subs = subsByRound[rd.id] || [];
      const byStu = submissionsByStudent(subs);
      const statusBySid = {};
      let submittedCount = 0;
      for (const [sid, own] of byStu.entries()) {
        if (rd.files.every((f) => own.some((s) => s.fileId === f.id))) {
          submittedCount++;
          statusBySid[sid] = own.some((s) => computeStatus(s, rd) === 'late') ? 'late' : 'submitted';
        }
      }
      return {
        id: rd.id,
        label: rd.label,
        deadline: rd.deadline,
        policy: rd.policy,
        fileCount: rd.files.length,
        submittedCount,
        totalCount: targetMode === 'open' ? submittedCount : recipientCount,
        statusBySid,
      };
    });
    return {
      id: item.id,
      term: item.term,
      termLabel: item.termLabel,
      code: item.code || '',
      name: item.name,
      category: item.category,
      issuer: item.issuer || {},
      targetMode,
      recipientCount,
      recipientIds,
      rounds,
      updatedAt: item.updatedAt,
    };
  }

  async function loadCatalog({ refresh = false } = {}) {
    if (!refresh) {
      const cat = await repo.get(CATALOG_KEY);
      if (cat?.version === 1 && cat.items) return cat;
    }
    const items = await listItems();
    const entries = {};
    for (const item of items) {
      const subsByRound = await loadItemSubmissions(item, { refresh });
      entries[item.id] = buildCatalogEntry(item, subsByRound);
    }
    const cat = { version: 1, items: entries };
    await repo.put(CATALOG_KEY, cat);
    return cat;
  }

  async function syncCatalogItem(item, subsByRound) {
    const existing = await repo.get(CATALOG_KEY);
    if (!existing || existing.version !== 1 || !existing.items) return;
    const subs = subsByRound || await loadItemSubmissions(item);
    existing.items[item.id] = buildCatalogEntry(item, subs);
    await repo.put(CATALOG_KEY, existing);
  }

  async function removeCatalogItem(itemId) {
    await repo.remove(itemIndexKey(itemId));
    const existing = await repo.get(CATALOG_KEY);
    if (!existing || existing.version !== 1 || !existing.items) return;
    delete existing.items[itemId];
    await repo.put(CATALOG_KEY, existing);
  }

  async function handle(context, path) {
    if (path !== API && !path.startsWith(`${API}/`)) return null;
    const request = context.request;
    const method = request.method;
    const url = new URL(request.url);

    // 1. Public list of all collections (single-blob catalog read; supports ?orgId=... & ?refresh=1)
    if (path === API && method === 'GET') {
      const sessionRead = identity.authenticate(request);
      const refresh = url.searchParams.get('refresh') === '1';
      const catalogRead = refresh
        ? sessionRead.then((session) => loadCatalog({ refresh: ['owner', 'admin'].includes(session?.user.role) }))
        : loadCatalog();
      const [session, catalog, orgs] = await Promise.all([sessionRead, catalogRead, getOrgs()]);
      const mySid = session ? normSid(session.user.studentId) : '';
      const isStaff = Boolean(session && ['owner', 'admin'].includes(session.user.role));
      const orgFilter = (url.searchParams.get('orgId') || '').trim();

      const allEntries = Object.values(catalog.items || {}).sort(
        (a, b) => (b.term || '').localeCompare(a.term || '') || (b.updatedAt || '').localeCompare(a.updatedAt || '')
      );
      const filtered = orgFilter
        ? allEntries.filter((item) => item.issuer?.organizationId && isWithin(item.issuer.organizationId, orgFilter, orgs))
        : allEntries;

      const viewItems = filtered.map((item) => {
        const targetMode = item.targetMode === 'open' ? 'open' : 'selected';
        const recipientIds = item.recipientIds || [];
        const inRecipients = Boolean(mySid && (targetMode === 'open' || recipientIds.includes(mySid)));
        const isIssuer = Boolean(session && item.issuer?.userId === session.user.id);
        const inMine = inRecipients || isIssuer;

        const roundsSummary = (item.rounds || []).map((rd) => {
          let myStatus = null;
          if (mySid && inRecipients) {
            myStatus = rd.statusBySid?.[mySid] || 'missing';
          }
          return {
            id: rd.id,
            label: rd.label,
            deadline: rd.deadline,
            policy: rd.policy,
            fileCount: rd.fileCount,
            submittedCount: rd.submittedCount,
            totalCount: rd.totalCount,
            myStatus,
          };
        });
        return {
          id: item.id,
          term: item.term,
          termLabel: item.termLabel,
          code: item.code || '',
          name: item.name,
          category: item.category,
          issuer: issuerView(item.issuer, orgs),
          targetMode,
          recipientCount: item.recipientCount,
          inRecipients,
          isIssuer,
          inMine,
          rounds: roundsSummary,
          updatedAt: item.updatedAt,
        };
      });

      return response({
        viewer: session ? {
          id: session.user.id,
          studentId: mySid,
          name: session.user.realName || session.user.nickname,
          role: session.user.role,
          isStaff,
        } : null,
        organizations: flattenOrganizationTree(orgs),
        ...(isStaff ? { issuerOptions: buildIssuerOptions(session.user, orgs) } : {}),
        items: viewItems,
      });
    }

    // 2. Staff directory for the Organization Tree People Picker
    if (path === `${API}/people` && method === 'GET') {
      await identity.authenticate(request, { staff: true });
      const [orgs, users] = await Promise.all([getOrgs(), getAllUsers()]);
      const people = users
        .filter((u) => u && u.status !== 'disabled' && u.studentId)
        .map((u) => ({
          id: u.id,
          studentId: normSid(u.studentId),
          name: u.realName || u.nickname || normSid(u.studentId),
          status: u.status,
          organizationIds: (u.memberships || []).map((m) => m.organizationId),
        }))
        .sort((a, b) => a.studentId.localeCompare(b.studentId));
      return response({ organizations: flattenOrganizationTree(orgs), people });
    }

    // 3. Create a new collection item (staff only)
    if (path === `${API}/items` && method === 'POST') {
      const session = await identity.authenticate(request, { staff: true, csrf: true });
      const body = await readJson(request, 262144);
      const orgs = await getOrgs();

      const term = text(body.term, '学期', 24, true);
      const termLabel = text(body.termLabel || term, '学期名称', 60, true);
      const code = body.code ? text(body.code, '课程号或代号', 32, false).toUpperCase() : '';
      const name = text(body.name, '名称', 80, true);
      const category = text(body.category, '类别', 32, true);

      const issuerOrgId = typeof body.issuerOrganizationId === 'string' ? body.issuerOrganizationId.trim() : '';
      const issuerOrg = issuerOrgId ? organization(issuerOrgId, orgs) : null;
      if (!issuerOrg) fail(400, 'INVALID_ISSUER_ORGANIZATION', '请选择发布所属组织。');
      if (!canIssueUnder(session.user, issuerOrg.id, orgs)) {
        fail(403, 'FORBIDDEN_ISSUER_ORGANIZATION', '你只能以本人所属组织或其上级组织身份发布收集。');
      }
      const issuerTitle = body.issuerTitle ? text(body.issuerTitle, '发布职务', 40, false) : '';

      const targetMode = body.targetMode === 'open' ? 'open' : 'selected';
      const recipients = targetMode === 'selected' ? parseRecipients(body.recipients) : [];
      if (targetMode === 'selected' && recipients.length === 0) {
        fail(400, 'RECIPIENTS_REQUIRED', '请至少选择一位应交人员，或切换为不限名单的公开收集。');
      }

      const timestamp = new Date(now()).toISOString();
      let rounds;
      if (Array.isArray(body.rounds) && body.rounds.length > 0) {
        if (body.rounds.length > 30) fail(400, 'TOO_MANY_ROUNDS', '单次最多创建 30 个批次。');
        rounds = body.rounds.map((r, idx) => ({
          id: typeof r?.id === 'string' && ID.test(r.id) ? r.id : `rd_${randomUUID().slice(0, 8)}`,
          label: text(r?.label || `第${idx + 1}次`, '批次名称', 40, true),
          deadline: parseDeadline(r?.deadline),
          policy: parsePolicy(r?.policy),
          files: parseFiles(r?.files),
          createdAt: timestamp,
        }));
      } else {
        rounds = [{
          id: `rd_${randomUUID().slice(0, 8)}`,
          label: text(body.roundLabel || '第1次', '批次名称', 40, true),
          deadline: parseDeadline(body.deadline),
          policy: parsePolicy(body.policy),
          files: parseFiles(body.files),
          createdAt: timestamp,
        }];
      }

      const requestedId = typeof body.id === 'string' && ID.test(body.id) && session.user.role === 'owner' ? body.id : '';
      const id = requestedId || `col_${randomUUID().slice(0, 10)}`;
      const item = {
        id,
        term,
        termLabel,
        code,
        name,
        category,
        issuer: {
          userId: session.user.id,
          name: session.user.realName || session.user.nickname || session.user.studentId,
          organizationId: issuerOrg.id,
          title: issuerTitle,
        },
        targetMode,
        recipients,
        rounds,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await repo.put(`collections/items/${id}.json`, item);
      await repo.put(itemIndexKey(id), { version: 1, byRound: Object.fromEntries(rounds.map((r) => [r.id, {}])) });
      await syncCatalogItem(item, Object.fromEntries(rounds.map((r) => [r.id, []])));
      await repo.audit(session.user.id, 'collection.created', id, { name, organizationId: issuerOrg.id, recipientCount: recipients.length });
      return response({ item: { ...item, issuer: issuerView(item.issuer, orgs) } }, 201);
    }

    // 4. Item detail & board (GET public summary / signed-in live board) + DELETE (owner)
    const itemMatch = path.match(/^\/api\/platform\/collections\/items\/([^/]+)$/);
    if (itemMatch && method === 'DELETE') {
      const auth = await identity.authenticate(request, { owner: true, csrf: true });
      const itemId = itemMatch[1];
      if (!ID.test(itemId)) fail(400, 'INVALID_ID', '收集标识无效。');
      await repo.remove(`collections/items/${itemId}.json`);
      await removeCatalogItem(itemId);
      await repo.audit(auth.user.id, 'collection.deleted', itemId);
      return response({ ok: true });
    }
    if (itemMatch && method === 'GET') {
      const itemId = itemMatch[1];
      if (!ID.test(itemId)) fail(400, 'INVALID_ID', '收集标识无效。');
      const [session, item, orgs] = await Promise.all([
        identity.authenticate(request), repo.get(`collections/items/${itemId}.json`), getOrgs(),
      ]);
      if (!item) fail(404, 'NOT_FOUND', '收集项目不存在。');
      const mySid = session ? normSid(session.user.studentId) : '';
      const isStaff = Boolean(session && ['owner', 'admin'].includes(session.user.role));
      const refresh = url.searchParams.get('refresh') === '1' && isStaff;
      const [allUsers, subsByRound] = await Promise.all([
        session ? getAllUsers() : Promise.resolve([]),
        loadItemSubmissions(item, { refresh }),
      ]);
      const userBySid = new Map(allUsers.filter((u) => u?.studentId).map((u) => [normSid(u.studentId), u]));

      const targetMode = item.targetMode === 'open' ? 'open' : 'selected';

      // Build canonical roster of rows for stats & board
      const rosterMap = new Map();
      if (targetMode === 'selected') {
        for (const r of item.recipients || []) {
          const sid = normSid(r.studentId);
          rosterMap.set(sid, { studentId: sid, name: r.name || sid });
        }
      }
      // Include any actual submitter (for open collections or students removed after submitting)
      for (const subs of Object.values(subsByRound)) {
        for (const s of subs) {
          if (!rosterMap.has(s.studentId)) {
            const u = userBySid.get(s.studentId);
            rosterMap.set(s.studentId, { studentId: s.studentId, name: s.studentName || u?.realName || u?.nickname || s.studentId });
          }
        }
      }

      const issuerOrgId = item.issuer?.organizationId || '';
      const roster = [...rosterMap.values()].map((stu) => {
        const u = userBySid.get(stu.studentId);
        return {
          studentId: stu.studentId,
          name: stu.name,
          orgLabel: personOrgLabel(u, issuerOrgId, orgs) || '其他',
        };
      }).sort((a, b) => a.orgLabel.localeCompare(b.orgLabel, 'zh-CN') || a.studentId.localeCompare(b.studentId));

      const inRecipients = Boolean(mySid && (targetMode === 'open' || (item.recipients || []).some((r) => r.studentId === mySid)));

      const groupedByRound = new Map((item.rounds || []).map((rd) => [rd.id, submissionsByStudent(subsByRound[rd.id] || [])]));
      const roundStats = (item.rounds || []).map((rd) => {
        const grouped = groupedByRound.get(rd.id);
        let submitted = 0; let late = 0; let missing = 0;
        for (const stu of roster) {
          const own = grouped.get(stu.studentId) || [];
          if (rd.files.every((f) => own.some((s) => s.fileId === f.id))) {
            if (own.some((s) => computeStatus(s, rd) === 'late')) late++;
            else submitted++;
          } else {
            missing++;
          }
        }
        return { roundId: rd.id, total: roster.length, submitted, late, missing };
      });

      const board = session ? roster.map((stu) => {
        const isMe = stu.studentId === mySid;
        const statuses = {};
        const filesByRound = {};
        for (const rd of item.rounds || []) {
          const own = groupedByRound.get(rd.id).get(stu.studentId) || [];
          if (rd.files.every((f) => own.some((s) => s.fileId === f.id))) {
            statuses[rd.id] = own.some((s) => computeStatus(s, rd) === 'late') ? 'late' : 'submitted';
          } else {
            statuses[rd.id] = 'missing';
          }
          filesByRound[rd.id] = own.map((s) => ({
            fileId: s.fileId,
            storedName: s.storedName,
            sizeBytes: s.sizeBytes,
            submittedAt: s.submittedAt,
            revisions: s.revisions,
            canDownload: isStaff || isMe,
          }));
        }
        return {
          studentId: isStaff || isMe ? stu.studentId : `${stu.studentId.slice(0, 5)}****${stu.studentId.slice(-2)}`,
          rawStudentId: isStaff || isMe ? stu.studentId : undefined,
          name: stu.name,
          orgLabel: stu.orgLabel,
          isMe,
          statuses,
          filesByRound,
        };
      }) : null;

      return response({
        viewer: session ? {
          id: session.user.id,
          studentId: mySid,
          name: session.user.realName || session.user.nickname,
          role: session.user.role,
          isStaff,
          inRecipients,
        } : null,
        item: {
          id: item.id,
          term: item.term,
          termLabel: item.termLabel,
          code: item.code || '',
          name: item.name,
          category: item.category,
          issuer: issuerView(item.issuer, orgs),
          targetMode,
          recipientCount: targetMode === 'open' ? roster.length : (item.recipients || []).length,
          ...(isStaff ? { recipients: item.recipients || [] } : {}),
          rounds: item.rounds || [],
        },
        roundStats,
        board,
      });
    }

    // 5. Update recipients on an existing collection (staff only)
    const recMatch = path.match(/^\/api\/platform\/collections\/items\/([^/]+)\/recipients$/);
    if (recMatch && method === 'POST') {
      const session = await identity.authenticate(request, { staff: true, csrf: true });
      const itemId = recMatch[1];
      const item = await repo.get(`collections/items/${itemId}.json`);
      if (!item) fail(404, 'NOT_FOUND', '收集项目不存在。');
      const body = await readJson(request, 262144);
      const targetMode = body.targetMode === 'open' ? 'open' : 'selected';
      const recipients = targetMode === 'selected' ? parseRecipients(body.recipients) : [];
      if (targetMode === 'selected' && recipients.length === 0) {
        fail(400, 'RECIPIENTS_REQUIRED', '请至少选择一位应交人员，或切换为公开收集。');
      }
      item.targetMode = targetMode;
      item.recipients = recipients;
      item.updatedAt = new Date(now()).toISOString();
      await repo.put(`collections/items/${itemId}.json`, item);
      await syncCatalogItem(item);
      await repo.audit(session.user.id, 'collection.recipients.updated', itemId, { targetMode, recipientCount: recipients.length });
      return response({ targetMode, recipientCount: recipients.length });
    }

    // 6. Add a new round to an item (staff only)
    const addRound = path.match(/^\/api\/platform\/collections\/items\/([^/]+)\/rounds$/);
    if (addRound && method === 'POST') {
      await identity.authenticate(request, { staff: true, csrf: true });
      const itemId = addRound[1];
      const item = await repo.get(`collections/items/${itemId}.json`);
      if (!item) fail(404, 'NOT_FOUND', '收集项目不存在。');
      const body = await readJson(request);
      const rd = {
        id: typeof body.id === 'string' && ID.test(body.id) ? body.id : `rd_${randomUUID().slice(0, 8)}`,
        label: text(body.label || `第${(item.rounds || []).length + 1}次`, '批次名称', 40, true),
        deadline: parseDeadline(body.deadline),
        policy: parsePolicy(body.policy),
        files: parseFiles(body.files),
        createdAt: new Date(now()).toISOString(),
      };
      item.rounds = [...(item.rounds || []), rd];
      item.updatedAt = new Date(now()).toISOString();
      await repo.put(`collections/items/${itemId}.json`, item);
      const idx = await repo.get(itemIndexKey(itemId));
      if (idx?.version === 1 && idx.byRound) {
        idx.byRound[rd.id] = idx.byRound[rd.id] || {};
        await repo.put(itemIndexKey(itemId), idx);
      }
      await syncCatalogItem(item);
      return response({ round: rd }, 201);
    }

    // 7. Update round deadline/policy (staff only)
    const roundUpdate = path.match(/^\/api\/platform\/collections\/items\/([^/]+)\/rounds\/([^/]+)$/);
    if (roundUpdate && method === 'POST') {
      await identity.authenticate(request, { staff: true, csrf: true });
      const [, itemId, roundId] = roundUpdate;
      const item = await repo.get(`collections/items/${itemId}.json`);
      if (!item) fail(404, 'NOT_FOUND', '收集项目不存在。');
      const rd = (item.rounds || []).find((r) => r.id === roundId);
      if (!rd) fail(404, 'NOT_FOUND', '批次不存在。');
      const body = await readJson(request);
      if ('deadline' in body) rd.deadline = parseDeadline(body.deadline);
      if ('policy' in body) rd.policy = parsePolicy(body.policy);
      if ('label' in body && body.label) rd.label = text(body.label, '批次名称', 40, true);
      item.updatedAt = new Date(now()).toISOString();
      await repo.put(`collections/items/${itemId}.json`, item);
      await syncCatalogItem(item);
      return response({ round: rd });
    }

    // 8. Presign upload to OSCA 1TB (signed-in student, or owner recording on behalf of a student)
    const presignMatch = path.match(/^\/api\/platform\/collections\/items\/([^/]+)\/rounds\/([^/]+)\/presign$/);
    if (presignMatch && method === 'POST') {
      const session = await identity.authenticate(request, { required: true, csrf: true });
      const [, itemId, roundId] = presignMatch;
      const item = await repo.get(`collections/items/${itemId}.json`);
      if (!item) fail(404, 'NOT_FOUND', '收集项目不存在。');
      const rd = (item.rounds || []).find((r) => r.id === roundId);
      if (!rd) fail(404, 'NOT_FOUND', '批次不存在。');

      const body = await readJson(request);
      const { sid, name } = uploadTarget(item, rd, session, body, now());

      const fileSlot = (rd.files || []).find((f) => f.id === body.fileId);
      if (!fileSlot) fail(400, 'INVALID_FILE_SLOT', '提交项不存在。');
      const originalName = text(body.fileName, '文件名', 200, true);
      const extMatch = originalName.match(/\.([a-zA-Z0-9]{1,10})$/);
      const ext = extMatch ? extMatch[1].toLowerCase() : '';
      if (!ext || !fileSlot.extensions.includes(ext)) {
        fail(400, 'INVALID_EXTENSION', `格式不支持：仅允许 .${fileSlot.extensions.join(' / .')}`);
      }
      const sizeBytes = Number(body.sizeBytes);
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > fileSlot.maxBytes) {
        fail(400, 'FILE_TOO_LARGE', `文件大小须在 1 B – ${Math.round(fileSlot.maxBytes / 1048576)} MB 之间。`);
      }

      const storedName = `${sid}_${safeFilePart(name)}_${safeFilePart(rd.label)}_${safeFilePart(fileSlot.name)}.${ext}`;
      const config = oscaConfig(env, item.id);
      const objectKey = `${config.objectPrefix}${rd.id}/${fileSlot.id}/${sid}_${Date.now()}_${randomUUID().slice(0, 6)}.${ext}`;
      const gateway = getGateway(config);
      const contentType = typeof body.contentType === 'string' && body.contentType ? body.contentType : 'application/octet-stream';
      const upload = await gateway.presignUpload({ id: fileSlot.id, objectKey, contentType, fileSize: sizeBytes, fileName: storedName }, 300);

      return response({ upload, objectKey, storedName, fileId: fileSlot.id });
    }

    // 9. Confirm upload (atomic replace current submission, preserving history)
    const confirmMatch = path.match(/^\/api\/platform\/collections\/items\/([^/]+)\/rounds\/([^/]+)\/confirm$/);
    if (confirmMatch && method === 'POST') {
      const session = await identity.authenticate(request, { required: true, csrf: true });
      const [, itemId, roundId] = confirmMatch;
      const item = await repo.get(`collections/items/${itemId}.json`);
      if (!item) fail(404, 'NOT_FOUND', '收集项目不存在。');
      const rd = (item.rounds || []).find((r) => r.id === roundId);
      if (!rd) fail(404, 'NOT_FOUND', '批次不存在。');
      const body = await readJson(request);
      const fileSlot = (rd.files || []).find((f) => f.id === body.fileId);
      if (!fileSlot) fail(400, 'INVALID_FILE_SLOT', '提交项不存在。');

      const config = oscaConfig(env, item.id);
      const objectKey = String(body.objectKey || '');
      const { onBehalf, sid, name } = uploadTarget(item, rd, session, body, now());
      const prefix = `${config.objectPrefix}${rd.id}/${fileSlot.id}/${sid}_`;
      const ext = /^\d+_[a-f0-9]{6}\.([a-z0-9]{1,10})$/.exec(objectKey.slice(prefix.length))?.[1];
      if (!objectKey.startsWith(prefix) || !fileSlot.extensions.includes(ext)) fail(400, 'INVALID_OBJECT', '上传凭证无效。');
      const storedName = `${sid}_${safeFilePart(name)}_${safeFilePart(rd.label)}_${safeFilePart(fileSlot.name)}.${ext}`;
      const originalName = text(body.originalName || storedName, '原文件名', 200, true);
      const gateway = getGateway(config);
      const subKey = `collections/submissions/${item.id}/${rd.id}/${fileSlot.id}/${sid}.json`;
      const [head, prev] = await Promise.all([gateway.head(objectKey), repo.get(subKey)]);
      if (!head) fail(400, 'UPLOAD_INCOMPLETE', '文件尚未完成上传，请重试。');
      if (!Number.isSafeInteger(head.size) || head.size < 1 || head.size > fileSlot.maxBytes || !/^"[^"\r\n]+"$/.test(head.etag || '')) {
        fail(409, 'UPLOAD_MISMATCH', '附件大小或存储校验信息无效。');
      }
      if (prev?.objectKey === objectKey && prev.etag === head.etag) return response({ submission: prev });

      const submittedAt = onBehalf && body.submittedAt ? parseDeadline(body.submittedAt) : new Date(now()).toISOString();
      const revisions = onBehalf && Number.isSafeInteger(body.revisions) && body.revisions >= 1
        ? body.revisions
        : (prev ? (prev.revisions || 1) + 1 : 1);

      const next = {
        itemId: item.id,
        roundId: rd.id,
        fileId: fileSlot.id,
        studentId: sid,
        studentName: name,
        originalName,
        storedName,
        objectKey,
        etag: head.etag || '',
        sizeBytes: head.size,
        submittedAt,
        revisions,
        history: prev ? [...(prev.history || []).slice(-9), { objectKey: prev.objectKey, storedName: prev.storedName, sizeBytes: prev.sizeBytes, submittedAt: prev.submittedAt }] : [],
      };
      await repo.put(subKey, next);
      const idx = await repo.get(itemIndexKey(item.id));
      if (idx?.version === 1 && idx.byRound) {
        idx.byRound[rd.id] = idx.byRound[rd.id] || {};
        idx.byRound[rd.id][`${fileSlot.id}::${sid}`] = compactSub(next);
        await repo.put(itemIndexKey(item.id), idx);
        const subsByRound = {};
        for (const r of item.rounds || []) subsByRound[r.id] = Object.values(idx.byRound[r.id] || {});
        await syncCatalogItem(item, subsByRound);
      } else {
        await syncCatalogItem(item);
      }
      return response({ submission: next });
    }

    // 10. Single file download (owner/admin or submitter themselves)
    const dlMatch = path.match(/^\/api\/platform\/collections\/items\/([^/]+)\/rounds\/([^/]+)\/download$/);
    if (dlMatch && method === 'GET') {
      const session = await identity.authenticate(request, { required: true });
      const [, itemId, roundId] = dlMatch;
      const fileId = url.searchParams.get('fileId') || '';
      const targetSid = normSid(url.searchParams.get('studentId') || session.user.studentId);
      const isStaff = ['owner', 'admin'].includes(session.user.role);
      if (!isStaff && targetSid !== normSid(session.user.studentId)) fail(403, 'FORBIDDEN', '仅可下载本人提交的文件。');
      const sub = await repo.get(`collections/submissions/${itemId}/${roundId}/${fileId}/${targetSid}.json`);
      if (!sub) fail(404, 'NOT_FOUND', '未找到该提交文件。');
      const gateway = getGateway(oscaConfig(env, itemId));
      const download = await gateway.presignDownload({ fileName: sub.storedName, finalObjectKey: sub.objectKey }, sub.etag, 120);
      return response({ download, storedName: sub.storedName });
    }

    // 11. Batch presigned file list for client-side ZIP packaging (staff only)
    const filesMatch = path.match(/^\/api\/platform\/collections\/items\/([^/]+)\/rounds\/([^/]+)\/files$/);
    if (filesMatch && method === 'GET') {
      await identity.authenticate(request, { staff: true });
      const [, itemId, roundId] = filesMatch;
      const item = await repo.get(`collections/items/${itemId}.json`);
      if (!item) fail(404, 'NOT_FOUND', '收集项目不存在。');
      const rd = (item.rounds || []).find((r) => r.id === roundId);
      if (!rd) fail(404, 'NOT_FOUND', '批次不存在。');
      const [orgs, allUsers, subsByRound] = await Promise.all([getOrgs(), getAllUsers(), loadItemSubmissions(item)]);
      const subs = subsByRound[rd.id] || [];
      const userBySid = new Map(allUsers.filter((u) => u?.studentId).map((u) => [normSid(u.studentId), u]));
      const gateway = getGateway(oscaConfig(env, item.id));
      const files = await Promise.all(subs.map(async (sub) => {
        const u = userBySid.get(sub.studentId);
        const orgLabel = personOrgLabel(u, item.issuer?.organizationId || '', orgs) || '其他';
        const slot = (rd.files || []).find((f) => f.id === sub.fileId);
        const dl = await gateway.presignDownload({ fileName: sub.storedName, finalObjectKey: sub.objectKey }, sub.etag, 300);
        return {
          path: `${safeFilePart(orgLabel)}/${safeFilePart(slot?.name || sub.fileId)}/${sub.storedName.replace(/[\\/\x00-\x1f]/g, '_').replace(/^\.+$/, '_')}`,
          storedName: sub.storedName,
          sizeBytes: sub.sizeBytes,
          url: dl.url,
          headers: dl.headers,
        };
      }));
      return response({ zipName: `${safeFilePart(item.name)}_${safeFilePart(rd.label)}.zip`, files });
    }

    // 12. Export CSV statistics (staff only)
    const csvMatch = path.match(/^\/api\/platform\/collections\/items\/([^/]+)\/rounds\/([^/]+)\/csv$/);
    if (csvMatch && method === 'GET') {
      await identity.authenticate(request, { staff: true });
      const [, itemId, roundId] = csvMatch;
      const item = await repo.get(`collections/items/${itemId}.json`);
      if (!item) fail(404, 'NOT_FOUND', '收集项目不存在。');
      const rd = (item.rounds || []).find((r) => r.id === roundId);
      if (!rd) fail(404, 'NOT_FOUND', '批次不存在。');
      const [orgs, allUsers, subsByRound] = await Promise.all([getOrgs(), getAllUsers(), loadItemSubmissions(item)]);
      const subs = subsByRound[rd.id] || [];
      const userBySid = new Map(allUsers.filter((u) => u?.studentId).map((u) => [normSid(u.studentId), u]));
      const rosterMap = new Map();
      if (item.targetMode !== 'open') {
        for (const r of item.recipients || []) rosterMap.set(r.studentId, r);
      }
      for (const s of subs) {
        if (!rosterMap.has(s.studentId)) {
          const u = userBySid.get(s.studentId);
          rosterMap.set(s.studentId, { studentId: s.studentId, name: s.studentName || u?.realName || s.studentId });
        }
      }
      const subMap = new Map(subs.map((s) => [`${s.fileId}::${s.studentId}`, s]));
      const rows = [['学号', '姓名', '所属组织', '提交项', '状态', '规范文件名', '文件大小(B)', '提交时间', '版本']];
      const cn = { submitted: '已提交', late: '迟交', missing: '未提交' };
      const sortedRoster = [...rosterMap.values()].sort((a, b) => a.studentId.localeCompare(b.studentId));
      for (const stu of sortedRoster) {
        const orgLabel = personOrgLabel(userBySid.get(stu.studentId), item.issuer?.organizationId || '', orgs) || '其他';
        for (const f of rd.files || []) {
          const sub = subMap.get(`${f.id}::${stu.studentId}`);
          const st = computeStatus(sub, rd);
          rows.push([stu.studentId, stu.name, orgLabel, f.name, cn[st], sub?.storedName || '', sub?.sizeBytes ?? '', sub?.submittedAt || '', sub?.revisions ?? 0]);
        }
      }
      return new Response(`\uFEFF${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${safeFilePart(item.name)}_${safeFilePart(rd.label)}.csv`)}`,
          'Cache-Control': 'no-store, private',
        },
      });
    }

    return null;
  }

  return { handle };
}
