const CACHE_KEY = 'studev_auth_user';

function setAccountLabel(isLoggedIn: boolean) {
  const link = document.querySelector<HTMLAnchorElement>('[data-global-account-link]');
  if (!link) return;
  if (isLoggedIn) {
    link.textContent = 'Account';
    link.href = '/account/';
  } else {
    link.textContent = 'Login';
    link.href = '/login/';
  }
}

// 0ms 瞬间从本地状态初始化
let hasCachedUser = false;
let shouldVerify = false;

try {
  const raw = localStorage.getItem(CACHE_KEY);
  if (raw) {
    const cached = JSON.parse(raw);
    if (cached && (cached.nickname || cached.role)) {
      hasCachedUser = true;
      setAccountLabel(true);
      // 60秒内不重复向后端发送网络验证请求，避免页面连续切换时的网络开销
      const now = Date.now();
      if (!cached.verifiedAt || now - cached.verifiedAt > 60_000) {
        shouldVerify = true;
      }
    }
  }
} catch {}

// 多标签页实时同步登录状态
window.addEventListener('storage', (e) => {
  if (e.key === CACHE_KEY) {
    try {
      const data = e.newValue ? JSON.parse(e.newValue) : null;
      setAccountLabel(Boolean(data?.nickname || data?.role));
    } catch {
      setAccountLabel(false);
    }
  }
});

// 只有处于登录缓存且超过静默缓存周期时，才在后台静默校准会话；
// 未登录普通访客绝对不触发无意义的 /api/platform/auth/session 请求，消灭 401 网络瀑布
if (hasCachedUser && shouldVerify) {
  void (async () => {
    try {
      const res = await fetch('/api/platform/auth/session', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json() as { user?: { nickname?: string; role?: string } };
        if (data?.user) {
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
              nickname: data.user.nickname,
              role: data.user.role || 'member',
              verifiedAt: Date.now()
            }));
          } catch {}
          setAccountLabel(true);
          return;
        }
      }
      try { localStorage.removeItem(CACHE_KEY); } catch {}
      setAccountLabel(false);
    } catch {}
  })();
}
