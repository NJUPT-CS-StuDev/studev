import { SearchClient, type SearchBundleManifest } from 'wasm-search';
import { APP_CONFIG } from './config';

let shared: SearchClient | undefined;

/** The search page and assistant share the engine for this visit's immutable snapshot. */
export function searchClient(): SearchClient {
    if (shared) return shared;
    const baseUrl = APP_CONFIG.DATA_URLS.SEARCH;
    const seed = document.querySelector<HTMLScriptElement>('script[data-search-base]');
    const manifest = seed?.dataset.searchBase === baseUrl ? JSON.parse(seed.textContent!) as SearchBundleManifest : undefined;
    return shared = new SearchClient({ baseUrl, manifest });
}

/** Readies the engine while the browser is idle, so the first search does not wait for the index. Skipped when the
 * reader asked to save data; the index is kept in Cache Storage, so this reads the network once per bundle. */
export function warmSearch() {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (connection?.saveData) return;
    const start = () => void searchClient().initialize().then(() => {
        const wasm = document.querySelector<HTMLScriptElement>('script[data-search-wasm]')?.dataset.searchWasm;
        if (wasm) localStorage.setItem('studev-search-kernel', wasm);
    }).catch(() => undefined);
    if (location.pathname === '/search/') { start(); return; }
    const idle = () => { if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 8000 }); else setTimeout(start, 3000); };
    // An idle main thread is not an idle network: a page whose first view is still arriving is not raced for bandwidth.
    if (!document.querySelector('main[data-settles]')) { idle(); return; }
    let started = false;
    const once = () => { if (!started) { started = true; idle(); } };
    window.addEventListener('studev:settled', once, { once: true });
    setTimeout(once, 20_000);
}
