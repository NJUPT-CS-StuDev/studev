import { afterEach, expect, it, vi } from 'vitest';
import { locateKnowledge, locateMap } from './digest';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function unavailable() {
    vi.stubEnv('MAP_DIR', ''); vi.stubEnv('MAP_INPUT', ''); vi.stubEnv('KNOWLEDGE_DIR', '');
    vi.stubEnv('DATA_TOKEN', '');
    const fetch = vi.fn(async (_input: string | URL | Request) => new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    return fetch;
}

it('reads the already resolved immutable tags without reselecting latest upstream releases', async () => {
    const fetch = unavailable();
    vi.stubEnv('MAP_VERSION', 'map-v0.9.1'); vi.stubEnv('KNOWLEDGE_VERSION', '20261116-1914');
    vi.stubEnv('MAP_REPOSITORY', 'hicancan/njupt-map'); vi.stubEnv('KNOWLEDGE_REPOSITORY', 'hicancan/njupt-knowledge');
    await expect(locateMap()).rejects.toThrow('HTTP 503');
    await expect(locateKnowledge()).rejects.toThrow('HTTP 503');
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
        'https://api.github.com/repos/hicancan/njupt-map/releases/tags/map-v0.9.1',
        'https://api.github.com/repos/hicancan/njupt-knowledge/releases/tags/knowledge-20261116-1914',
    ]);
});

it('still discovers latest inputs when an interactive build does not pin tags', async () => {
    const fetch = unavailable();
    vi.stubEnv('MAP_VERSION', ''); vi.stubEnv('KNOWLEDGE_VERSION', '');
    await expect(locateMap()).rejects.toThrow('HTTP 503');
    await expect(locateKnowledge()).rejects.toThrow('HTTP 503');
    expect(fetch.mock.calls.map(call => String(call[0]).split('/releases/')[1])).toEqual(['latest', 'latest']);
});

it('rejects invalid pinned release names before sending a request', async () => {
    const fetch = unavailable();
    vi.stubEnv('MAP_VERSION', '../latest'); vi.stubEnv('KNOWLEDGE_VERSION', '2026?latest');
    await expect(locateMap()).rejects.toThrow('invalid MAP_VERSION');
    await expect(locateKnowledge()).rejects.toThrow('invalid KNOWLEDGE_VERSION');
    expect(fetch).not.toHaveBeenCalled();
});
