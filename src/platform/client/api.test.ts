import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

describe('account request renewal', () => {
    beforeEach(() => {
        const values = new Map<string, string>([['studev_session_generation', 'signed-in']]);
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
        expect(localStorage.getItem('studev_session_refresh_pending')).toBeNull();
    });

    it('allows only explicit public collection reads while renewal is incomplete', async () => {
        localStorage.setItem('studev_session_refresh_pending', '1');
        const fetch = vi.fn(async () => Response.json({ view: 'guest' }));
        vi.stubGlobal('fetch', fetch);
        for (const path of ['/collections?view=guest', '/collections/items/public-demo?view=guest']) {
            await expect(api(path)).resolves.toEqual({ view: 'guest' });
        }
        await expect(api('/collections')).rejects.toMatchObject({ status: 401 });
        await expect(api('/collections/people?view=guest')).rejects.toMatchObject({ status: 401 });
        await expect(api('/collections/items/public-demo?view=guest', {})).rejects.toMatchObject({ status: 401 });
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('does not loop when the renewed session is refused', async () => {
        const expired = () => Response.json({ error: { code: 'TOKEN_INVALID' } }, { status: 401 });
        const fetch = vi.fn().mockResolvedValueOnce(expired()).mockResolvedValueOnce(Response.json({ ok: true })).mockResolvedValueOnce(expired());
        vi.stubGlobal('fetch', fetch);
        await expect(api('/auth/devices')).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
        expect(fetch).toHaveBeenCalledTimes(3);
    });
});
