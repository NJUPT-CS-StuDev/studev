import { createPlatformHandler } from './platform-app.mjs';
import { platformOrigin, fail } from './platform-common.mjs';
import release from '../data/campus-release.json' with { type: 'json' };
let places;
const handle = createPlatformHandler({ loadPlaces: async (env) => {
  // Fixed, versioned static package URL; never fetch a caller-supplied address.
  places ||= (async () => {
    const result = await fetch(`${platformOrigin(env)}${release.base}/space/${encodeURIComponent('仙林')}/places.json`, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (!result.ok) fail(503, 'CAMPUS_UNAVAILABLE', '校园地点暂时无法验证，请稍后重试。');
    const data = await result.json();
    if (!Array.isArray(data)) fail(503, 'CAMPUS_UNAVAILABLE', '校园地点暂时无法验证，请稍后重试。');
    return data;
  })().catch((error) => { places = null; throw error; });
  return places;
} });
export async function onRequest(context) { return handle(context); }
