import { describe, expect, it } from 'vitest';
import golden from './golden.json';
import { courseIdentity, courseTones, timelineTones } from '@/timetable/model/courseColors';
import { attendingLabs, personalLabs } from '@/timetable/model/labs';
import { offWeekLessons } from '@/timetable/model/weekPattern';
import { attendingExams } from '@/timetable/model/examAttendance';
import { clusters, eventsOn, holidayMap, lastLesson, layers, nextEvent, overlapping, planRuns, runTally, weekShown, type EventKind, type Timeline } from '@/world/events';
import { courseName, courseShort, roomLabel } from '@/world/names';
import { makeRoomReader } from '@/world/rooms';
import type { CalendarTerm, MorningRun } from '@/world/data';
import type { Exam, Lab, RoomDay, TeachingMeeting, TeachingPeriod, TeachingTerm } from '../facts';

const holidays = holidayMap(golden.calendar as CalendarTerm[]);
const line: Timeline = { term: golden.term as TeachingTerm, periods: golden.periods as TeachingPeriod[], meetings: golden.schedules[0]!.meetings as unknown as TeachingMeeting[], labs: [], exams: [], holidays, run: { rule: golden.run as unknown as MorningRun, days: golden.runDays as string[], adjust: 5 } };
const brief = (event: ReturnType<typeof eventsOn>[number]) => ({ kind: event.kind, name: event.name, short: event.short, start: event.start, end: event.end, room: event.room });

describe('the shared web / Android real-data contract', () => {
    for (const schedule of golden.schedules) for (const { week, cells } of schedule.weeks) {
        it(`${schedule.class}, week ${week}: the same lessons off this week, greyed in place`, () => {
            const meetings = schedule.meetings as unknown as TeachingMeeting[];
            expect(offWeekLessons(meetings, week, courseTones(meetings))).toEqual(cells);
        });
    }
    it('has real lessons off their week to show', () => expect(golden.schedules.some(s => s.weeks.some(w => w.cells.length > 0))).toBe(true));
    for (const day of golden.days) it(`events on ${day.date}: lessons, holidays and 早锻炼 on one line`, () => expect(eventsOn(line, day.date).map(brief)).toEqual(day.events));
    for (const test of golden.moments) it(`next event and 早锻炼 progress at ${test.now.date} ${test.now.min}`, () => {
        const next = nextEvent(line, test.now);
        expect(next && brief(next)).toEqual(test.next);
        expect(runTally(line.run!, test.now)).toEqual(test.run);
        expect(planRuns(line.run!, line, test.now)).toEqual(test.plan);
        expect(weekShown(line, test.now)).toBe(test.week);
    });
    it('ends the term\'s teaching on the same day', () => expect(lastLesson(line)).toBe(golden.lastLesson));
    it('reads every sampled room at every sampled moment the same way', () => {
        const read = makeRoomReader(golden.periods as TeachingPeriod[]);
        for (const test of golden.rooms.cases) {
            const state = read(golden.rooms.days.find(day => day.date === test.date) as unknown as RoomDay, test.room, test.min);
            expect({ tier: state.tier, busy: state.busy, until: state.until, minutes: state.minutes }).toEqual({ tier: test.tier, busy: test.busy, until: test.until, minutes: test.minutes });
        }
    });
    it('uses the same identities, names and attendance policy', () => {
        for (const test of golden.edgeCases.colours) expect(courseIdentity(test)).toBe(test.identity);
        for (const test of golden.tones) expect(Object.fromEntries(courseTones(golden.schedules.find(schedule => schedule.class === test.class)!.meetings))).toEqual(test.tones);
        for (const test of golden.edgeCases.names) expect({ course: courseName(test.value), short: courseShort(test.value), room: roomLabel(test.value) }).toEqual({ course: test.course, short: test.short, room: test.room });
        for (const test of golden.edgeCases.examAttendance) expect(attendingExams(golden.edgeCases.attendanceExams as Exam[], test.choices as Record<string, boolean>, test.ownCodes && new Set(test.ownCodes)).map(exam => exam.id)).toEqual(test.expected);
    });
    it('places labs among lessons and exams, and keeps a person\'s own', () => {
        const labs = golden.labs;
        const meetings = labs.meetings as unknown as TeachingMeeting[];
        const classLabs = labs.labs as unknown as Lab[];
        const labLine: Timeline = { term: golden.term as TeachingTerm, periods: golden.periods as TeachingPeriod[], meetings, labs: classLabs, exams: [labs.exam as unknown as Exam], holidays, run: null };
        const brief = (event: ReturnType<typeof eventsOn>[number]) => ({ kind: event.kind, name: event.name, short: event.short, start: event.start, end: event.end, room: event.room, id: event.id, lab: event.lab?.id ?? null });
        const orders: (readonly EventKind[])[] = [['exam', 'lab', 'class', 'run'], ['class', 'run', 'exam', 'lab']];
        for (const day of labs.days) {
            const events = eventsOn(labLine, day.date);
            expect(events.map(brief)).toEqual(day.events);
            expect(events.map(event => overlapping(labLine, event).map(other => other.id))).toEqual(day.alongside);
            expect(orders.map(order => layers(events, order).map(item => ({ id: item.event.id, under: item.under, over: item.over })))).toEqual(day.layers);
            expect(orders.map(order => clusters(events, order).map(run => ({ front: run.front.id, events: run.events.map(event => event.id), start: run.start, end: run.end })))).toEqual(day.clusters);
        }
        // Two labs at once, and a lab over part of a lecture: both stand, neither is called off.
        expect(labs.days.some(day => day.layers[0]!.some(item => item.under > 0 && item.over === 0))).toBe(true);
        expect(eventsOn({ ...labLine, labs: [labs.dayOff.lab as unknown as Lab], exams: [] }, labs.dayOff.lab.date).map(brief)).toEqual(labs.dayOff.events);
        for (const test of labs.moments) { const next = nextEvent(labLine, test.now); expect(next ? brief(next) : null).toEqual(test.next); }
        expect(Object.fromEntries(timelineTones(labLine))).toEqual(labs.tones);
        expect(lastLesson(labLine)).toBe(labs.last);
        for (const test of labs.choices) expect(attendingLabs(classLabs, test.choices).map(lab => lab.id)).toEqual(test.expected);
        for (const test of labs.personal) expect(personalLabs(classLabs, meetings, meetings.filter(meeting => test.kept.includes(meeting.id)), test.added as unknown as TeachingMeeting[], test.all as unknown as Lab[]).map(lab => lab.id)).toEqual(test.expected);
    });
});
