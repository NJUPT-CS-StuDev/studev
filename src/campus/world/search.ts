import { SearchClient } from 'wasm-search';
import { APP_CONFIG, releaseReady } from './config';

let shared: { base: string; client: SearchClient } | null = null;

/** The session's one search engine: the search page and the assistant's tools share it, so the index is read and
 * decoded once. A new campus release moves the bundle; the engine of the old one is let go. */
export async function searchClient(): Promise<SearchClient> {
    await releaseReady;
    const base = APP_CONFIG.DATA_URLS.SEARCH;
    if (shared?.base !== base) {
        shared?.client.dispose();
        shared = { base, client: new SearchClient({ baseUrl: base }) };
    }
    return shared.client;
}

/** Readies the engine while the browser is idle, so the first search does not wait for the index. Skipped when the
 * reader asked to save data; the index is kept in Cache Storage, so this reads the network once per bundle. */
export function warmSearch() {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (connection?.saveData) return;
    const start = () => void searchClient().then(client => client.initialize()).catch(() => undefined);
    if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 8000 }); else setTimeout(start, 3000);
}
