import { randomUUID } from 'node:crypto';
import { fail, readJson, response } from '../common.mjs';
import { chinaDay, flattenOrganizationTree, isWithin } from '../../organizations.mjs';
import { pinnedCollections } from '../../collections.mjs';
import { boardFor, definitions, directoryPeople, itemView, myRecords, ownHistory, readItem, readRound, roundRecords } from './catalog.mjs';
import { canManage, canSee, isManagement, itemInput, publishedIssuer, roundInput, viewerInfo } from './definition.mjs';
import { collectionCsv, fileManifest } from './exports.mjs';
import { collectionKeys as keys, mapConcurrent, readSubmission } from './records.mjs';
import { roundQuota } from './quota.mjs';
import { canEditSubmission, collectionSubmissions, ownsSubmission, submissionView } from './submissions.mjs';

const API = '/api/platform/collections';
const itemPath = /^\/api\/platform\/collections\/items\/([a-zA-Z0-9_-]+)(?:\/(duplicate|unpublish|rounds)(?:\/([a-zA-Z0-9_-]+)(?:\/(submissions|csv|files))?)?)?$/;
const submissionPath = /^\/api\/platform\/collections\/submissions\/([a-z0-9-]+)(?:\/(complete|cancel|edit|review)|\/files\/([^/]+)\/(download))?$/;

export function createCollectionsService({ repo, identity, env, now = Date.now, getGateway }) {
  const timestamp = () => new Date(now()).toISOString();
  const submissions = collectionSubmissions({ repo, env, now, getGateway });

  async function catalog(viewer, orgs, url, available) {
    const orgFilter = url.searchParams.get('orgId');
    const items = available.filter((item) => canSee(item, viewer, orgs) &&
      (!orgFilter || isWithin(item.issuer.organizationId, orgFilter, orgs)));
    const ids = new Set(items.map((item) => item.id));
    const records = new Map();
    for (const record of await myRecords(repo, viewer.user, ids)) {
      if (!records.has(record.itemId)) records.set(record.itemId, []);
      records.get(record.itemId).push(record);
    }
    const serverTime = now();
    return response({ ...viewerInfo(viewer, orgs), serverTime, organizations: flattenOrganizationTree(orgs),
      items: items.map((item) => itemView(item, viewer, orgs, records.get(item.id) || [], serverTime)),
    });
  }

  async function detail(item, viewer, orgs, knownRecords) {
    const mine = knownRecords ?? await myRecords(repo, viewer.user, new Set([item.id]));
    const serverTime = now();
    return response({
      ...viewerInfo(viewer, orgs),
      serverTime,
      item: itemView(item, viewer, orgs, mine, serverTime, true),
      mySubmissions: ownHistory(new Map([[item.id, item]]), mine),
    });
  }

  async function createItem(input, viewer, orgs) {
    const heads = await repo.heads(keys.definitions);
    if (heads.size >= 1000 && (await definitions(repo, heads)).length >= 1000) {
      fail(409, 'COLLECTION_LIMIT_REACHED', '收集数量已达平台上限。');
    }
    const id = randomUUID();
    const result = await repo.append(keys.definition(id), { ...input, id }, 0);
    await repo.audit(viewer.user, 'collection.create', id, { status: result.status });
    return response({ item: itemView(result, viewer, orgs, [], now(), true) }, 201);
  }

  async function deleteDraft(item, revision, actor) {
    if (item.status !== 'draft') fail(409, 'DRAFT_REQUIRED', '请先取消发布，再删除草稿。');
    const [records, quotas] = await Promise.all([
      repo.heads(`${keys.submissions}/${item.id}`),
      repo.heads(keys.itemQuotas(item.id)),
    ]);
    if (records.size) fail(409, 'DRAFT_HAS_SUBMISSIONS', '已有提交的草稿不能删除。');
    const counts = await mapConcurrent([...quotas.keys()], 16, (roundId) => roundQuota(repo, item.id, roundId, now).status());
    if (counts.some((count) => count.active || count.completed)) {
      fail(409, 'DRAFT_HAS_AUTHORIZATIONS', '先前授权的上传可能仍在确认，请稍后重试。');
    }
    const prefix = keys.definition(item.id);
    const revisions = (await repo.list(prefix + '/')).filter((key) => /\/\d{8}\.json$/.test(key));
    const result = await repo.append(prefix, { deleted: true }, revision);
    // Retain occupied revision keys so a delayed conditional write cannot
    // restore discarded metadata at an older revision.
    const scrubbed = await mapConcurrent(revisions, 16, async (key) => {
      const marker = { deleted: true, revision: Number(key.slice(-13, -5)) };
      return repo.put(key, marker).catch(() => repo.put(key, marker)).then(() => true, () => false);
    });
    if (scrubbed.includes(false)) console.error('Collection deletion could not scrub all previous revisions', item.id);
    await repo.audit(actor, 'collection.delete', item.id, { revision: result.revision });
    return response({ deleted: true });
  }

  async function routeItem(context, viewer, orgs, route, receivedAt) {
    const { request } = context;
    const [ , id, operation, roundId, action ] = route;
    if (roundId && operation !== 'rounds') fail(404, 'NOT_FOUND', '接口不存在。');
    const item = await readItem(repo, id);
    const directDetail = !operation && request.method === 'GET';
    if (!canSee(item, viewer, orgs)) {
      if (directDetail && (item.status === 'draft' || item.status === 'closed') && viewer.user) {
        const mine = await myRecords(repo, viewer.user, new Set([item.id]));
        if (mine.length) return detail(item, viewer, orgs, mine);
      }
      fail(404, 'NOT_FOUND', '收集不存在或无权查看。');
    }
    const manage = canManage(item, viewer, orgs);
    if (directDetail) return detail(item, viewer, orgs);
    const round = roundId ? readRound(item, roundId) : null;
    if (action === 'submissions' && request.method === 'POST') {
      return response(await submissions.begin(context, item, round, viewer.user, receivedAt), 201);
    }
    if (!manage) fail(403, 'STAFF_REQUIRED', '此账号无权管理这项收集。');
    if (!operation && request.method === 'DELETE') {
      const body = await readJson(request);
      return deleteDraft(item, body.revision, viewer.user);
    }
    if (action && request.method === 'GET') {
      const [records, quota] = await Promise.all([
        roundRecords(repo, id, roundId),
        action === 'submissions' ? roundQuota(repo, id, roundId, now).status() : null,
      ]);
      if (action === 'submissions') {
        await submissions.cleanup(context, id, roundId);
        return response({ items: records.map((record) => submissionView(record, item, round)),
          ...boardFor(item, records, [round]),
          usage: { authorizations: quota.active + records.length, pending: quota.active,
            completed: records.length, fileBytes: records.reduce((total, record) =>
            total + record.files.reduce((bytes, file) => bytes + file.size, 0), 0) },
        });
      }
      await repo.audit(viewer.user, 'collection.export', id, { roundId, kind: action, count: records.length });
      if (action === 'csv') return collectionCsv(item, round, records);
      return response({ files: await fileManifest(records, submissions.download) });
    }
    if (request.method !== 'POST' || action) fail(405, 'METHOD_NOT_ALLOWED', '不支持此操作。');
    const body = await readJson(request, 256 * 1024);
    const time = timestamp();
    if (operation === 'unpublish') {
      if (pinnedCollections.includes(id)) fail(400, 'PINNED_COLLECTION_PUBLIC', '常用收集入口应保持公开。');
      if (item.status === 'draft') fail(409, 'ALREADY_DRAFT', '此收集已是草稿。');
      const result = await repo.append(keys.definition(id), { ...item, status: 'draft', updatedAt: time }, body.revision);
      await repo.audit(viewer.user, 'collection.unpublish', id, { revision: result.revision, previousStatus: item.status });
      return response({ item: itemView(result, viewer, orgs, [], now(), true) });
    }
    if (operation === 'duplicate') {
      const issuer = publishedIssuer({
        issuerOrganizationId: body.issuerOrganizationId ?? item.issuer.organizationId,
        issuerTitle: body.issuerTitle ?? item.issuer.title,
      }, viewer, orgs);
      return createItem({
        ...item, name: item.name.slice(0, 114) + ' · 副本', issuer, status: 'draft', publishedAt: '',
        createdAt: time, updatedAt: time, rounds: item.rounds.map((row) => ({ ...row, deadline: '', policy: 'strict' })),
      }, viewer, orgs);
    }
    const update = { ...item, updatedAt: time };
    if (operation === 'rounds') {
      const next = roundInput({ ...round, ...body }, { now: Date.parse(time), existing: round });
      if (!round && item.rounds.length >= 100) fail(409, 'ROUND_LIMIT_REACHED', '每项收集最多设置 100 轮。');
      if (round && next.submissionMode !== round.submissionMode) {
        const { active, completed } = await roundQuota(repo, id, roundId, now).status();
        if (active || completed) fail(409, 'SUBMISSION_MODE_IN_USE', '已存在提交或暂存内容，无法切换提交方式。');
      }
      update.rounds = round ? item.rounds.map((row) => row.id === round.id ? next : row) : [...item.rounds, next];
    } else {
      if (body.rounds !== undefined) fail(400, 'UPDATE_ROUND_REQUIRED', '请通过轮次操作修改已有轮次。');
      Object.assign(update, itemInput(body, time, item));
      if (body.issuerOrganizationId !== undefined &&
          (body.issuerOrganizationId !== item.issuer.organizationId || (body.issuerTitle ?? '') !== item.issuer.title)) {
        update.issuer = publishedIssuer(body, viewer, orgs);
      }
    }
    const result = await repo.append(keys.definition(id), update, body.revision);
    await repo.audit(viewer.user, 'collection.update', id, { roundId, status: result.status, revision: result.revision });
    return response({ item: itemView(result, viewer, orgs, [], now(), true) }, !round && operation === 'rounds' ? 201 : 200);
  }

  async function routeSubmission(request, viewer, orgs, route, receivedAt) {
    const [ , id, action, fileId, download ] = route;
    const record = await readSubmission(repo, id);
    const item = await readItem(repo, record.itemId);
    const round = readRound(item, record.roundId);
    const own = ownsSubmission(record, viewer.user);
    const manage = canManage(item, viewer, orgs);
    if (!own && !manage) fail(404, 'NOT_FOUND', '提交记录不存在或无权访问。');
    if (!action && !download && request.method === 'GET') {
      return response({ submission: submissionView(record, item, round), canEdit: canEditSubmission(record, item, round, viewer.user, now()) });
    }
    if (request.method !== 'POST') fail(405, 'METHOD_NOT_ALLOWED', '不支持此操作。');
    if (download) return response({ download: await submissions.download(record.files.find((file) => file.id === fileId)) });
    if (action === 'review' && !manage) fail(403, 'STAFF_REQUIRED', '没有审核此提交的权限。');
    if (action === 'edit' && !own) fail(404, 'NOT_FOUND', '提交记录不存在或无权修改。');
    if (action) return response({ submission: await submissions.change(request, record, item, round, viewer.user, action, receivedAt) });
    fail(405, 'METHOD_NOT_ALLOWED', '不支持此操作。');
  }

  return {
    async handle(context, path) {
      if (path !== API && !path.startsWith(API + '/')) return null;
      const receivedAt = now();
      const request = context.request;
      const url = new URL(request.url);
      const post = request.method === 'POST';
      const write = post || request.method === 'DELETE';
      const itemMatch = path.match(itemPath);
      const submissionMatch = path.match(submissionPath);
      const onCatalog = path === API && request.method === 'GET';
      const onCreate = path === API + '/items' && post;
      const onPeople = path === API + '/people' && request.method === 'GET';
      const onMine = path === API + '/mine' && request.method === 'GET';
      if (submissionMatch?.[2] === 'complete' && post) return response({ submission: await submissions.complete(context, submissionMatch[1]) });
      if (submissionMatch?.[2] === 'cancel' && post) return response(await submissions.cancel(context, submissionMatch[1]));
      if (!onCatalog && !onCreate && !onPeople && !onMine && !itemMatch && !submissionMatch) return null;
      const [auth, orgs, available] = await Promise.all([
        identity.authenticate(request, { required: write || onPeople || onMine || Boolean(submissionMatch), csrf: write }),
        identity.loadOrganizations(),
        onCatalog || onMine ? definitions(repo) : null,
      ]);
      const viewer = { user: auth?.user ?? null, today: chinaDay(receivedAt) };
      if (onCatalog) return catalog(viewer, orgs, url, available);
      if (onPeople) {
        if (!isManagement(viewer.user.role)) fail(403, 'STAFF_REQUIRED', '此账号无权查看应交名单。');
        const { issuerOptions } = viewerInfo(viewer, orgs);
        const allowed = viewer.user.role === 'owner' ? null : new Set(issuerOptions.map(({ organizationId }) => organizationId));
        return response({
          organizations: flattenOrganizationTree(orgs),
          people: directoryPeople(await identity.loadAllUsers(), allowed, viewer.today),
        });
      }
      if (onMine) {
        const records = await myRecords(repo, viewer.user);
        return response({ items: ownHistory(new Map(available.map((item) => [item.id, item])), records) });
      }
      if (onCreate) {
        if (!isManagement(viewer.user.role)) fail(403, 'STAFF_REQUIRED', '此账号无权发布收集。');
        const body = await readJson(request, 256 * 1024);
        return createItem({ ...itemInput(body, timestamp()), issuer: publishedIssuer(body, viewer, orgs) }, viewer, orgs);
      }
      if (itemMatch) return routeItem(context, viewer, orgs, itemMatch, receivedAt);
      return routeSubmission(request, viewer, orgs, submissionMatch, receivedAt);
    },
  };
}
