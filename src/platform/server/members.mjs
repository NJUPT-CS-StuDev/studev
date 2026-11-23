import { fail } from './common.mjs';
import { isConflict, revisionProjection } from './store.mjs';
import { profileNickname } from './roster.mjs';

export const memberId = /^[a-f0-9-]{36}$/;
const directory = 'members';
const published = user => ({ id: user.id, nickname: profileNickname(user), signature: user.signature || '', active: user.status === 'active' });

/** Public profiles have their own directory; account revisions never enter a member read. */
export function createMembers(repo, origin) {
  function projection(value) { return { id: value.id, nickname: value.nickname, signature: value.signature, avatarUrl: `${origin}/api/platform/members/${value.id}/avatar` }; }
  async function publish(user, previous) {
    if (previous && JSON.stringify(published(user)) === JSON.stringify(published(previous))) {
      const current = await repo.latest(`members/${user.id}`);
      if (current && JSON.stringify(published(user)) === JSON.stringify({ id: current.id, nickname: current.nickname, signature: current.signature, active: current.active })) return;
    }
    const key = `members/${user.id}/${String(user.revision).padStart(8, '0')}.json`;
    const value = { ...published(user), revision: user.revision };
    try { await repo.putNew(key, value); }
    catch (error) { if (!isConflict(error)) throw error; if (JSON.stringify(await repo.get(key)) !== JSON.stringify(value)) throw error; }
  }
  async function get(id) {
    const value = await repo.latest(`members/${id}`);
    if (!value || !value.active) fail(404, 'MEMBER_NOT_FOUND', '找不到这位成员。');
    return projection(value);
  }
  async function list(query, offset, limit) {
    const profiles = await revisionProjection(repo, directory + '/directory.json', directory, async (heads) => {
      const tips = [...heads].filter(([id]) => memberId.test(id)).map(([, tip]) => tip);
      const values = [];
      for (let start = 0; start < tips.length; start += 32) {
        values.push(...await Promise.all(tips.slice(start, start + 32).map(repo.readRevision)));
      }
      return values.filter(value => value?.active)
        .map(({ id, nickname, signature }) => ({ id, nickname, signature }))
        .sort((a, b) => a.nickname.localeCompare(b.nickname, 'zh-CN') || a.id.localeCompare(b.id));
    });
    const visible = query ? profiles.filter(value => value.nickname.normalize('NFKC').toLocaleLowerCase('zh-CN').includes(query)) : profiles;
    return { items: visible.slice(offset, offset + limit).map(projection), total: visible.length, offset, limit };
  }
  return { publish, get, list };
}

/** Stop reading as soon as the real body limit is exceeded, even without Content-Length. */
export async function avatarBody(picture) {
  const limit = 2 * 1024 * 1024;
  const reader = picture.body?.getReader();
  if (!reader) fail(502, 'AVATAR_UNAVAILABLE', '头像暂时无法加载。');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) fail(502, 'AVATAR_UNAVAILABLE', '头像暂时无法加载。');
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return bytes;
}
