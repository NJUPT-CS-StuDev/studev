import release from '../data/campus-release.json';
import { downloadApk, readApkManifest, saveApkBlob } from './apk-download';

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
const appDownload = document.querySelector<HTMLAnchorElement>('[data-app-download]');
const appDownloadStatus = document.querySelector<HTMLElement>('[data-app-download-status]');
const appDownloadProgress = document.querySelector<HTMLProgressElement>('[data-app-download-progress]');
const appDownloadFallback = document.querySelector<HTMLElement>('[data-app-download-fallback]');
let installEvent: InstallEvent | undefined;
let registration: ServiceWorkerRegistration | undefined;
let applying = false;
let ready = false;

const iPhone = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// The entries link straight to the APK; with the script loaded they open the panel, which
// adds the version and description. iPhone cannot install an APK: it gets the PWA guidance.
for (const entry of document.querySelectorAll<HTMLElement>('[data-pwa-open]')) {
    if (iPhone) entry.textContent = '添加到主屏幕';
    entry.addEventListener('click', event => { event.preventDefault(); openPanel(); });
}
if (iPhone) {
    for (const element of document.querySelectorAll<HTMLElement>('[data-app-android]')) element.hidden = true;
    const title = document.querySelector<HTMLElement>('[data-pwa-web-title]');
    if (title) title.textContent = '添加到主屏幕';
}

function showApkStatus(text: string, visible = true) {
    if (!appDownloadStatus) return;
    appDownloadStatus.textContent = text; appDownloadStatus.hidden = !visible;
}
function showApkFallback(manifest: Awaited<ReturnType<typeof readApkManifest>>) {
    if (!appDownloadFallback) return;
    appDownloadFallback.replaceChildren(...manifest.parts.map(part => {
        const item = document.createElement('li'); const link = document.createElement('a');
        link.href = part.url; link.textContent = `下载 ${part.name}`; link.target = '_blank'; link.rel = 'noopener'; item.append(link); return item;
    }));
    appDownloadFallback.hidden = false;
}
appDownload?.addEventListener('click', event => {
    event.preventDefault();
    if (/MicroMessenger|QQ\//i.test(navigator.userAgent)) { showApkStatus('请在浏览器中打开此页面，再下载 Android 版。'); return; }
    if (iPhone) return;
    void (async () => {
        appDownload!.setAttribute('aria-disabled', 'true'); appDownload!.classList.add('is-busy');
        if (appDownloadProgress) { appDownloadProgress.hidden = false; appDownloadProgress.value = 0; }
        if (appDownloadFallback) appDownloadFallback.hidden = true;
        try {
            const latestUrl = new URL(appDownload!.href, location.href).toString();
            const manifest = await readApkManifest(latestUrl);
            showApkStatus(`正在下载 ${manifest.versionName}（0%）`);
            const blob = await downloadApk(manifest, new URL(latestUrl, location.href).toString(), (done, total) => {
                const percent = Math.round(done / total * 100); if (appDownloadProgress) appDownloadProgress.value = percent;
                showApkStatus(`正在下载 ${manifest.versionName}（${percent}%）`);
            });
            if (!saveApkBlob(blob, manifest.versionName)) { showApkStatus('当前浏览器无法直接保存 APK，请逐个下载分片：'); showApkFallback(manifest); }
            else showApkStatus(`已校验并开始保存 studev-${manifest.versionName}.apk`);
        } catch (error) { showApkStatus(error instanceof Error ? error.message : '下载失败，请稍后重试。'); }
        finally { appDownload!.removeAttribute('aria-disabled'); appDownload!.classList.remove('is-busy'); }
    })();
});

function openPanel() {
    panel?.showModal();
    void fetch('/pwa-release.json', { cache: 'no-cache' }).then(response => response.ok ? response.json() : null).then((data: { bytes?: number } | null) => {
        const copy = document.querySelector<HTMLElement>('[data-pwa-size]');
        if (copy && data?.bytes && Number.isFinite(data.bytes)) {
            const megabytes = Math.ceil(data.bytes / 1_000_000);
            copy.textContent = `地图和地点搜索会自动保存。完整数据还包括课表、考试、教室和通知，约 ${megabytes} MB。`;
        }
    }).catch(() => undefined);
}
document.querySelector('[data-pwa-close]')?.addEventListener('click', () => panel?.close());
document.querySelector('[data-pwa-dismiss]')?.addEventListener('click', () => { if (update) update.hidden = true; });
panel?.addEventListener('click', event => { if (event.target === panel) { const box = panel.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) panel.close(); } });

const standalone = matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
if (help && standalone) help.textContent = '已添加到主屏幕。';
else if (help && iPhone) help.textContent = '在 Safari 中点「分享」，选择「添加到主屏幕」，即可像应用一样打开。';
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
    // Cache readiness is available without a network round trip. Registering or
    // updating a worker can fail offline even when its active worker serves the app.
    void caches.open(`studev-data-${release.version}`).then(cache => cache.match('/__studev_offline_ready__')).then(marker => {
        ready = Boolean(marker); connectionStatus();
    }).catch(() => connectionStatus());
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
    navigator.serviceWorker.getRegistration('/').then(existing => !navigator.onLine && existing
        ? existing
        : navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })).then(registered => {
        registration = registered;
        if (registered.waiting) showUpdate();
        watchWorker(registered.installing);
        registered.addEventListener('updatefound', () => watchWorker(registered.installing));
        const check = () => {
            if (!navigator.onLine) return;
            void registered.update().catch(() => undefined);
            void fetch('/pwa-release.json', { cache: 'no-cache' }).catch(() => undefined);
        };
        setInterval(check, 15 * 60_000);
        window.addEventListener('focus', check);
        check();
    }).catch(() => { if (ready || !navigator.onLine) connectionStatus(); else if (status) status.textContent = '暂时无法保存离线数据，请稍后重试。'; });
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
