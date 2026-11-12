import product from '../../../product.json';

export const PRODUCT_CONFIG = {
    APP_NAME: product.name,
    /** Who StuDev is: the centre's own site and club platform, and the digital campus it makes for everyone. */
    ORGANIZATION: product.organization,
    POSITIONING: product.positioning,
    /** Both identities in one breath, short enough for the three lines a WeChat card shows. */
    SUMMARY: product.summary,
    TIME_ZONE: product.timeZone,
    CAMPUS: product.campus,
    ORIGIN: product.origin,
    GITHUB_REPO: `https://github.com/${product.repository}`,
    /**
     * The filings: the site's ICP and police numbers sit at the foot of every page; the Android app's own ICP
     * number is shown inside the app and where it is downloaded. The app's filing names its package and signing key.
     */
    FILINGS: {
        ICP: { TEXT: product.filings.icp, URL: 'https://beian.miit.gov.cn/' },
        APP: { TEXT: product.filings.app, URL: 'https://beian.miit.gov.cn/' },
        POLICE: { TEXT: product.filings.police.number, URL: `https://beian.mps.gov.cn/#/query/webSearch?code=${product.filings.police.code}` },
    },
    ANDROID_APP: {
        VERSION: product.android.versionName,
        DOWNLOAD_URL: '/download/',
        SUMMARY: '课表、地图和搜索，桌面小组件，离线可用。',
        BACKUP_URL: `https://dl.hicancan.top/studev-${product.android.versionName}.apk`,
        RELEASES_URL: `https://github.com/${product.repository}/releases/latest`,
    },
    /** 招新模块展示开关：招新期设为 true 首页展示入群及二维码，招新结束后设为 false 撤回 */
    SHOW_RECRUITMENT: false,
} as const;


/**
 * The three ways anyone adds to the campus: a word on how it works, a photo of a place, and what the teaching office
 * does not publish. Each is a public form on the platform, answered once signed in. `fill` sets answers by field id,
 * as an entry knows them: the place one came from, where one was when writing.
 */
export type FormKind = keyof typeof product.forms;
export const formLink = (kind: FormKind, fill: Record<string, string> = {}) =>
    `/fill/?${new URLSearchParams({ id: product.forms[kind], ...Object.fromEntries(Object.entries(fill).map(([field, value]) => [`a.${field}`, value])) })}`;
