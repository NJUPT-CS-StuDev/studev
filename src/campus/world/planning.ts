import { eventsOn, type Timeline } from './events';
import { addDays, type Moment } from './time';
import type { Task } from './tasks';

export interface SlotRequest { from: string; to: string; minutes: number; earliest?: number; latest?: number; exclude?: string; due?: Task['due'] }
export interface TimeSlot { date: string; start: number; end: number; clashes: string[]; penalty: number }
/** Scheduling reads attendance and attitude, never visual layers. Soft conflicts are ranked after free time. */
export function availableSlots(line: Timeline, request: SlotRequest, now: Moment): TimeSlot[] {
    if (!Number.isInteger(request.minutes) || request.minutes < 1 || request.minutes > 840 || request.from > request.to) return [];
    const out: TimeSlot[] = [];
    for (let date = request.from, days = 0; date <= request.to && days < 60; date = addDays(date, 1), days++) {
        if (date < now.date || (request.due && date > request.due.date)) continue;
        const earliest = Math.max(request.earliest ?? 480, date === now.date ? now.min : 0);
        const latest = Math.min(request.latest ?? 1320, request.due?.date === date ? request.due.time ?? 1440 : 1440);
        const events = eventsOn(line, date).filter(event => event.id !== request.exclude && !event.task?.done);
        const starts = new Set(events.map(event => event.end));
        starts.add(earliest);
        for (let min = Math.ceil(earliest / 15) * 15; min + request.minutes <= latest; min += 15) starts.add(min);
        for (const start of starts) {
            const end = start + request.minutes;
            if (start < earliest || end > latest) continue;
            const clashes = events.filter(event => event.start < end && start < event.end);
            if (clashes.some(event => event.avoid === 'must')) continue;
            const soft = clashes.filter(event => event.avoid !== 'allow');
            out.push({ date, start, end, clashes: soft.map(event => event.id).sort(), penalty: soft.reduce((sum, event) => sum + Math.min(end, event.end) - Math.max(start, event.start), 0) });
        }
    }
    return out.sort((a, b) => a.penalty - b.penalty || a.date.localeCompare(b.date) || a.start - b.start);
}
