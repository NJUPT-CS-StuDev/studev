import release from '../data/campus-release.json';

interface InstallEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const panel = document.querySelector<HTMLDialogElement>('[data-pwa-panel]');
const status = document.querySelector<HTMLElement>('[data-pwa-status]');
const install = document.querySelector<HTMLButtonElement>('[data-pwa-install]');
const save = document.querySelector<HTMLButtonElement>('[data-pwa-save]');
const help = document.querySelector<HTMLElement>('[data-pwa-install-help]');
const update = document.querySelector<HTMLElement>('[data-pwa-update]');
const refresh = document.querySelector<HTMLButtonElement>('[data-pwa-refresh]');
let installEvent: InstallEvent | undefined;
let registration: ServiceWorkerRegistration | undefined;
let applying = false;
let ready = false;

document.querySelector('[data-pwa-open]')?.addEventListener('click', () => panel?.showModal());
document.querySelector('[data-pwa-close]')?.addEventListener('click', () => panel?.close());
document.querySelector('[data-pwa-dismiss]')?.addEventListener('click', () => { if (update) update.hidden = true; });
panel?.addEventListener('click', event => { if (event.target === panel) { const box = panel.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) panel.close(); } });

const standalone = matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
if (help && standalone) help.textContent = '已添加到主屏幕。';
else if (help && /iPhone|iPad|iPod/.test(navigator.userAgent)) help.textContent = '在 Safari 中点「分享」，选择「添加到主屏幕」，即可像应用一样打开。';
window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); installEvent = event as InstallEvent;
    if (install) install.hidden = false;
    if (help) help.hidden = true;
});
install?.addEventListener('click', async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === 'accepted' && help) { help.textContent = '已添加到主屏幕。'; help.hidden = false; }
    installEvent = undefined; install.hidden = true;
});

function connectionStatus() {
    if (!status) return;
    status.textContent = navigator.onLine
        ? (ready ? '校园地图与地点搜索已保存，可离线使用。' : '校园地图正在准备离线使用…')
        : (ready ? '当前离线 · 可以使用已保存的数据。' : '当前离线 · 联网后可保存数据。');
}
window.addEventListener('online', connectionStatus);
window.addEventListener('offline', connectionStatus);

function showUpdate() { if (update) update.hidden = false; }
function watchWorker(worker: ServiceWorker | null) {
    worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            if (applying) worker.postMessage({ type: 'SKIP_WAITING' }); else showUpdate();
        }
    });
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.addEventListener('message', event => {
        const message = event.data;
        if (message?.type === 'DATA_UPDATE') showUpdate();
        if (message?.type === 'OFFLINE_SAVING') { if (status) status.textContent = '正在保存，请保持页面打开…'; if (save) save.disabled = true; }
        if (message?.type === 'OFFLINE_READY') {
            ready = true; connectionStatus();
            if (status && message.all) status.textContent = '完整校园数据已保存，可离线使用。';
            if (save) save.disabled = false;
            window.dispatchEvent(new CustomEvent('studev:pwa-ready', { detail: message }));
        }
        if (message?.type === 'OFFLINE_PARTIAL') { if (status) status.textContent = '部分内容未保存，联网后可重试。'; if (save) save.disabled = false; }
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (applying) location.reload(); });
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(async registered => {
        registration = registered;
        ready = Boolean(await (await caches.open(`studev-data-${release.version}`)).match('/__studev_offline_ready__'));
        connectionStatus();
        if (registered.waiting) showUpdate();
        watchWorker(registered.installing);
        registered.addEventListener('updatefound', () => watchWorker(registered.installing));
        const check = () => { void registered.update(); void fetch('/pwa-release.json', { cache: 'no-cache' }).catch(() => undefined); };
        setInterval(check, 15 * 60_000);
        window.addEventListener('focus', check);
        check();
    }).catch(() => { if (status) status.textContent = '暂时无法保存离线数据，请稍后重试。'; });
} else if (status) status.textContent = '联网时可以查看全部校园数据。';

save?.addEventListener('click', () => {
    const worker = navigator.serviceWorker?.controller || registration?.active;
    if (worker) worker.postMessage({ type: 'SAVE_OFFLINE', all: true });
});
refresh?.addEventListener('click', async () => {
    applying = true;
    refresh.textContent = '正在更新…'; refresh.disabled = true;
    if (registration?.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    else {
        await registration?.update();
        if (registration?.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        else if (!registration?.installing) location.reload();
    }
});
