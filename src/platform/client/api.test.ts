import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, requestSession } from './api';

describe('account request renewal', () => {
    beforeEach(() => {
        const values = new Map<string, string>([['studev_session_generation', 'signed-in'], ['studev_session_renewed_at', String(Date.now())]]);
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key),
        });
        vi.stubGlobal('navigator', { userAgent: 'Windows', locks: { request: async (_name: string, run: () => unknown) => run() } });
    });
    afterEach(() => vi.unstubAllGlobals());

    it.each(['PASSWORD_INVALID', 'MFA_INVALID', 'MFA_REPLAYED', 'MFA_REQUIRED'])('preserves %s without renewing or repeating the action', async code => {
        const fetch = vi.fn(async () => Response.json({ error: { code, message: '请检查输入。' } }, { status: 401 }));
        vi.stubGlobal('fetch', fetch);
        await expect(api('/auth/password', { currentPassword: 'invalid-test-password' })).rejects.toMatchObject({ code, status: 401 });
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem('studev_session_generation')).toBe('signed-in');
        expect(localStorage.getItem('studev_session_refresh_pending')).toBeNull();
    });

    it.each(['TOKEN_INVALID', 'AUTH_REQUIRED'])('renews %s once and repeats the original request', async code => {
        const fetch = vi.fn()
            .mockResolvedValueOnce(Response.json({ error: { code } }, { status: 401 }))
            .mockResolvedValueOnce(Response.json({ ok: true }))
            .mockResolvedValueOnce(Response.json({ items: [] }));
        vi.stubGlobal('fetch', fetch);
        await expect(api('/auth/devices')).resolves.toEqual({ items: [] });
        expect(fetch.mock.calls.map(call => call[0])).toEqual(['/api/platform/auth/devices', '/api/platform/auth/refresh', '/api/platform/auth/devices']);
        expect(JSON.parse(fetch.mock.calls[1]?.[1]?.body ?? '{}')).toMatchObject({ foreground: true });
        expect(localStorage.getItem('studev_session_refresh_pending')).toBeNull();
    });

    it('rotates an access credential in a hidden page without extending its idle deadline', async () => {
        const page = { visibilityState: 'hidden', hasFocus: () => true };
        vi.stubGlobal('document', page);
        const fetch = vi.fn()
            .mockResolvedValueOnce(Response.json({ error: { code: 'TOKEN_INVALID' } }, { status: 401 }))
            .mockResolvedValueOnce(Response.json({ ok: true }))
            .mockResolvedValueOnce(Response.json({ items: [] }))
            .mockResolvedValueOnce(Response.json({ ok: true }))
            .mockResolvedValueOnce(Response.json({ items: [] }));
        vi.stubGlobal('fetch', fetch);
        await expect(api('/auth/devices')).resolves.toEqual({ items: [] });
        expect(JSON.parse(fetch.mock.calls[1]?.[1]?.body ?? '{}')).toMatchObject({ foreground: false });
        page.visibilityState = 'visible';
        await expect(api('/auth/devices')).resolves.toEqual({ items: [] });
        expect(fetch.mock.calls[3]?.[0]).toBe('/api/platform/auth/refresh');
        expect(JSON.parse(fetch.mock.calls[3]?.[1]?.body ?? '{}')).toMatchObject({ foreground: true });
    });

    it('loads only public collection pages without credentials while renewal is incomplete', async () => {
        localStorage.setItem('studev_session_refresh_pending', '1');
        const fetch = vi.fn(async (_url: string, _options: RequestInit) => Response.json({ viewer: null }));
        vi.stubGlobal('fetch', fetch);
        for (const path of ['/collections', '/collections/items/public-demo']) {
            await expect(api(path)).resolves.toEqual({ viewer: null });
        }
        await expect(api('/collections/people')).rejects.toMatchObject({ status: 401 });
        await expect(api('/collections/mine')).rejects.toMatchObject({ status: 401 });
        await expect(api('/collections/items/public-demo', {})).rejects.toMatchObject({ status: 401 });
        expect(fetch.mock.calls.map(([, options]) => options.credentials)).toEqual(['omit', 'omit']);
    });

    it.each([true, false])('tries to renew first before reading public collections (renewable: %s)', async renewable => {
        const viewer = renewable ? { role: 'user' } : null;
        const fetch = vi.fn()
            .mockResolvedValueOnce(Response.json({ error: { code: 'TOKEN_INVALID' } }, { status: 401 }))
            .mockResolvedValueOnce(renewable ? Response.json({ ok: true }) : Response.json({ error: { code: 'TOKEN_INVALID' } }, { status: 401 }))
            .mockResolvedValueOnce(Response.json({ viewer }));
        vi.stubGlobal('fetch', fetch);
        await expect(api('/collections')).resolves.toEqual({ viewer });
        expect(fetch.mock.calls.map(([url, options]) => [url, options.credentials])).toEqual([
            ['/api/platform/collections', 'same-origin'], ['/api/platform/auth/refresh', 'same-origin'],
            ['/api/platform/collections', renewable ? 'same-origin' : 'omit'],
        ]);
    });

    it('renews a day-old idle window once before the first request of a page in use', async () => {
        localStorage.setItem('studev_session_renewed_at', String(Date.now() - 86_400_001));
        const fetch = vi.fn().mockResolvedValueOnce(Response.json({ csrfToken: 'renewed' })).mockImplementation(async () => Response.json({ items: [] }));
        vi.stubGlobal('fetch', fetch);
        await expect(api('/auth/devices')).resolves.toEqual({ items: [] });
        await expect(api('/auth/devices')).resolves.toEqual({ items: [] });
        expect(fetch.mock.calls.map(call => call[0])).toEqual(['/api/platform/auth/refresh', '/api/platform/auth/devices', '/api/platform/auth/devices']);
        expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body ?? '{}')).toMatchObject({ foreground: true });
    });

    it('does not loop when the renewed session is refused', async () => {
        const expired = () => Response.json({ error: { code: 'TOKEN_INVALID' } }, { status: 401 });
        const fetch = vi.fn().mockResolvedValueOnce(expired()).mockResolvedValueOnce(Response.json({ ok: true })).mockResolvedValueOnce(expired());
        vi.stubGlobal('fetch', fetch);
        await expect(api('/auth/devices')).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('shares a recent session proof within a page and reads a new proof after switching accounts', async () => {
        vi.stubGlobal('location', { pathname: '/ai/' });
        const first = { user: { id: 'first', role: 'user' }, csrfToken: 'first-proof' };
        const next = { user: { id: 'next', role: 'user' }, csrfToken: 'next-proof' };
        const fetch = vi.fn().mockResolvedValueOnce(Response.json(first)).mockResolvedValueOnce(Response.json(next));
        vi.stubGlobal('fetch', fetch);
        await expect(Promise.all([requestSession(), requestSession()])).resolves.toEqual([first, first]);
        await expect(requestSession()).resolves.toEqual(first);
        expect(fetch).toHaveBeenCalledTimes(1);
        localStorage.setItem('studev_session_generation', 'another-session');
        await expect(requestSession()).resolves.toEqual(next);
        expect(fetch).toHaveBeenCalledTimes(2);
        localStorage.setItem('studev_session_refresh_pending', '1');
        await expect(requestSession()).resolves.toBeNull();
        expect(fetch).toHaveBeenCalledTimes(2);
    });
});

describe('reads shown from this device copy', () => {
    let values: Map<string, string>;
    const load = async () => { vi.resetModules(); return import('./api'); };
    const later = () => { let release!: (response: Response) => void; return { promise: new Promise<Response>(resolve => { release = resolve; }), release: (body: unknown, status = 200) => release(Response.json(body, { status })) }; };
    beforeEach(() => {
        values = new Map([['studev_session_generation', 'signed-in'], ['studev_session_renewed_at', String(Date.now())], ['studev_auth_user', JSON.stringify({ id: 'u1', nickname: 'n' })]]);
        vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
        vi.stubGlobal('navigator', { userAgent: 'Windows', locks: { request: async (_name: string, run: () => unknown) => run() } });
        vi.stubGlobal('location', { pathname: '/forms/', search: '', reload: vi.fn(), replace: vi.fn() });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('shows the copy at once and the server answer only when it differs', async () => {
        const { read } = await load();
        const shown: unknown[] = [];
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [1] })));
        await read('/collections/mine', data => shown.push(data));
        const pending = later();
        vi.stubGlobal('fetch', vi.fn(() => pending.promise));
        await read('/collections/mine', data => shown.push(data));
        expect(shown).toEqual([{ items: [1] }, { items: [1] }]);
        pending.release({ items: [1, 2] });
        await vi.waitFor(() => expect(shown).toHaveLength(3));
        expect(shown[2]).toEqual({ items: [1, 2] });
    });

    it('drops every copy after a write, so the next read waits for the server', async () => {
        const { api, read } = await load();
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [1] })));
        await read('/collections/mine', () => undefined);
        await api('/collections/items/x/submissions', { answer: 1 });
        const pending = later();
        vi.stubGlobal('fetch', vi.fn(() => pending.promise));
        const shown: unknown[] = [];
        const done = read('/collections/mine', data => shown.push(data));
        await Promise.resolve();
        expect(shown).toEqual([]);
        pending.release({ items: [2] });
        await done;
        expect(shown).toEqual([{ items: [2] }]);
    });

    it('keeps the copy across a ticket renewal and campus sync', async () => {
        const { api, read } = await load();
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [1] })));
        await read('/collections/mine', () => undefined);
        await api('/sync', { tasks: [] });
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
        const shown: unknown[] = [];
        await read('/collections/mine', data => shown.push(data));
        expect(shown).toEqual([{ items: [1] }]);
    });

    it('keeps an answer that began before a write out of the copy', async () => {
        const { api, read } = await load();
        const pending = later();
        vi.stubGlobal('fetch', vi.fn(() => pending.promise));
        const first = read('/collections/mine', () => undefined);
        await Promise.resolve();
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true })));
        await api('/collections/items/x/submissions', { answer: 1 });
        pending.release({ items: ['before the write'] });
        await first;
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: ['after'] })));
        const shown: unknown[] = [];
        await read('/collections/mine', data => shown.push(data));
        expect(shown).toEqual([{ items: ['after'] }]);
    });

    it('drops the copy and reloads when the server no longer lets it be read', async () => {
        const { read } = await load();
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [1] })));
        await read('/collections/mine', () => undefined);
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'FORBIDDEN' } }, { status: 403 })));
        await read('/collections/mine', () => undefined);
        await vi.waitFor(() => expect(location.reload).toHaveBeenCalledTimes(1));
        const pending = later();
        vi.stubGlobal('fetch', vi.fn(() => pending.promise));
        const shown: unknown[] = [];
        void read('/collections/mine', data => shown.push(data));
        await Promise.resolve();
        expect(shown).toEqual([]);
    });

    it('keeps the copy offline', async () => {
        const { read } = await load();
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [1] })));
        await read('/collections/mine', () => undefined);
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
        await read('/collections/mine', () => undefined);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(location.reload).not.toHaveBeenCalled();
    });

    it('keeps copies of different accounts apart', async () => {
        const { read } = await load();
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: ['u1'] })));
        await read('/collections/mine', () => undefined);
        values.set('studev_auth_user', JSON.stringify({ id: 'u2', nickname: 'm' }));
        const pending = later();
        vi.stubGlobal('fetch', vi.fn(() => pending.promise));
        const shown: unknown[] = [];
        void read('/collections/mine', data => shown.push(data));
        await Promise.resolve();
        expect(shown).toEqual([]);
    });

    it('gives the session at once and reloads only when the server changes what the page may show', async () => {
        const { session } = await load();
        const user = { id: 'u1', role: 'user', status: 'active' };
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ user, csrfToken: 'c', mfaVerified: false })));
        await session();
        const pending = later();
        vi.stubGlobal('fetch', vi.fn(() => pending.promise));
        await expect(session()).resolves.toMatchObject({ user: { id: 'u1' } });
        pending.release({ user: { ...user, nickname: 'renamed' }, csrfToken: 'c', mfaVerified: false });
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(location.reload).not.toHaveBeenCalled();
        const revoked = later();
        vi.stubGlobal('fetch', vi.fn(() => revoked.promise));
        await expect(session()).resolves.toMatchObject({ user: { id: 'u1' } });
        revoked.release({ user: { ...user, role: 'admin' }, csrfToken: 'c', mfaVerified: false });
        await vi.waitFor(() => expect(location.reload).toHaveBeenCalledTimes(1));
    });
});
