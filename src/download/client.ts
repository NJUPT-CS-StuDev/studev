import { apkPath, readLatest } from './manifest.js';

const link = document.querySelector<HTMLAnchorElement>('[data-download-apk]')!;
const status = document.querySelector<HTMLElement>('[data-download-status]')!;
const progress = document.querySelector<HTMLProgressElement>('[data-download-progress]')!;
const embedded = /MicroMessenger|QQ\//i.test(navigator.userAgent);
let path: string | undefined;
let controlled = false;

async function prepare() {
    if (embedded) { status.textContent = '请在浏览器中打开'; return; }
    if (!('serviceWorker' in navigator)) throw new Error('请使用支持下载的新版浏览器打开。');
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    // An already installed worker can be the previous site's code. Activate the
    // newly installed worker before exposing its download route.
    if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    registration.installing?.addEventListener('statechange', () => {
        if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
        if (navigator.serviceWorker.controller) resolve();
    });
    // A capability handshake prevents an old controlling worker from sending a
    // first-visit download to a static 404 while the update activates.
    await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('下载服务尚未就绪，请刷新重试。')), 30_000);
        const ping = () => {
            const channel = new MessageChannel();
            channel.port1.onmessage = () => { clearTimeout(timeout); channel.port1.close(); navigator.serviceWorker.removeEventListener('controllerchange', ping); resolve(); };
            navigator.serviceWorker.controller?.postMessage({ type: 'APK_READY' }, [channel.port2]);
        };
        navigator.serviceWorker.addEventListener('controllerchange', ping);
        ping();
    });
    const manifest = await readLatest(location.origin);
    path = apkPath(manifest);
    link.href = path;
    link.removeAttribute('aria-disabled');
    link.textContent = `下载 Android 版 v${manifest.versionName}`;
    status.textContent = `${(manifest.size / 1048576).toFixed(1)} MB · 下载进度可在浏览器中查看`;
    controlled = true;
}
link.addEventListener('click', event => {
    if (!controlled) { event.preventDefault(); if (embedded) status.textContent = '请在浏览器中打开'; return; }
    progress.hidden = false; progress.value = 0;
    status.textContent = '已交给浏览器下载，请在浏览器的下载列表中查看进度。';
});
navigator.serviceWorker?.addEventListener('message', event => {
    const data = event.data;
    if (data?.type !== 'APK_DOWNLOAD' || data.path !== path) return;
    if (Number.isFinite(data.total) && data.total > 0) {
        progress.max = data.total; progress.value = data.done;
    }
    status.textContent = data.state === 'complete' ? '校验完成，请在浏览器的下载列表中打开 APK。'
        : data.state === 'error' ? '下载校验失败，浏览器已中止下载。请重试。'
        : data.state === 'cancelled' ? '下载已取消。'
        : `正在下载并校验 ${Math.floor(data.done / data.total * 100)}% · 请在浏览器中查看`;
});
void prepare().catch(error => { status.textContent = error instanceof Error ? error.message : '下载暂时不可用，请稍后重试。'; });
