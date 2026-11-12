import type { CampusEvent } from './events';
import { labCourseKey } from '@/timetable/model/labs';

export type Avoidance = 'must' | 'prefer' | 'allow';
export interface EventPreference { avoid?: Avoidance; layer?: number }
export type EventPreferences = Record<string, EventPreference>;
export const AVOIDANCE: { value: Avoidance; name: string }[] = [
    { value: 'must', name: '必须避开' }, { value: 'prefer', name: '尽量避开' }, { value: 'allow', name: '允许重叠' },
];
/** A course rule and a sitting rule are separate. Task ids persist when a task is moved. */
export function preferenceKey(event: CampusEvent, term: string, series = false): string {
    if (event.task) return `task:${event.id}`;
    let id = event.id;
    if (series) {
        const course = event.meeting?.course ?? event.lab?.course ?? event.exam?.course;
        id = event.lab ? labCourseKey(event.lab) : course?.code?.trim().toUpperCase() || event.meeting?.teaching_class.id || course?.name.trim() || event.kind;
    }
    return `${term}:${event.kind}:${series ? 'course:' : ''}${id}`;
}
export const defaultAvoidance = (event: CampusEvent): Avoidance => event.task?.done ? 'allow' : event.kind === 'exam' || event.kind === 'task' ? 'must' : 'prefer';
export function eventPreference(event: CampusEvent, term: string, preferences: EventPreferences = {}): Required<EventPreference> {
    const own = { ...preferences[preferenceKey(event, term, true)], ...preferences[preferenceKey(event, term)] };
    return { avoid: own.avoid ?? defaultAvoidance(event), layer: own.layer ?? 0 };
}
