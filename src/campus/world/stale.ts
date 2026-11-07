// Each deployment replaces the versioned data, so a page opened before it finds its files gone.
// That is not an error to show: the page is old. Load the current one, once per release.
import { DATA_RELEASE } from '@/world/config';

export async function reloadIfGone(): Promise<void> {
    const key = `studev_left_behind_${DATA_RELEASE.version}`;
    try {
        if (sessionStorage.getItem(key)) return;
        const probe = await fetch(`${DATA_RELEASE.base}/search/manifest.json`, { cache: 'no-store' });
        if (probe.status !== 404) return;
        sessionStorage.setItem(key, '1');
        location.reload();
    } catch { /* Offline or no storage: the page stays and says what it can. */ }
}
