import product from '../../../product.json';

export const PRODUCT_CONFIG = {
    APP_NAME: product.name,
    TIME_ZONE: product.timeZone,
    CAMPUS: product.campus,
    ORIGIN: product.origin,
    GITHUB_REPO: `https://github.com/${product.repository}`,
    ANDROID_APP: {
        VERSION: product.android.versionName,
        DOWNLOAD_URL: '/download/',
        SUMMARY: '课表、地图和搜索，桌面小组件，离线可用。',
        FILE_URL: '/api/apk',
        BACKUP_URL: `https://dl.hicancan.top/studev-${product.android.versionName}.apk`,
        RELEASES_URL: `https://github.com/${product.repository}/releases/latest`,
    },
    /** 招新模块展示开关：招新期设为 true 首页展示入群及二维码，招新结束后设为 false 撤回 */
    SHOW_RECRUITMENT: false,
} as const;

