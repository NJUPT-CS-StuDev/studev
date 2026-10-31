export const PRODUCT_CONFIG = {
    APP_NAME: 'studev',
    GITHUB_REPO: 'https://github.com/NJUPT-CS-StuDev/studev',
    VISITOR_BADGE_URL:
        'https://visitor-badge.laobi.icu/badge?page_id=njupt.hicancan.top&left_text=%20%E8%AE%BF%E9%97%AE%E9%87%8F%20&left_color=%23174ea6&right_color=%231a73e8&radius=10',
    /** Android 应用：VERSION 与 android/app/build.gradle.kts 的 versionName 一致（由测试校验）。 */
    ANDROID_APP: {
        VERSION: '1.0.1',
        APK_URL: '/download/latest.json',
        SUMMARY: '校园地图与步行导航，课表、考试、空教室，桌面小部件，离线可用。',
    },
    /** 招新模块展示开关：招新期设为 true 首页展示入群及二维码，招新结束后设为 false 撤回 */
    SHOW_RECRUITMENT: false,
} as const;

