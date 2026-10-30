import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TeachingMeeting, TeachingPeriod, TeachingWeek } from '@/academics/timetable';
import { TimetableGrid } from './TimetableGrid';
const createMeeting = (meetingId: string, courseCode: string, courseName: string): TeachingMeeting => ({
    course: {
        code: courseCode,
        name: courseName,
        category: null,
        nature: null,
        credits: null,
        hours: null,
        hours_composition: null,
        assessment: null,
        exam: null
    },
    teaching_class: {
        id: meetingId,
        name: meetingId,
        size: null,
        enrolled: null,
        capacity: null
    },
    teachers: [],
    periods: [6, 7],
    id: meetingId,
    campus: '仙林',
    room: null,
    location: meetingId === 'lecture' ? '教3-409' : '教4-211(5)',
    weekday: 1,
    weeks: [1],
    method: null,
    classes: ['B250105']
});
const week: TeachingWeek = { week: 1, start: '2026-08-31', end: '2026-09-06' };
const periods: TeachingPeriod[] = [
    { period: 6, start: '13:45', end: '14:30', part: '下午' },
    { period: 7, start: '14:35', end: '15:20', part: '下午' },
];
const renderGrid = (meetings: TeachingMeeting[]) => renderToStaticMarkup(<TimetableGrid meetings={meetings} week={week} periods={periods} tones={new Map(meetings.map(meeting => [meeting.course.code ?? meeting.course.name, 0]))} onOpen={() => undefined}/>);
describe('TimetableGrid overlap copy', () => {
    it('labels simultaneous instances of one course as parallel arrangements', () => {
        const html = renderGrid([
            createMeeting('lecture', 'TX100011S', '信号与系统（混合式）'),
            createMeeting('flipped', 'TX100011S', '信号与系统（混合式）'),
        ]);
        expect(html).toContain('并行 2 项');
        expect(html).toContain('同一课程共有2项并行安排');
        expect(html).not.toMatch(/\u51b2\u7a81/u);
    });
    it('labels different courses in the same periods as a time overlap', () => {
        const html = renderGrid([
            createMeeting('lecture', 'TX100011S', '信号与系统（混合式）'),
            createMeeting('network', 'JS1111X0S', '网络技术与应用（混合式）'),
        ]);
        expect(html).toContain('重叠 2 项');
        expect(html).toContain('共有2项时间重叠安排');
        expect(html).not.toMatch(/\u51b2\u7a81/u);
    });
});
