import { session } from './platform-client';

// 0ms 瞬间从缓存初始化 staff 菜单项
try {
  const raw = localStorage.getItem('studev_auth_user');
  if (raw) {
    const cached = JSON.parse(raw);
    if (cached && cached.role && cached.role !== 'member') {
      document.querySelectorAll<HTMLElement>('[data-platform-staff]').forEach((n) => (n.hidden = false));
    }
  }
} catch {}

void (async () => {
  try {
    const current = await session();
    if (!current) return;
    if (current.user.role !== 'member') {
      document.querySelectorAll<HTMLElement>('[data-platform-staff]').forEach((n) => (n.hidden = false));
    }
  } catch {
    /* Each functional page presents its own connection error. */
  }
})();
