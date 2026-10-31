import product from '../../../../product.json';

export const PRODUCT_CONFIG = {
    APP_NAME: product.name,
    TIME_ZONE: product.timeZone,
    CAMPUS: product.campus,
    ORIGIN: product.origin,
    GITHUB_REPO: `https://github.com/${product.repository}`,
    VISITOR_BADGE_URL:
        'https://visitor-badge.laobi.icu/badge?page_id=njupt.hicancan.top&left_text=%20%E8%AE%BF%E9%97%AE%E9%87%8F%20&left_color=%23174ea6&right_color=%231a73e8&radius=10',
    ANDROID_APP: {
        VERSION: product.android.versionName,
        DOWNLOAD_URL: '/download/',
        SUMMARY: '校园地图与步行导航，课表、考试、空教室，桌面小部件，离线可用。',
    },
    /** 招新模块展示开关：招新期设为 true 首页展示入群及二维码，招新结束后设为 false 撤回 */
    SHOW_RECRUITMENT: false,
} as const;

