const CACHE_KEY = 'studev_auth_user';

function updateNavLinks(isLoggedIn: boolean) {
  const accountLink = document.querySelector<HTMLAnchorElement>('[data-global-account-link]');
  if (accountLink) {
    if (isLoggedIn) {
      accountLink.textContent = 'Account';
      accountLink.href = '/account/';
    } else {
      accountLink.textContent = 'Login';
      accountLink.href = '/login/';
    }
  }

  // 访客点击 Forms 直达登录页，已登录直达表单，杜绝中间重定向延迟
  const formsLink = document.querySelector<HTMLAnchorElement>('.site-nav a[href="/forms/"], .site-nav a[href*="/login/?next="]');
  if (formsLink) {
    formsLink.href = isLoggedIn ? '/forms/' : '/login/?next=%2Fforms%2F';
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
      updateNavLinks(true);
      // 60秒内不重复向后端发送网络验证请求，避免页面连续切换时的网络开销
      const now = Date.now();
      if (!cached.verifiedAt || now - cached.verifiedAt > 60_000) {
        shouldVerify = true;
      }
    }
  }
} catch {}

if (!hasCachedUser) {
  updateNavLinks(false);
}

// 多标签页实时同步登录状态
window.addEventListener('storage', (e) => {
  if (e.key === CACHE_KEY) {
    try {
      const data = e.newValue ? JSON.parse(e.newValue) : null;
      updateNavLinks(Boolean(data?.nickname || data?.role));
    } catch {
      updateNavLinks(false);
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
          updateNavLinks(true);
          return;
        }
      }
      try { localStorage.removeItem(CACHE_KEY); } catch {}
      updateNavLinks(false);
    } catch {}
  })();
}
