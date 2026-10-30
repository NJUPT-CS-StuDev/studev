import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import golden from './golden.json';
import spec from './spec.json';
import { timetableCells } from '@/timetable/model/presentation';
import { courseHash, courseIdentity, courseToneIndex } from '@/timetable/model/courseColors';
import { toggleBuilding } from '@/classrooms/model/buildingSelection';
import { TimetableGrid } from '@/timetable/ui/TimetableGrid';
import { examPresentation } from '@/exams/model/presentation';
import { roomSelectionResult, type RoomSelection } from '@/classrooms/model/roomSelection';
import type { TeachingMeeting, TeachingWeek, TeachingPeriod, Exam, RoomDay } from '../facts';
import type { ClassroomIndexFile } from '@/classrooms/model/ClassroomAvailabilityClient';

describe('the shared web / Android real-data contract', () => {
    for (const schedule of golden.schedules) for (const {week,cells} of schedule.weeks) {
        it(`${schedule.class}, week ${week}: every cell and day has the same state, room, note, colour and column`, () => {
            const meetings = schedule.meetings as TeachingMeeting[];
            expect(timetableCells(meetings,week)).toEqual(cells);
            const props = {meetings,week:golden.term.weeks.find(w=>w.week===week)! as TeachingWeek, periods:golden.periods as TeachingPeriod[],tones:new Map<string,number>(),onOpen:()=>{}};
            const full = renderToStaticMarkup(<TimetableGrid {...props} />);
            expect((full.match(/data-meeting=/g) ?? []).length).toBe(cells.length);
            for (const cell of cells) expect(full).toContain(`data-meeting="${cell.id}" data-state="${cell.state}" data-colour="${cell.colourIndex}" data-slot="${cell.slot}"`);
            for (const day of spec.timetable.layout.days) {
                const html = renderToStaticMarkup(<TimetableGrid {...props} day={day} />);
                const expected = cells.filter(cell=>cell.day===day);
                expect((html.match(/data-meeting=/g) ?? []).length).toBe(expected.length);
                for (const cell of expected) expect(html).toContain(`data-meeting="${cell.id}"`);
            }
        });
    }
    it('includes the published Linux occurrence and real suspension, inactive parity, teaching note and parallel/overlap examples', () => {
        const cells = golden.schedules.flatMap(s=>s.weeks.flatMap(w=>w.cells));
        const week9 = golden.schedules[0]!.weeks.find(w=>w.week===9)!.cells;
        expect(week9).toContainEqual(expect.objectContaining({course:'Linux编程',day:3,periods:[8,9],state:'active'}));
        for (const state of ['active','inactive','suspended']) expect(cells.some(c=>c.state===state)).toBe(true);
        expect(cells.some(c=>c.note==='翻转课堂 · 线上自学')).toBe(true);
        expect(cells.some(c=>c.columns>1)).toBe(true);
        expect(cells.some(c=>c.overlap==='parallel')).toBe(true);
    });
    for (const group of golden.exams) for (const test of group.cases) {
        it(`${group.class}, exams at ${test.now}: Shanghai countdown and end boundaries`, () => {
            expect(group.exams.map(exam=>examPresentation(exam as Exam,new Date(test.now)))).toEqual(test.cells);
        });
    }
    for (const [i,test] of golden.rooms.cases.entries()) {
        it(`room selection ${i}: ${test.date} ${test.selection.campus}, exact matching/free IDs`, () => {
            const day = golden.rooms.days.find(day=>day.date===test.date)!;
            expect(roomSelectionResult(golden.rooms.index as ClassroomIndexFile,day as unknown as RoomDay,test.selection as RoomSelection)).toEqual(test.expected);
        });
    }
    it('hashes Unicode scalar values, including supplementary characters', () => {
        expect(courseHash('😀课程')).toBe(2438769704);
    });
    it('uses the same Unicode identity, hidden-building transitions and invalid-time policy', () => {
        for (const test of golden.edgeCases.colours) {
            expect(courseIdentity(test)).toBe(test.identity);
            expect(courseToneIndex(test)).toBe(test.colourIndex);
        }
        for (const test of golden.edgeCases.buildingTransitions) expect(toggleBuilding(test.selected,test.all,test.toggle)).toEqual(test.expected);
        for (const test of golden.edgeCases.invalidExams) expect(examPresentation(test.exam as Exam,new Date(test.now))).toEqual(test.expected);
    });
});
