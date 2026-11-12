// Everything the three entries read from one campus release, fetched once per page.
import type { Exam, ExamChange, ExamSource, Lab, Room, RoomDay, TeachingClass, TeachingMeeting, TeachingPeriod, TeachingTerm, TeachingWeek } from '@/world/facts';
import { DATA_RELEASE } from '@/world/config';
import { fetchJson } from '@/world/fetch';

const base = DATA_RELEASE.base;
const teaching = `${base}/teaching/${DATA_RELEASE.teaching}`;
const once = <T>(load: () => Promise<T>) => {
    let value: Promise<T> | null = null;
    return () => value ??= load().catch(error => { value = null; throw error; });
};

export interface CalendarTerm {
    number: number; start: string; end: string; weeks: number;
    break: { name: string; start: string; end: string } | null;
    holidays: { name: string; start: string; end: string }[];
    events: { name: string; start: string; end: string }[];
}
export interface MorningRun {
    required: number; start: string; end: string; time: [string, string];
    bonus: [number, number][]; fail_score: number | null; source: string;
    xianlin: { route: [string, string]; metres: number; male_minutes: number; female_minutes: number; start_scan_end: string | null; end_scan_end: string | null } | null;
    makeup?: { start: string | null; end: string | null; weeks: [number, number] | null; time: [string, string]; source: string };
}
export interface RoomIndex { term: string; weeks: TeachingWeek[]; periods: TeachingPeriod[]; rooms: Room[] }

export const loadTerm = once(() => fetchJson<TeachingTerm>(`${teaching}/term.json`));
export const loadPeriods = once(() => fetchJson<TeachingPeriod[]>(`${teaching}/periods.json`));
export const loadClasses = once(() => fetchJson<TeachingClass[]>(`${teaching}/classes.json`));
export const loadMeetings = once(() => fetchJson<TeachingMeeting[]>(`${teaching}/meetings.json`));
export const loadCalendar = once(async () => (await fetchJson<{ terms: CalendarTerm[] }>(`${base}/calendar.json`)).terms);
export const loadRuns = once(() => fetchJson<Record<string, MorningRun>>(`${base}/morning-run.json`));
export const loadRoomIndex = once(() => fetchJson<RoomIndex>(`${base}/rooms/index.json`));

const classFiles = new Map<string, Promise<TeachingMeeting[]>>();
export const loadClassMeetings = (id: string) => {
    let file = classFiles.get(id);
    if (!file) classFiles.set(id, file = fetchJson<{ meetings: TeachingMeeting[] }>(`${teaching}/classes/${encodeURIComponent(id)}.json`).then(value => value.meetings));
    return file;
};

/** A class's exams; a class with none has no file. */
export const loadExams = once(() => DATA_RELEASE.exams ? fetchJson<Exam[]>(`${base}/exams/${DATA_RELEASE.exams}/exams.json`) : Promise.resolve([] as Exam[]));
/**
 * How a class's exams came to be what they are: every change seen, the sheets they were read from,
 * and when the teaching office's site was last looked at, published or not.
 */
export interface ExamRecord { changes: ExamChange[]; sources: ExamSource[]; checked: string | null }
const examIndex = once(() => DATA_RELEASE.exams ? fetchJson<{ classes: string[]; sources: ExamSource[]; checked: string | null }>(`${base}/exams/${DATA_RELEASE.exams}/index.json`) : Promise.resolve({ classes: [] as string[], sources: [] as ExamSource[], checked: null as string | null }));
export const loadExamRecord = async (id: string): Promise<ExamRecord> => {
    const { classes, sources, checked } = await examIndex();
    if (!classes.includes(id)) return { changes: [], sources, checked };
    return { changes: (await fetchJson<{ changes: ExamChange[] }>(`${base}/exams/${DATA_RELEASE.exams}/classes/${encodeURIComponent(id)}.json`)).changes, sources, checked };
};
export const loadClassExams = async (id: string): Promise<Exam[]> => {
    if (!DATA_RELEASE.exams) return [];
    const { classes } = await examIndex();
    if (!classes.includes(id)) return [];
    return (await fetchJson<{ exams: Exam[] }>(`${base}/exams/${DATA_RELEASE.exams}/classes/${encodeURIComponent(id)}.json`)).exams;
};

/** Every lab sitting of the term: for a course, a teacher or a room. */
export const loadLabs = once(() => DATA_RELEASE.labs ? fetchJson<Lab[]>(`${base}/labs/${DATA_RELEASE.labs}/labs.json`) : Promise.resolve([] as Lab[]));
const labIndex = once(() => DATA_RELEASE.labs ? fetchJson<{ classes: string[] }>(`${base}/labs/${DATA_RELEASE.labs}/index.json`) : Promise.resolve({ classes: [] as string[] }));
/** A class's lab sittings; a class with none has no file. */
export const loadClassLabs = async (id: string): Promise<Lab[]> => {
    if (!(await labIndex()).classes.includes(id)) return [];
    return (await fetchJson<{ labs: Lab[] }>(`${base}/labs/${DATA_RELEASE.labs}/classes/${encodeURIComponent(id)}.json`)).labs;
};

const days = new Map<string, Promise<RoomDay | null>>();
/** Who is in which room on a date; null outside the published days. */
export const loadRoomDay = (date: string) => {
    let day = days.get(date);
    if (!day) days.set(date, day = loadRoomIndex().then(index => fetch(`${base}/rooms/${index.term}/${date}.json`)).then(response => response.ok ? response.json() as Promise<RoomDay> : null));
    return day;
};
