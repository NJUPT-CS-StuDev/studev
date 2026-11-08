import { describe, expect, it } from 'vitest';
import golden from './golden.json';
import { timetableCells } from '@/timetable/model/presentation';
import { courseIdentity, courseTones } from '@/timetable/model/courseColors';
import { attendingExams } from '@/timetable/model/examAttendance';
import { eventsOn, holidayMap, lastLesson, nextEvent, planRuns, runTally, weekShown, type Timeline } from '@/world/events';
import { courseName, courseShort, roomLabel } from '@/world/names';
import { makeRoomReader } from '@/world/rooms';
import type { CalendarTerm, MorningRun } from '@/world/data';
import type { Exam, RoomDay, TeachingMeeting, TeachingPeriod, TeachingTerm } from '../facts';

const holidays = holidayMap(golden.calendar as CalendarTerm[]);
const line: Timeline = { term: golden.term as TeachingTerm, periods: golden.periods as TeachingPeriod[], meetings: golden.schedules[0]!.meetings as unknown as TeachingMeeting[], exams: [], holidays, run: { rule: golden.run as unknown as MorningRun, days: golden.runDays as string[], adjust: 5 } };
const brief = (event: ReturnType<typeof eventsOn>[number]) => ({ kind: event.kind, name: event.name, short: event.short, start: event.start, end: event.end, room: event.room });

describe('the shared web / Android real-data contract', () => {
    for (const schedule of golden.schedules) for (const { week, cells } of schedule.weeks) {
        it(`${schedule.class}, week ${week}: every cell has the same state, room, note, colour and column`, () => {
            expect(timetableCells(schedule.meetings as unknown as TeachingMeeting[], week)).toEqual(cells);
        });
    }
    it('covers real suspension, inactive parity and parallel examples', () => {
        const cells = golden.schedules.flatMap(s => s.weeks.flatMap(w => w.cells));
        for (const state of ['active', 'off']) expect(cells.some(c => c.state === state)).toBe(true);
        expect(cells.some(c => c.columns > 1)).toBe(true);
    });
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
});
