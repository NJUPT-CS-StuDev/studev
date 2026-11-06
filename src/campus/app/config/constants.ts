import release from '../../../data/campus-release.json';
import { PRODUCT_CONFIG } from './product';

/** Everything under data/<release>/ is written by scripts/data/digest.ts and never changes once served. */
export const DATA_RELEASE = release;

export const APP_CONFIG = {
    ...PRODUCT_CONFIG,
    PAGE_TITLE: '校园查询',
    DATA_URLS: {
        SEARCH: `${release.base}/search`,
        TIMETABLE: `${release.base}/teaching/${release.teaching}`,
    COURSE_PLANS: `${release.base}/entities/information.json`,
    TEACHING_CLASSES: `${release.base}/entities/agent.json`,
        EXAMS: `${release.base}/exams/${release.exams}`,
        CLASSROOMS: `${release.base}/rooms`,
    },
    
    
    
};
