import { api, PlatformError, type Session } from './api';

const CACHE_KEY = 'studev_auth_user';
const anonymousFace = document.querySelector('[data-me-face]')?.firstElementChild?.cloneNode(true);

function updateNavLinks(isLoggedIn: boolean) {
  // Forms are for people with an account; everyone else never sees the link.
  document.querySelectorAll<HTMLElement>('[data-account-link]').forEach((link) => {
    link.hidden = !isLoggedIn;
  });
  if (isLoggedIn) document.documentElement.dataset.authenticated = '';
  else delete document.documentElement.dataset.authenticated;
  const button = document.querySelector<HTMLButtonElement>('[data-me]');
  const face = button?.querySelector<HTMLElement>('[data-me-face]');
  const name = button?.querySelector<HTMLElement>('[data-me-name]');
  if (!button || !face || !name) return;
  let user: { nickname?: string; qq?: string } | null = null;
  try { if (isLoggedIn) user = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch {}
  name.textContent = user?.nickname || '未登录';
  button.setAttribute('aria-label', `${name.textContent}，打开我`);
  const letter = () => { face.textContent = user?.nickname?.slice(0, 1) || '我'; };
  if (user && /^[1-9]\d{4,11}$/.test(user.qq || '')) {
    const picture = new Image(); picture.alt = ''; picture.referrerPolicy = 'no-referrer'; picture.onerror = letter;
    picture.src = `https://q1.qlogo.cn/g?b=qq&nk=${user.qq}&s=100`;
    face.replaceChildren(picture);
  } else if (user) letter();
  else face.replaceChildren(...(anonymousFace ? [anonymousFace.cloneNode(true)] : []));
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
window.addEventListener('studev:account', () => {
  let signedIn = false;
  try { signedIn = Boolean(JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')?.nickname); } catch {}
  updateNavLinks(signedIn);
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
