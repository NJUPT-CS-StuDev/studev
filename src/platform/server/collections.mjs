import { randomUUID } from 'node:crypto';
import { fail, readJson, response, text } from './common.mjs';

const API = '/api/platform/collections';
const ID = /^[a-zA-Z0-9_-]{4,80}$/;
const MAX_FILE = 20 * 1024 * 1024;
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
    const maxBytes = Number.isSafeInteger(f?.maxBytes) && f.maxBytes > 0 && f.maxBytes <= MAX_FILE ? f.maxBytes : MAX_FILE;
    return { id, name, extensions, maxBytes };
  });
}

function parsePolicy(value) {
  const p = value || 'strict';
  if (!['strict', 'allow-late', 'closed'].includes(p)) fail(400, 'INVALID_POLICY', '提交状态无效。');
  return p;
}

function computeStatus(sub, round) {
  if (!sub) return 'missing';
  if (round.deadline && sub.submittedAt && Date.parse(sub.submittedAt) > Date.parse(round.deadline)) return 'late';
  return 'submitted';
}

function safeFilePart(value) {
  return String(value || '').replace(/[\\/:*?"<>|\r\n\t]+/g, '').replace(/\s+/g, '').slice(0, 60) || 'item';
}

export function createCollectionsService({ repo, identity, env, now = Date.now, getGateway }) {
  async function listGroups() {
    const keys = await repo.list('collections/groups/');
    const items = await Promise.all(keys.map((k) => repo.get(k)));
    return items.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }

  async function listItems() {
    const keys = await repo.list('collections/items/');
    const items = await Promise.all(keys.map((k) => repo.get(k)));
    return items.filter(Boolean).sort((a, b) => (b.term || '').localeCompare(a.term || '') || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  async function resolveRoster(groupIds) {
    const allGroups = await listGroups();
    const byId = new Map(allGroups.map((g) => [g.id, g]));
    const rosterMap = new Map();
    const groupNames = [];
    for (const gid of groupIds || []) {
      const g = byId.get(gid);
      if (!g) continue;
      groupNames.push(g.name);
      for (const m of g.members || []) {
        const sid = normSid(m.studentId);
        if (!sid) continue;
        rosterMap.set(sid, { studentId: sid, name: m.name || sid, groupName: g.name });
      }
    }
    return {
      groupNames,
      roster: [...rosterMap.values()].sort((a, b) => a.groupName.localeCompare(b.groupName, 'zh-CN') || a.studentId.localeCompare(b.studentId)),
    };
  }

  async function listRoundSubmissions(itemId, roundId) {
    const keys = await repo.list(`collections/submissions/${itemId}/${roundId}/`);
    const rows = await Promise.all(keys.map((k) => repo.get(k)));
    return rows.filter(Boolean);
  }

  async function handle(context, path) {
    if (path !== API && !path.startsWith(`${API}/`)) return null;
    const request = context.request;
    const method = request.method;
    const url = new URL(request.url);

    // 1. Public list of all collections (no student PII exposed when unauthenticated)
    if (path === API && method === 'GET') {
      const session = await identity.authenticate(request);
      const mySid = session ? normSid(session.user.studentId) : '';
      const isStaff = Boolean(session && ['owner', 'admin'].includes(session.user.role));
      const [items, groups] = await Promise.all([listItems(), listGroups()]);
      const groupById = new Map(groups.map((g) => [g.id, g]));

      const viewItems = await Promise.all(items.map(async (item) => {
        const groupNames = [];
        let rosterCount = 0;
        let inMine = false;
        const seen = new Set();
        for (const gid of item.groupIds || []) {
          const g = groupById.get(gid);
          if (!g) continue;
          groupNames.push(g.name);
          for (const m of g.members || []) {
            const sid = normSid(m.studentId);
            if (!sid || seen.has(sid)) continue;
            seen.add(sid);
            rosterCount++;
            if (mySid && sid === mySid) inMine = true;
          }
        }
        const roundsSummary = await Promise.all((item.rounds || []).map(async (rd) => {
          const subs = await listRoundSubmissions(item.id, rd.id);
          const doneSids = new Set();
          const byStu = new Map();
          for (const s of subs) {
            const set = byStu.get(s.studentId) || new Set();
            set.add(s.fileId);
            byStu.set(s.studentId, set);
          }
          for (const [sid, set] of byStu.entries()) {
            if (rd.files.every((f) => set.has(f.id))) doneSids.add(sid);
          }
          let myStatus = null;
          if (mySid && inMine) {
            const mySubs = subs.filter((s) => s.studentId === mySid);
            if (rd.files.every((f) => mySubs.some((s) => s.fileId === f.id))) {
              myStatus = mySubs.some((s) => computeStatus(s, rd) === 'late') ? 'late' : 'submitted';
            } else {
              myStatus = 'missing';
            }
          }
          return {
            id: rd.id,
            label: rd.label,
            deadline: rd.deadline,
            policy: rd.policy,
            fileCount: rd.files.length,
            submittedCount: doneSids.size,
            totalCount: rosterCount,
            myStatus,
          };
        }));
        return {
          id: item.id,
          kind: item.kind,
          term: item.term,
          termLabel: item.termLabel,
          code: item.code,
          name: item.name,
          category: item.category,
          groupIds: item.groupIds || [],
          groupNames,
          rosterCount,
          inMine,
          rounds: roundsSummary,
          updatedAt: item.updatedAt,
        };
      }));

      return response({
        viewer: session ? { studentId: mySid, name: session.user.realName || session.user.nickname, role: session.user.role, isStaff } : null,
        items: viewItems,
        ...(isStaff ? { groups: groups.map((g) => ({ id: g.id, name: g.name, count: (g.members || []).length })) } : {}),
      });
    }

    // 2. Roster groups management (staff only)
    if (path === `${API}/groups`) {
      const session = await identity.authenticate(request, { staff: true, csrf: method === 'POST' });
      if (method === 'GET') return response({ groups: await listGroups() });
      if (method === 'POST') {
        const body = await readJson(request);
        const name = text(body.name, '名单名称', 60, true);
        const rawLines = String(body.lines || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        if (!rawLines.length || rawLines.length > 500) fail(400, 'INVALID_MEMBERS', '请填写 1–500 行名单（每行：学号 姓名）。');
        const map = new Map();
        for (const line of rawLines) {
          const parts = line.split(/[\s,\t]+/).filter(Boolean);
          const sid = normSid(parts[0]);
          if (!/^[A-Z0-9]{4,24}$/.test(sid)) fail(400, 'INVALID_STUDENT_ID', `学号格式无效：${parts[0]}`);
          map.set(sid, { studentId: sid, name: text(parts.slice(1).join(' ') || sid, '姓名', 40, true) });
        }
        const id = typeof body.id === 'string' && ID.test(body.id) ? body.id : `grp_${randomUUID().slice(0, 8)}`;
        const group = {
          id,
          name,
          members: [...map.values()].sort((a, b) => a.studentId.localeCompare(b.studentId)),
          updatedAt: new Date(now()).toISOString(),
          updatedBy: session.user.id,
        };
        await repo.put(`collections/groups/${id}.json`, group);
        return response({ group }, 201);
      }
    }

    const groupDel = path.match(/^\/api\/platform\/collections\/groups\/([^/]+)$/);
    if (groupDel && method === 'DELETE') {
      await identity.authenticate(request, { staff: true, csrf: true });
      const gid = groupDel[1];
      if (!ID.test(gid)) fail(400, 'INVALID_ID', '名单标识无效。');
      await repo.remove(`collections/groups/${gid}.json`);
      return response({ ok: true });
    }

    // 3. Create a new collection item (staff only)
    if (path === `${API}/items` && method === 'POST') {
      const session = await identity.authenticate(request, { staff: true, csrf: true });
      const body = await readJson(request);
      const kind = body.kind === 'org' ? 'org' : 'course';
      const term = text(body.term, '学期', 24, true);
      const termLabel = text(body.termLabel || term, '学期名称', 60, true);
      const code = text(body.code, '课程号或组织代号', 32, true).toUpperCase();
      const name = text(body.name, '名称', 80, true);
      const category = text(body.category, '类别', 32, true);
      const groupIds = Array.isArray(body.groupIds) ? [...new Set(body.groupIds.filter((g) => typeof g === 'string' && ID.test(g)))] : [];
      const firstRound = {
        id: `rd_${randomUUID().slice(0, 8)}`,
        label: text(body.roundLabel || '第1次', '批次名称', 40, true),
        deadline: parseDeadline(body.deadline),
        policy: parsePolicy(body.policy),
        files: parseFiles(body.files),
        createdAt: new Date(now()).toISOString(),
      };
      const id = `col_${randomUUID().slice(0, 10)}`;
      const timestamp = new Date(now()).toISOString();
      const item = { id, kind, term, termLabel, code, name, category, groupIds, rounds: [firstRound], createdAt: timestamp, updatedAt: timestamp, createdBy: session.user.id };
      await repo.put(`collections/items/${id}.json`, item);
      return response({ item }, 201);
    }

    // 4. Item detail & board (GET public summary / signed-in live board)
    const itemMatch = path.match(/^\/api\/platform\/collections\/items\/([^/]+)$/);
    if (itemMatch && method === 'GET') {
      const itemId = itemMatch[1];
      if (!ID.test(itemId)) fail(400, 'INVALID_ID', '收集标识无效。');
      const item = await repo.get(`collections/items/${itemId}.json`);
      if (!item) fail(404, 'NOT_FOUND', '收集项目不存在。');
      const session = await identity.authenticate(request);
      const mySid = session ? normSid(session.user.studentId) : '';
      const isStaff = Boolean(session && ['owner', 'admin'].includes(session.user.role));
      const { groupNames, roster } = await resolveRoster(item.groupIds);
      const inRoster = Boolean(mySid && roster.some((r) => r.studentId === mySid));

      const subsByRound = {};
      for (const rd of item.rounds || []) {
        subsByRound[rd.id] = await listRoundSubmissions(item.id, rd.id);
      }

      const roundStats = (item.rounds || []).map((rd) => {
        const subs = subsByRound[rd.id] || [];
        let submitted = 0; let late = 0; let missing = 0;
        for (const stu of roster) {
          const own = subs.filter((s) => s.studentId === stu.studentId);
          if (rd.files.every((f) => own.some((s) => s.fileId === f.id))) {
            if (own.some((s) => computeStatus(s, rd) === 'late')) late++;
            else submitted++;
          } else {
            missing++;
          }
        }
        return { roundId: rd.id, total: roster.length, submitted, late, missing };
      });

      // Only signed-in users see the per-student board; unauthenticated visitors see aggregate stats only
      const board = session ? roster.map((stu) => {
        const isMe = stu.studentId === mySid;
        const statuses = {};
        const filesByRound = {};
        for (const rd of item.rounds || []) {
          const own = (subsByRound[rd.id] || []).filter((s) => s.studentId === stu.studentId);
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
          groupName: stu.groupName,
          isMe,
          statuses,
          filesByRound,
        };
      }) : null;

      return response({
        viewer: session ? { studentId: mySid, name: session.user.realName || session.user.nickname, role: session.user.role, isStaff, inRoster } : null,
        item: { ...item, groupNames, rosterCount: roster.length },
        roundStats,
        board,
      });
    }

    // 5. Add a new round to an item (staff only)
    const addRound = path.match(/^\/api\/platform\/collections\/items\/([^/]+)\/rounds$/);
    if (addRound && method === 'POST') {
      await identity.authenticate(request, { staff: true, csrf: true });
      const itemId = addRound[1];
      const item = await repo.get(`collections/items/${itemId}.json`);
      if (!item) fail(404, 'NOT_FOUND', '收集项目不存在。');
      const body = await readJson(request);
      const rd = {
        id: `rd_${randomUUID().slice(0, 8)}`,
        label: text(body.label || `第${(item.rounds || []).length + 1}次`, '批次名称', 40, true),
        deadline: parseDeadline(body.deadline),
        policy: parsePolicy(body.policy),
        files: parseFiles(body.files),
        createdAt: new Date(now()).toISOString(),
      };
      item.rounds = [...(item.rounds || []), rd];
      item.updatedAt = new Date(now()).toISOString();
      await repo.put(`collections/items/${itemId}.json`, item);
      return response({ round: rd }, 201);
    }

    // 6. Update round deadline/policy (staff only)
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
      return response({ round: rd });
    }

    // 7. Presign upload to OSCA 1TB (signed-in student)
    const presignMatch = path.match(/^\/api\/platform\/collections\/items\/([^/]+)\/rounds\/([^/]+)\/presign$/);
    if (presignMatch && method === 'POST') {
      const session = await identity.authenticate(request, { required: true, csrf: true });
      const [, itemId, roundId] = presignMatch;
      const item = await repo.get(`collections/items/${itemId}.json`);
      if (!item) fail(404, 'NOT_FOUND', '收集项目不存在。');
      const rd = (item.rounds || []).find((r) => r.id === roundId);
      if (!rd) fail(404, 'NOT_FOUND', '批次不存在。');
      if (rd.policy === 'closed') fail(400, 'ROUND_CLOSED', '当前批次已关闭提交。');
      if (rd.policy === 'strict' && rd.deadline && now() > Date.parse(rd.deadline)) {
        fail(400, 'DEADLINE_PASSED', '已超过截止时间，无法提交。');
      }

      const body = await readJson(request);
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

      const sid = normSid(session.user.studentId);
      const { roster } = await resolveRoster(item.groupIds);
      const entry = roster.find((r) => r.studentId === sid);
      const realName = entry?.name || session.user.realName || session.user.nickname || sid;
      const storedName = `${sid}_${safeFilePart(realName)}_${safeFilePart(rd.label)}_${safeFilePart(fileSlot.name)}.${ext}`;
      const config = oscaConfig(env, item.id);
      const objectKey = `${config.objectPrefix}${rd.id}/${fileSlot.id}/${sid}_${Date.now()}.${ext}`;
      const gateway = getGateway(config);
      const contentType = typeof body.contentType === 'string' && body.contentType ? body.contentType : 'application/octet-stream';
      const upload = await gateway.presignUpload({ id: fileSlot.id, objectKey, contentType, fileSize: sizeBytes, fileName: storedName }, 300);

      return response({ upload, objectKey, storedName, fileId: fileSlot.id });
    }

    // 8. Confirm upload (atomic replace current submission, preserving history)
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
      if (!objectKey.startsWith(config.objectPrefix)) fail(400, 'INVALID_OBJECT', '上传凭证无效。');
      const gateway = getGateway(config);
      const head = await gateway.head(objectKey);
      if (!head) fail(400, 'UPLOAD_INCOMPLETE', '文件尚未完成上传，请重试。');

      const sid = normSid(session.user.studentId);
      const subKey = `collections/submissions/${item.id}/${rd.id}/${fileSlot.id}/${sid}.json`;
      const prev = await repo.get(subKey);
      const submittedAt = new Date(now()).toISOString();
      const next = {
        itemId: item.id,
        roundId: rd.id,
        fileId: fileSlot.id,
        studentId: sid,
        originalName: text(body.originalName || body.storedName, '原文件名', 200, true),
        storedName: text(body.storedName, '规范文件名', 200, true),
        objectKey,
        etag: head.etag || '',
        sizeBytes: Number(head.contentLength || body.sizeBytes || 0),
        submittedAt,
        revisions: prev ? (prev.revisions || 1) + 1 : 1,
        history: prev ? [...(prev.history || []).slice(-9), { objectKey: prev.objectKey, storedName: prev.storedName, sizeBytes: prev.sizeBytes, submittedAt: prev.submittedAt }] : [],
      };
      await repo.put(subKey, next);
      return response({ submission: next });
    }

    // 9. Single file download (owner/admin or submitter themselves)
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

    // 10. Batch presigned file list for client-side ZIP packaging (staff only)
    const filesMatch = path.match(/^\/api\/platform\/collections\/items\/([^/]+)\/rounds\/([^/]+)\/files$/);
    if (filesMatch && method === 'GET') {
      await identity.authenticate(request, { staff: true });
      const [, itemId, roundId] = filesMatch;
      const item = await repo.get(`collections/items/${itemId}.json`);
      if (!item) fail(404, 'NOT_FOUND', '收集项目不存在。');
      const rd = (item.rounds || []).find((r) => r.id === roundId);
      if (!rd) fail(404, 'NOT_FOUND', '批次不存在。');
      const { roster } = await resolveRoster(item.groupIds);
      const rosterBySid = new Map(roster.map((r) => [r.studentId, r]));
      const subs = await listRoundSubmissions(item.id, rd.id);
      const gateway = getGateway(oscaConfig(env, item.id));
      const files = await Promise.all(subs.map(async (sub) => {
        const stu = rosterBySid.get(sub.studentId);
        const slot = (rd.files || []).find((f) => f.id === sub.fileId);
        const dl = await gateway.presignDownload({ fileName: sub.storedName, finalObjectKey: sub.objectKey }, sub.etag, 300);
        return {
          path: `${stu?.groupName || '其他'}/${slot?.name || sub.fileId}/${sub.storedName}`,
          storedName: sub.storedName,
          sizeBytes: sub.sizeBytes,
          url: dl.url,
        };
      }));
      return response({ zipName: `${safeFilePart(item.name)}_${safeFilePart(rd.label)}.zip`, files });
    }

    // 11. Export CSV statistics (staff only)
    const csvMatch = path.match(/^\/api\/platform\/collections\/items\/([^/]+)\/rounds\/([^/]+)\/csv$/);
    if (csvMatch && method === 'GET') {
      await identity.authenticate(request, { staff: true });
      const [, itemId, roundId] = csvMatch;
      const item = await repo.get(`collections/items/${itemId}.json`);
      if (!item) fail(404, 'NOT_FOUND', '收集项目不存在。');
      const rd = (item.rounds || []).find((r) => r.id === roundId);
      if (!rd) fail(404, 'NOT_FOUND', '批次不存在。');
      const { roster } = await resolveRoster(item.groupIds);
      const subs = await listRoundSubmissions(item.id, rd.id);
      const subMap = new Map(subs.map((s) => [`${s.fileId}::${s.studentId}`, s]));
      const rows = [['学号', '姓名', '分组', '提交项', '状态', '规范文件名', '文件大小(B)', '提交时间', '版本']];
      const cn = { submitted: '已提交', late: '迟交', missing: '未提交' };
      for (const stu of roster) {
        for (const f of rd.files || []) {
          const sub = subMap.get(`${f.id}::${stu.studentId}`);
          const st = computeStatus(sub, rd);
          rows.push([stu.studentId, stu.name, stu.groupName, f.name, cn[st], sub?.storedName || '', sub?.sizeBytes ?? '', sub?.submittedAt || '', sub?.revisions ?? 0]);
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
