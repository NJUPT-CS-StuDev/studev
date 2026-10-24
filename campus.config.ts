// How studev digests NJUPT campus data. Acquisition and the meaning of the
// data belong to campus-data; what the site builds from it is decided here.
import type { Profile } from 'wasm-search';

export const campusConfig = {
    /** The campus-data repository whose latest release is digested. */
    dataRepository: '<data-repository>',

    search: {
        /** Query knowledge shipped inside the search bundle. */
        profile: {
            aliases: [
                { terms: ['大创'], phrases: ['大学生创新创业训练计划', '大学生创新训练计划'], prefer_sources: ['cxcy', 'jwc'] },
                {
                    terms: ['四六级', '四、六级'],
                    phrases: ['全国大学英语四六级考试', '全国大学英语四六级口语考试', '全国大学英语四、六级考试',
                        '大学英语四六级考试', '大学英语四六级口语考试', '大学英语四、六级考试', '四六级考试', 'cet-4', 'cet-6'],
                    prefer_sources: ['jwc'],
                },
                {
                    terms: ['计算机等级', '计算机等级考试'],
                    phrases: ['全国计算机等级考试', '江苏省高等学校计算机等级考试', '计算机等级考试'],
                    prefer_sources: ['jwc'],
                },
            ],
        } satisfies Profile,
        /** Category of a page, decided by the first rule whose words appear in its title, section or tags. */
        categories: [
            { id: 'exam', words: ['考试', '补考', '重修', '考场', '准考证', '考务', 'mooc'] },
            { id: 'policy', words: ['规定', '制度', '办法', '条例', '政策'] },
            { id: 'workflow', words: ['流程', '办理', '申请', '指南'] },
            { id: 'news', words: ['新闻', '快讯', '动态'] },
        ],
        defaultCategory: 'notice_article',
        fileCategory: 'download',
        linkCategory: 'external',
    },

    classrooms: {
        /** Room kinds that count as bookable classrooms in the free-room finder. */
        eligibleKinds: ['多媒体', '非多媒体', '翻转课堂', '考场'],
    },
} as const;
