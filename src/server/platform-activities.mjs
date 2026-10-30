import { randomUUID } from 'node:crypto';
import { fail, readJson, response, text } from './platform-common.mjs';

const API = '/api/platform';
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const key = (id) => `activities/records/${id}`;
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail(400, 'INVALID_TIME', '请填写有效的开始和结束时间。');
  if (new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== value.slice(0, 10)) fail(400, 'INVALID_TIME', '活动日期无效。');
  return new Date(value).toISOString();
}
export function createActivitiesService({ repo, identity, now = Date.now, loadPlaces }) {
  async function input(body, env) {
    const title = text(body.title, '活动标题', 80, true), description = text(body.description, '活动介绍', 2000);
    const startsAt = timestamp(body.startsAt), endsAt = timestamp(body.endsAt);
    if (endsAt <= startsAt || Date.parse(endsAt) - Date.parse(startsAt) > 31 * 86400000 || Date.parse(endsAt) <= now() || Date.parse(startsAt) > now() + 366 * 86400000) fail(400, 'INVALID_TIME', '结束须晚于开始，活动最长 31 天，请选择未来一年内的时间。');
    if (!['public', 'unlisted'].includes(body.visibility)) fail(400, 'INVALID_VISIBILITY', '请选择公开展示或仅凭链接访问。');
    const p = body.place;
    if (!p || typeof p !== 'object' || Array.isArray(p)) fail(400, 'INVALID_PLACE', '请选择活动地点。');
    let place;
    if (p.kind === 'campus') {
      const id = text(p.id, '地点', 160, true);
      const places = await loadPlaces(env);
      if (!places.some((item) => item.id === id)) fail(400, 'INVALID_PLACE', '地点不在当前校园数据中，请重新选择。');
      place = { kind: 'campus', id };
    } else if (p.kind === 'point') {
      if (!Array.isArray(p.position) || p.position.length !== 2 || p.position.some((v) => typeof v !== 'number' || !Number.isFinite(v)) || Math.abs(p.position[0]) > 180 || Math.abs(p.position[1]) > 85) fail(400, 'INVALID_PLACE', '地图坐标无效。');
      place = { kind: 'point', name: text(p.name, '地点名称', 80, true), position: [...p.position] };
    } else fail(400, 'INVALID_PLACE', '请选择校园地点或地图标记点。');
    return { title, description, startsAt, endsAt, place, visibility: body.visibility };
  }
  function view(record) {
    const { id, title, description, startsAt, endsAt, place, organiser, visibility, revision, createdAt, updatedAt } = record;
    return { id, title, description, startsAt, endsAt, place, organiser, visibility, revision, createdAt, updatedAt };
  }
  async function load(id) {
    if (!ID.test(id)) fail(404, 'ACTIVITY_NOT_FOUND', '活动不存在或已删除。');
    const record = await repo.latest(key(id));
    if (!record || record.deleted) fail(404, 'ACTIVITY_NOT_FOUND', '活动不存在或已删除。');
    return record;
  }
  return { async handle(context, path) {
    if (!path.startsWith(`${API}/activities`) && path !== `${API}/me/activities`) return null;
    const { request, env } = context, method = request.method;
    if (method === 'GET' && [API + '/activities', API + '/me/activities'].includes(path)) {
      const mine = path.endsWith('/me/activities');
      const auth = mine ? await identity.authenticate(request, { required: true }) : null;
      const prefix = mine ? `activities/by-user/${auth.user.id}/` : 'activities/index/';
      const indices = await repo.list(prefix);
      const records = await Promise.all(indices.map(async (index) => {
        const entry = await repo.get(index);
        return entry?.id ? repo.latest(key(entry.id)) : null;
      }));
      const eligible = records.filter((r) => r && !r.deleted && (mine ? r.organiser.id === auth.user.id : r.visibility === 'public') && Date.parse(r.endsAt) > now())
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
      const after = new URL(request.url).searchParams.get('after');
      const start = after ? eligible.findIndex((r) => r.id === after) + 1 : 0;
      if (after && start === 0) fail(400, 'INVALID_CURSOR', '列表已更新，请刷新。');
      const items = eligible.slice(start, start + 100);
      return response({ items: items.map(view), next: eligible.length > start + 100 ? items.at(-1).id : null });
    }
    if (method === 'POST' && path === API + '/activities') {
      const auth = await identity.authenticate(request, { required: true, csrf: true });
      await repo.throttle('activity-create', auth.user.id, 10, 3600);
      const body = await readJson(request, 12288), content = await input(body, env);
      const id = randomUUID(), time = new Date(now()).toISOString();
      const record = await repo.append(key(id), { id, ...content, organiser: { id: auth.user.id, name: auth.user.nickname || auth.user.realName }, createdAt: time, updatedAt: time, deleted: false }, 0);
      await repo.putNew(`activities/index/${id}.json`, { id });
      await repo.putNew(`activities/by-user/${auth.user.id}/${id}.json`, { id });
      await repo.audit(auth.user.id, 'activity.created', id);
      return response({ activity: view(record) }, 201);
    }
    const match = path.match(/^\/api\/platform\/activities\/([^/]+)(\/delete)?$/);
    if (!match) return null;
    if (method === 'GET' && !match[2]) return response({ activity: view(await load(match[1])) });
    if (method === 'POST' || method === 'DELETE') {
      const auth = await identity.authenticate(request, { required: true, csrf: true });
      const record = await load(match[1]);
      if (record.organiser.id !== auth.user.id) fail(404, 'ACTIVITY_NOT_FOUND', '活动不存在或不属于你。');
      await repo.throttle('activity-edit', auth.user.id, 60, 60);
      const body = await readJson(request, 12288);
      if (body.revision !== record.revision) fail(409, 'REVISION_CONFLICT', '活动已更新，请刷新后重试。');
      const deleting = method === 'DELETE' || Boolean(match[2]);
      const content = deleting ? {} : await input(body, env);
      const updated = await repo.append(key(record.id), { ...record, ...content, deleted: deleting, updatedAt: new Date(now()).toISOString() }, record.revision);
      await repo.audit(auth.user.id, deleting ? 'activity.deleted' : 'activity.updated', record.id);
      return response(deleting ? { ok: true } : { activity: view(updated) });
    }
    return null;
  } };
}
