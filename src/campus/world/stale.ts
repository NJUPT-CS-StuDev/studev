// A retired snapshot is replaced only after discovery confirms another complete
// component set. Ordinary offline failures never turn into a reload loop.
import { DATA_RELEASE, latestCampusRelease } from '@/world/config';

export async function reloadIfGone(): Promise<void> {
    const key = `studev_left_behind_${DATA_RELEASE.version}_${DATA_RELEASE.base}`;
    try {
        if (sessionStorage.getItem(key)) return;
        const current = await latestCampusRelease();
        if (!current || JSON.stringify([current.version, current.base, current.map_base, current.knowledge_base, current.search_base]) === JSON.stringify([DATA_RELEASE.version, DATA_RELEASE.base, DATA_RELEASE.map_base, DATA_RELEASE.knowledge_base, DATA_RELEASE.search_base])) return;
        sessionStorage.setItem(key, '1');
        location.reload();
    } catch { /* Offline or no storage: the page stays and says what it can. */ }
}
