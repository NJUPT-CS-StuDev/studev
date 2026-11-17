import { api, PlatformError, type Session } from './api';

const CACHE_KEY = 'studev_auth_user';

export interface CachedAccount { nickname: string; role?: string; qq?: string; verifiedAt?: number }
export function readCachedAccount(): CachedAccount | null {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return cached && (cached.nickname || cached.role) ? cached : null;
  } catch { return null; }
}

function updateNavLinks(isLoggedIn: boolean) {
  // Forms are for people with an account; everyone else never sees the link.
  document.querySelectorAll<HTMLElement>('[data-account-link]').forEach((link) => {
    link.hidden = !isLoggedIn;
  });
  if (isLoggedIn) document.documentElement.dataset.authenticated = '';
  else delete document.documentElement.dataset.authenticated;
}

const cached = readCachedAccount();
const hasCachedUser = Boolean(cached);
// Page changes within a minute share the cached verification.
const shouldVerify = cached && (!cached.verifiedAt || Date.now() - cached.verifiedAt > 60_000);
updateNavLinks(hasCachedUser);

// 多标签页实时同步登录状态
window.addEventListener('storage', (e) => {
  if (e.key === CACHE_KEY) {
    updateNavLinks(Boolean(readCachedAccount()));
  }
});
window.addEventListener('studev:account', () => {
  updateNavLinks(Boolean(readCachedAccount()));
});

// 只有处于登录缓存且超过静默缓存周期、且不在由 platform-client 接管会话的平台功能页时，才在后台静默校准会话；
// 未登录普通访客绝对不触发无意义的 /api/platform/auth/session 请求，消灭 401 网络瀑布與重复请求
const isPlatformManagedPage = /^\/(?:account|admin|forms|fill|submissions)(?:\/|$)/.test(location.pathname);
if (hasCachedUser && shouldVerify && !isPlatformManagedPage) {
  void (async () => {
    try {
      const data = await api<Session>('/auth/session');
      if (data?.user) {
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({
            nickname: data.user.nickname,
            role: data.user.role || 'user',
            qq: data.user.qq,
            verifiedAt: Date.now()
          }));
        } catch {}
        updateNavLinks(true);
        window.dispatchEvent(new Event('studev:account'));
      }
    } catch (error) {
      if (error instanceof PlatformError && error.status === 401) {
        try { localStorage.removeItem(CACHE_KEY); } catch {}
        updateNavLinks(false);
        window.dispatchEvent(new Event('studev:account'));
      }
    }
  })();
}
