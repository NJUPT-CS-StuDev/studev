import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRODUCT_CONFIG } from '../campus/app/config/product';

describe('Android download entry', () => {
    it('advertises the version the app build declares and the release asset the app updater reads', () => {
        const gradle = readFileSync(new URL('../../android/app/build.gradle.kts', import.meta.url), 'utf8');
        expect(gradle).toContain(`versionName = "${PRODUCT_CONFIG.ANDROID_APP.VERSION}"`);
        expect(PRODUCT_CONFIG.ANDROID_APP.APK_URL).toBe('/download/latest.json');
        const updater = readFileSync(new URL('../../android/app/src/main/java/top/hicancan/studev/me/AppUpdates.kt', import.meta.url), 'utf8');
        expect(updater).toContain('PRIMARY_LATEST = "/download/latest.json"');
        expect(updater).toContain('MIRROR_LATEST');
    });
});
