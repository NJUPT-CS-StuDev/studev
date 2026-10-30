import { api, button, el, errorText, formatTime, message, q, session } from './platform-client';
interface Device { id: string; deviceName: string; createdAt: string; expiresAt: number }
const root = q('[data-account-devices]'), status = q('[data-devices-status]');
async function refresh() {
  const result = await api<{ items: Device[] }>('/auth/devices');
  root.replaceChildren();
  if (!result.items.length) { root.append(el('p', '目前没有已登录的 App 设备。', 'p-muted')); return; }
  for (const device of result.items) {
    const row = el('div', undefined, 'p-card');
    row.append(el('h3', device.deviceName), el('p', `登录于 ${formatTime(device.createdAt)} · 最晚 ${formatTime(new Date(device.expiresAt).toISOString())} 重新登录`, 'p-help'));
    const actions = el('div', undefined, 'p-actions');
    actions.style.marginTop = '12px';
    actions.append(button('退出此设备', () => {
      actions.replaceChildren(el('span', '此设备将立即退出。', 'p-help'), button('确认退出', async () => {
        try { await api(`/auth/devices/${device.id}/revoke`, {}); await refresh(); message(status, '设备已退出。', 'success'); }
        catch(e) { message(status, errorText(e), 'error'); }
      }), button('取消', async () => { try { await refresh(); } catch(e) { message(status, errorText(e), 'error'); } }));
    }));
    row.append(actions); root.append(row);
  }
}
void (async () => {
  try {
    const current = await session();
    if (!current) return;
    if (current.profileRequired || current.mfaRequired || current.passwordChangeRequired || current.enrollmentRequired) { message(status, '完成账号安全设置后可管理设备。'); return; }
    await refresh();
  } catch(e) { message(status, errorText(e), 'error'); }
})();
