import { describe, expect, it } from 'vitest';
import golden from './golden.json';
import { timetableCells } from '@/timetable/model/presentation';
import { courseHash, courseIdentity, courseToneIndex } from '@/timetable/model/courseColors';
import { attendingExams } from '@/timetable/model/examAttendance';
import { eventsOn, holidayMap, nextEvent, planRuns, runTally, type Timeline } from '@/world/events';
import { courseName, courseShort, roomLabel } from '@/world/names';
import { makeRoomReader } from '@/world/rooms';
import type { CalendarTerm, MorningRun } from '@/world/data';
import type { Exam, RoomDay, TeachingMeeting, TeachingPeriod, TeachingTerm } from '../facts';

const holidays = holidayMap(golden.calendar as CalendarTerm[]);
const line: Timeline = { term: golden.term as TeachingTerm, periods: golden.periods as TeachingPeriod[], meetings: golden.schedules[0]!.meetings as unknown as TeachingMeeting[], exams: [], holidays, run: { rule: golden.run as unknown as MorningRun, days: golden.runDays as Record<string, 'done' | 'plan'>, adjust: 5 } };
const brief = (event: ReturnType<typeof eventsOn>[number]) => ({ kind: event.kind, name: event.name, short: event.short, start: event.start, end: event.end, room: event.room });

describe('the shared web / Android real-data contract', () => {
    for (const schedule of golden.schedules) for (const { week, cells } of schedule.weeks) {
        it(`${schedule.class}, week ${week}: every cell has the same state, room, note, colour and column`, () => {
            expect(timetableCells(schedule.meetings as unknown as TeachingMeeting[], week)).toEqual(cells);
        });
    }
    it('covers real suspension, inactive parity and parallel examples', () => {
        const cells = golden.schedules.flatMap(s => s.weeks.flatMap(w => w.cells));
        for (const state of ['active', 'inactive', 'suspended']) expect(cells.some(c => c.state === state)).toBe(true);
        expect(cells.some(c => c.columns > 1)).toBe(true);
    });
    for (const day of golden.days) it(`events on ${day.date}: lessons, holidays and 早锻炼 on one line`, () => expect(eventsOn(line, day.date).map(brief)).toEqual(day.events));
    for (const test of golden.moments) it(`next event and 早锻炼 progress at ${test.now.date} ${test.now.min}`, () => {
        const next = nextEvent(line, test.now);
        expect(next && brief(next)).toEqual(test.next);
        expect(runTally(line.run!)).toEqual(test.run);
        expect(Object.keys(planRuns(line.run!, line, test.now)).sort()).toEqual(test.plan);
    });
    it('reads every sampled room at every sampled moment the same way', () => {
        const read = makeRoomReader(golden.periods as TeachingPeriod[]);
        for (const test of golden.rooms.cases) {
            const state = read(golden.rooms.days.find(day => day.date === test.date) as unknown as RoomDay, test.room, test.min);
            expect({ tier: state.tier, busy: state.busy, until: state.until, minutes: state.minutes }).toEqual({ tier: test.tier, busy: test.busy, until: test.until, minutes: test.minutes });
        }
    });
    it('hashes Unicode scalar values, including supplementary characters', () => expect(courseHash('😀课程')).toBe(2438769704));
    it('uses the same identities, names and attendance policy', () => {
        for (const test of golden.edgeCases.colours) { expect(courseIdentity(test)).toBe(test.identity); expect(courseToneIndex(test)).toBe(test.colourIndex); }
        for (const test of golden.edgeCases.names) expect({ course: courseName(test.value), short: courseShort(test.value), room: roomLabel(test.value) }).toEqual({ course: test.course, short: test.short, room: test.room });
        for (const test of golden.edgeCases.examAttendance) expect(attendingExams(golden.edgeCases.attendanceExams as Exam[], test.choices as Record<string, boolean>, test.ownCodes && new Set(test.ownCodes)).map(exam => exam.id)).toEqual(test.expected);
    });
});
