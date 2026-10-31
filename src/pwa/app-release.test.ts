import { describe, expect, it } from 'vitest';
import { PRODUCT_CONFIG } from '../campus/app/config/product';

describe('Android download entry', () => {
    it('uses the site manifest as the only update source', () => {
        expect(PRODUCT_CONFIG.ANDROID_APP.APK_URL).toBe('/download/latest.json');
    });
});
