import { describe, expect, it } from 'vitest';
import golden from './parity/golden.json';
import type { Lab, TeachingMeeting, TeachingPeriod, TeachingTerm } from './facts';
import { eventsOn, dueOn, holidayMap, layers, timeBounds, type Timeline } from './events';
import { attendingLabs, labCourseKey, migrateLabChoices, personalLabs } from '@/timetable/model/labs';
import { courseIdentity } from '@/timetable/model/courseColors';
import { availableSlots } from './planning';
import { preferenceKey } from './schedule';
import { migrateTaskTimes, parseQuickTask, reminderAt, type Task } from './tasks';
import { calendarFile, taskEntries } from '@/timetable/model/calendar';
import type { CalendarTerm } from './data';

const meetings = golden.labs.meetings as unknown as TeachingMeeting[];
const labs = golden.labs.labs as unknown as Lab[];
const line: Timeline = { term: golden.term as TeachingTerm, periods: golden.periods as TeachingPeriod[], meetings, labs, exams: [], holidays: holidayMap(golden.calendar as CalendarTerm[]), run: null, tasks: [] };

describe('independent attendance, deadlines and planning', () => {
    it('keeps all three Linux labs when the theory class is hidden, and still permits an independent skip', () => {
        const linux = labs.filter(lab => /linux/i.test(lab.course.name));
        expect(linux).toHaveLength(3);
        const kept = meetings.filter(meeting => !/linux/i.test(meeting.course.name));
        const personal = personalLabs(labs, [], []);
        expect(personal.filter(lab => linux.some(other => other.id === lab.id))).toHaveLength(3);
        expect(eventsOn({ ...line, meetings: kept, labs: personal }, linux[0]!.date).some(event => event.meeting && /linux/i.test(event.meeting.course.name))).toBe(false);
        expect(attendingLabs(personal, { skip: [linux[0]!.id] }).filter(lab => /linux/i.test(lab.course.name))).toHaveLength(2);
        expect(attendingLabs(personal, { drop: [labCourseKey(linux[0]!)] }).filter(lab => /linux/i.test(lab.course.name))).toHaveLength(0);
        expect(migrateLabChoices(labs, { drop: [courseIdentity(linux[0]!)] }).drop).toEqual([labCourseKey(linux[0]!)]);
    });
    it('moves execution without moving the deadline, and emits a separate transparent calendar marker', () => {
        const task: Task = { id: 'report', title: '写报告', date: '2026-11-11', start: 840, end: 900, due: { date: '2026-11-13', time: 1439, remind: [60] }, modified: 'm' };
        const moved = migrateTaskTimes({ ...task, date: '2026-11-12', start: 600, end: 660 });
        expect(moved.due).toEqual(task.due);
        const personal = { ...line, tasks: [moved] };
        expect(eventsOn(personal, '2026-11-12').find(event => event.task)?.start).toBe(600);
        expect(eventsOn(personal, '2026-11-13').some(event => event.task)).toBe(false);
        expect(dueOn(personal, '2026-11-13').map(task => task.id)).toEqual(['report']);
        expect(reminderAt(moved, 60, 'due')).toEqual({ date: '2026-11-13', min: 1379 });
        const file = calendarFile('任务', taskEntries(personal), new Date('2026-11-12T00:00:00Z'));
        expect(file.match(/BEGIN:VEVENT/g)).toHaveLength(2);
        expect(file).toContain('TRANSP:TRANSPARENT');
        expect(file).toContain('SUMMARY:截止 · 写报告');
    });
    it('migrates the old date-only deadline once while preserving the reminder and modification stamp', () => {
        const old: Task = { id: 'old', title: '交作业', date: '2026-11-13', remind: [480], modified: 'm' };
        const migrated = migrateTaskTimes(old);
        expect(migrated).toEqual({ id: 'old', title: '交作业', due: { date: '2026-11-13', remind: [480] }, modified: 'm' });
        expect(migrateTaskTimes(migrated)).toBe(migrated);
        expect(parseQuickTask('周五23:59前交报告', { date: '2026-11-12', min: 600 })).toEqual({ title: '交报告', due: { date: '2026-11-13', time: 1439 } });
    });
    it('blocks must-avoid, penalizes prefer-avoid and permits allowed overlap on the real two-lab morning', () => {
        const date = '2026-11-09', now = { date, min: 480 };
        const events = eventsOn(line, date);
        expect(events.filter(event => event.lab && event.start === 590)).toHaveLength(2);
        const request = { from: date, to: date, earliest: 590, latest: 685, minutes: 30 };
        const slots = (avoid: 'must' | 'prefer' | 'allow') => availableSlots({ ...line, preferences: Object.fromEntries(events.map(event => [preferenceKey(event, line.term.term), { avoid }])) }, request, now);
        expect(slots('must')).toEqual([]);
        expect(slots('prefer')[0]!.penalty).toBeGreaterThan(0);
        expect(slots('allow')[0]!.penalty).toBe(0);
    });
    it('changes only the picture when a single lab is brought to front', () => {
        const date = '2026-11-09', events = eventsOn(line, date), lab = events.find(event => event.lab && event.start === 590)!;
        const visual = { ...line, preferences: { [preferenceKey(lab, line.term.term)]: { layer: 99 } } };
        expect(eventsOn(visual, date).map(event => event.id).sort()).toEqual(events.map(event => event.id).sort());
        expect(layers(eventsOn(visual, date)).at(-1)!.event.id).toBe(lab.id);
        const request = { from: date, to: date, earliest: 590, latest: 685, minutes: 30 };
        expect(availableSlots(visual, request, { date, min: 480 })).toEqual(availableSlots(line, request, { date, min: 480 }));
    });
    it('preserves a personal alias including brackets without changing lab identity or attendance', () => {
        const meeting = meetings.find(meeting => /linux/i.test(meeting.course.name))!;
        const lab = labs.find(lab => /linux/i.test(lab.course.name))!;
        const named = { ...line, names: { [courseIdentity(meeting)]: 'Linux（王老师）' } };
        const event = eventsOn(named, lab.date).find(event => event.id === lab.id)!;
        expect(event.name).toBe('Linux（王老师）');
        expect(event.lab!.course.name).toBe(lab.course.name);
        expect(labCourseKey(event.lab!)).toBe(labCourseKey(lab));
        const hidden = { ...named, courseMeetings: meetings, meetings: meetings.filter(item => courseIdentity(item) !== courseIdentity(meeting)) };
        expect(eventsOn(hidden, lab.date).find(event => event.id === lab.id)!.name).toBe('Linux（王老师）');
    });
    it('keeps midnight and late-night work inside the week frame', () => {
        const personal = { ...line, tasks: [
            { id: 'early', title: '早起', date: '2026-11-13', start: 0, end: 30, modified: 'm' },
            { id: 'late', title: '晚间复习', date: '2026-11-13', start: 1410, modified: 'm' },
        ] };
        const events = eventsOn(personal, '2026-11-13');
        expect(timeBounds(events)).toEqual([0, 1440]);
        expect(events.filter(event => event.task).every(event => event.start >= timeBounds(events)[0] && event.end <= timeBounds(events)[1])).toBe(true);
    });
});
