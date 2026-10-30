import release from '../../../data/campus-release.json';
import { PRODUCT_CONFIG } from './product';

/** Everything under data/<release>/ is written by scripts/digest.ts and never changes once served. */
export const DATA_RELEASE = release;

export const APP_CONFIG = {
    ...PRODUCT_CONFIG,
    PAGE_TITLE: '校园查询',
    DATA_URLS: {
        SEARCH: `${release.base}/search`,
        TIMETABLE: `${release.base}/teaching/${release.teaching}`,
        EXAMS: `${release.base}/exams/${release.exams}`,
        CLASSROOMS: `${release.base}/rooms`,
    },
    MAX_CLASS_DISPLAY_COUNT: 50,
    SEARCH_RESULT_LIMIT: 10,
    SEARCH_RESULT_MAX: 1000,
};
