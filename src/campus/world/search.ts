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
