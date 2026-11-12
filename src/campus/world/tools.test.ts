import { describe, expect, it } from 'vitest';
import golden from './parity/golden.json';
import { holidayMap, type Timeline } from './events';
import { readTimeline, schedulingTool, taskProposal, toolArguments } from './tools';
import type { TeachingMeeting, Lab, TeachingPeriod, TeachingTerm } from './facts';
import type { CalendarTerm } from './data';

const line: Timeline = { term: golden.term as TeachingTerm, periods: golden.periods as TeachingPeriod[], meetings: golden.labs.meetings as unknown as TeachingMeeting[], labs: golden.labs.labs as unknown as Lab[], exams: [], holidays: holidayMap(golden.calendar as CalendarTerm[]), tasks: [{ id: 'report', title: '报告', date: '2026-11-09', start: 600, end: 660, due: { date: '2026-11-13', time: 1439, remind: [60] }, modified: 'm' }], run: null };
describe('tools over released facts and local choices', () => {
    it('keeps coincident labs and separates a planned task from its deadline', () => {
        const days = readTimeline(line, '2026-11-09', '2026-11-13');
        expect(days[0]!.events.filter(event => event.kind === 'lab' && event.start === 590)).toHaveLength(2);
        expect(days[0]!.events.find(event => event.id === 'report')!.start).toBe(600);
        expect(days.at(-1)!.due[0]!.id).toBe('report');
    });
    it('only proposes a move, retaining independent deadline and reminders', () => {
        const before = JSON.stringify(line.tasks), proposal = taskProposal(toolArguments('propose_task', { id: 'report', title: '报告', date: '2026-11-12', start: 1410, end: 1440 }), line);
        expect(JSON.stringify(line.tasks)).toBe(before);
        expect(proposal).toMatchObject({ id: 'report', expected: 'm', task: { date: '2026-11-12', start: 1410, end: 1440, due: line.tasks[0]!.due } });
        expect(() => taskProposal({ id: 'invented', title: 'x' }, line)).toThrow();
        expect(() => taskProposal({ title: 'x', date: '2026-11-12' }, line)).toThrow();
        expect(taskProposal({ title: '新任务', due_date: '2026-11-13' }, line)).toEqual({ task: { title: '新任务', due: { date: '2026-11-13' } } });
    });
    it('validates model arguments and uses actual planning rules', () => {
        for (const args of [{ from: '2026-11-09', to: '2026-11-09', minutes: -1 }, { from: '2026-11-09', to: '2026-11-09', minutes: 60, deleteAll: true }]) expect(() => toolArguments('suggest_slots', args)).toThrow();
        expect(() => readTimeline(line, '2026-02-30', '2026-03-01')).toThrow();
        expect(() => readTimeline(line, '2026-11-09', '2026-12-30')).toThrow();
        const slots = schedulingTool(line, { from: '2026-11-09', to: '2026-11-09', minutes: 60, task_id: 'report' }, { date: '2026-11-09', min: 480 });
        expect(slots.length).toBeGreaterThan(0);
        expect(slots.every(slot => !slot.clashes.includes('report'))).toBe(true);
    });
});
