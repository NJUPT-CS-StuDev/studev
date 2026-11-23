import { api, button, el, errorText, formatTime, message, q } from './api';
interface Device { id: string; deviceName: string; createdAt: string; expiresAt: number; kind: 'cookie' | 'bearer'; current: boolean }
const root = q('[data-account-devices]'), status = q('[data-devices-status]');
let request: Promise<void> | null = null;
let loaded = false;
function render(items: Device[]) {
  const rows = document.createDocumentFragment();
  if (!items.length) rows.append(el('p', '目前没有已登录的设备。', 'p-muted'));
  for (const device of items) {
    const row = el('div', undefined, 'p-card');
    row.append(el('h3', device.deviceName + (device.current ? ' · 当前设备' : '') + (device.kind === 'cookie' ? ' · 网页' : ' · App')), el('p', `登录于 ${formatTime(device.createdAt)} · 当前有效至 ${formatTime(new Date(device.expiresAt).toISOString())}`, 'p-help'));
    const actions = el('div', undefined, 'p-actions');
    actions.style.marginTop = '12px';
    const offerExit = () => actions.replaceChildren(button('退出此设备', () => {
      actions.replaceChildren(el('span', '此设备将立即退出。', 'p-help'), button('确认退出', async () => {
        try { await api(`/auth/devices/${device.id}/revoke`, {}); if (device.current) { location.assign('/login/'); return; } await refresh(true); message(status, '设备已退出。', 'success'); }
        catch(e) { message(status, errorText(e), 'error'); }
      }), button('取消', offerExit));
    }));
    offerExit();
    row.append(actions); rows.append(row);
  }
  root.replaceChildren(rows);
}
function refresh(force = false): Promise<void> {
  if (request) return request;
  if (loaded && !force) return Promise.resolve();
  const control = q<HTMLButtonElement>('[data-devices-refresh]');
  control.disabled = true;
  message(status, loaded ? '正在刷新设备…' : '正在读取登录设备…');
  request = api<{ items: Device[] }>('/auth/devices').then(result => {
    render(result.items); loaded = true; message(status);
  }).catch(error => { message(status, errorText(error), 'error'); }).finally(() => {
    request = null; control.disabled = false;
  });
  return request;
}
q('[data-devices-refresh]').addEventListener('click', () => { void refresh(true); });
document.addEventListener('studev:account-tab', event => {
  if ((event as CustomEvent<string>).detail === 'devices') void refresh();
});
// The endpoint authenticates its own cookie, so a direct device link can read in parallel with the account.
if (new URLSearchParams(location.search).get('tab') === 'devices') void refresh();
