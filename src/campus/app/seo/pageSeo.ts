import type { AppRoute } from '@/app/routing/useUrlState';

export interface PageIdentity {
    title: string;
    description: string;
}

export const PAGE_IDENTITIES: Record<AppRoute, PageIdentity> = {
    home: {
        title: '校园查询',
        description: '搜索南邮校方信息、校园经验和课程资料，查询班级课表、考试安排与空闲教室。',
    },
    search: {
        title: '南邮网站搜索',
        description: '搜索南京邮电大学各网站的通知、附件和办事信息。',
    },
    community: {
        title: '南邮社区搜索',
        description: '搜索南邮生存手册中的校园生活、学习经验和办事指南。',
    },
    materials: {
        title: '南邮资料搜索',
        description: '搜索南京邮电大学课程资料、历年试卷、课件和复习笔记。',
    },
    exam: {
        title: '考试安排查询',
        description: '输入班级号，查询南京邮电大学考试时间、地点和考场，并可导出日历。',
    },
    timetable: {
        title: '班级课表查询',
        description: '输入班级号，按周查看南京邮电大学课程时间、教师和教室，并可导出日历。',
    },
    classrooms: {
        title: '空闲教室查询',
        description: '按校区、楼栋和楼层查找南京邮电大学空闲教室，并查看所选时段的课程与考试占用。',
    },
};
