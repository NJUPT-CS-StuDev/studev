import { randomBytes, randomUUID } from 'node:crypto';
import { digest, safeEqual } from './crypto.mjs';
import { fail } from './common.mjs';
import { deviceHash } from './sessions.mjs';

const TRUST_MS = 30 * 86400 * 1000;
const MAX_TRUSTED = 20;
const CREDENTIAL = /^([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/;
const prefix = (userId) => `identity/devices/trusted/${userId}/`;
const key = (userId, id) => `${prefix(userId)}${id}.json`;

export function createTrustedDevices({ repo, now, isCurrentSession }) {
  const usable = (record, user, time = now()) => record?.expiresAt > time && record.securityVersion === user.securityVersion;

  async function recordsFor(user) {
    const paths = await repo.list(prefix(user.id));
    const records = [];
    for (let offset = 0; offset < paths.length; offset += MAX_TRUSTED) {
      records.push(...await Promise.all(paths.slice(offset, offset + MAX_TRUSTED).map(path => repo.get(path))));
    }
    return records.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async function verify(user, token, kind, deviceId) {
    const parts = typeof token === 'string' ? CREDENTIAL.exec(token) : null;
    if (!parts) return false;
    const hash = deviceHash(deviceId);
    const record = await repo.get(key(user.id, parts[1]));
    return usable(record, user) && record.kind === kind && record.deviceHash === hash && safeEqual(record.tokenHash, digest(parts[2]));
  }

  async function grant(user, session) {
    const time = now();
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const { deviceHash, deviceName, kind, loginGeneration } = session;
    const expiresAt = time + TRUST_MS;
    const previous = (await recordsFor(user)).filter(record => record.loginGeneration < loginGeneration && record.accountRevision <= user.revision);
    const retained = new Set(previous.filter(record => usable(record, user, time) && (record.deviceHash !== deviceHash || record.kind !== kind))
      .slice(0, MAX_TRUSTED - 1).map(record => record.id));
    await repo.putNew(key(user.id, id), {
      id, deviceHash, deviceName, kind, expiresAt, createdAt: new Date(time).toISOString(),
      loginGeneration, accountRevision: user.revision, securityVersion: user.securityVersion, tokenHash: digest(secret),
    });
    if (!await isCurrentSession(session)) {
      await repo.remove(key(user.id, id));
      fail(409, 'REVISION_CONFLICT', '此设备的登录已更新，请重新登录。');
    }
    // Only remove immutable grants seen before this issuance. A concurrent newer grant has its own key.
    await Promise.allSettled(previous.filter(record => !retained.has(record.id)).map(record => repo.remove(key(user.id, record.id))));
    return { token: `${id}.${secret}`, expiresAt };
  }

  async function list(user, session) {
    const records = await recordsFor(user);
    const time = now();
    return records.filter((record) => usable(record, user, time)).map(({ id, deviceName, kind, createdAt, expiresAt, deviceHash }) => ({
      id, deviceName, kind, createdAt, expiresAt, current: kind === session.kind && deviceHash === session.deviceHash,
    }));
  }

  async function revoke(user, id) {
    const path = key(user.id, id);
    if (!await repo.get(path)) fail(404, 'DEVICE_NOT_FOUND', '设备不存在。');
    // A grant is created once at this unique key. Removing it cannot revive an older grant.
    await repo.remove(path);
  }

  return { verify, grant, list, revoke };
}
