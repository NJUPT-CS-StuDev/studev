import { useEffect, useMemo, useState } from 'react';
import type { Exam, Lab, TeachingClass, TeachingMeeting, TeachingPeriod, TeachingTerm } from '@/world/facts';
import type { Task } from '@/world/tasks';
import { attendingLabs, personalLabs } from '@/timetable/model/labs';
import { customMeetings, renamed, renamedAlong } from '@/timetable/model/courses';
import { attendingExams } from '@/timetable/model/examAttendance';
import { examAttendanceScope, timetableEdits, type Preferences, type TimetableEdits } from '@/world/preferences';
import { loadCalendar, loadClasses, loadClassExams, loadClassLabs, loadClassMeetings, loadExams, loadLabs, loadMeetings, loadPeriods, loadRuns, loadTerm, type MorningRun } from '@/world/data';
import { gradeOf, holidayMap, type Timeline } from '@/world/events';
import { courseName } from '@/world/names';

export type Who = { type: 'me' } | { type: 'class' | 'teacher' | 'course' | 'room'; id: string };
export const parseWho = (value: string | null): Who => {
    const cut = value?.indexOf(':') ?? -1;
    const type = cut > 0 ? value!.slice(0, cut) : '';
    return type === 'class' || type === 'teacher' || type === 'course' || type === 'room' ? { type, id: value!.slice(cut + 1) } : { type: 'me' };
};

interface Base { term: TeachingTerm; periods: TeachingPeriod[]; classes: TeachingClass[]; holidays: Map<string, string>; run: MorningRun | null }
export interface Loaded extends Base { line: Timeline; own: TeachingMeeting[]; added: TeachingMeeting[]; classInfo: TeachingClass | null }

const distinct = (meetings: TeachingMeeting[]) => [...new Map(meetings.map(meeting => [meeting.id, meeting])).values()];

/** Everything needed to draw one person, class, course or room along time. */
export function useTimeline(who: Who, prefs: Preferences, ready: boolean, preview: string | null, tasks: Task[]) {
    const [base, setBase] = useState<Base | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [source, setSource] = useState<{ key: string; meetings: TeachingMeeting[]; labs: Lab[]; exams: Exam[] } | null>(null);
    const [previewRows, setPreviewRows] = useState<TeachingMeeting[]>([]);

    useEffect(() => {
        Promise.all([loadTerm(), loadPeriods(), loadClasses(), loadCalendar(), loadRuns()]).then(([term, periods, classes, calendar, runs]) => {
            setBase({ term, periods, classes, holidays: holidayMap(calendar), run: runs[term.term] ?? null });
        }).catch(reason => setError(String(reason)));
    }, []);

    const classId = who.type === 'me' ? prefs.class ?? null : who.type === 'class' ? who.id : null;
    const key = `${who.type}:${who.type === 'me' ? prefs.class : who.id}`;
    useEffect(() => {
        if (!ready || (who.type === 'me' && !prefs.class)) return;
        let live = true;
        const load = classId
            ? Promise.all([loadClassMeetings(classId), loadClassLabs(classId), loadClassExams(classId)]).then(([meetings, labs, exams]) => ({ meetings, labs, exams }))
            : Promise.all([loadMeetings(), loadLabs(), who.type === 'course' ? loadExams() : Promise.resolve([] as Exam[])]).then(([all, labs, exams]) => ({
                exams: who.type === 'course' ? exams.filter(exam => courseName(exam.course.name) === who.id) : [],
                labs: who.type === 'teacher' ? labs.filter(lab => lab.teachers.includes(who.id))
                    : who.type === 'course' ? labs.filter(lab => courseName(lab.course.name) === who.id)
                        : who.type === 'room' ? labs.filter(lab => lab.room === who.id) : [],
                meetings: who.type === 'teacher' ? all.filter(meeting => meeting.teachers.some(teacher => teacher.name === who.id))
                    : who.type === 'course' ? all.filter(meeting => courseName(meeting.course.name) === who.id)
                        : who.type === 'room' ? all.filter(meeting => meeting.room === who.id) : [],
            }));
        load.then(value => { if (live) setSource({ key, ...value }); }).catch(reason => { if (live) setError(String(reason)); });
        return () => { live = false; };
    }, [classId, key, prefs.class, ready, who]);

    const term = base?.term.term ?? '';
    const edits = useMemo(() => who.type === 'me' ? timetableEdits(prefs, term) : { hidden: [] as string[], added: [] as string[] } as TimetableEdits, [prefs, term, who.type]);
    const [catalogRows, setCatalogRows] = useState<TeachingMeeting[]>([]);
    const [catalogLabs, setCatalogLabs] = useState<Lab[]>([]);
    const needAll = edits.added.length > 0 || Boolean(preview);
    useEffect(() => {
        if (!needAll) return;
        let live = true;
        Promise.all([loadMeetings(), edits.added.length ? loadLabs() : Promise.resolve([] as Lab[])]).then(([all, labs]) => {
            if (!live) return;
            const wanted = new Set(edits.added);
            setCatalogRows(all.filter(meeting => wanted.has(meeting.teaching_class.id)));
            setCatalogLabs(labs);
            setPreviewRows(preview ? all.filter(meeting => meeting.teaching_class.id === preview) : []);
        }).catch(() => undefined);
        return () => { live = false; };
    }, [edits.added, needAll, preview]);

    return useMemo<{ loaded: Loaded | null; error: string | null; previewRows: TeachingMeeting[] }>(() => {
        if (!base || !source || source.key !== key) return { loaded: null, error, previewRows };
        const hidden = new Set(edits.hidden);
        const own = source.meetings.filter(meeting => !hidden.has(meeting.teaching_class.id));
        const added = catalogRows.filter(meeting => !own.some(row => row.id === meeting.id));
        // One's own courses join as meetings, and every lesson carries the name its person gave its course.
        const plain = distinct([...own, ...added, ...(edits.custom ?? []).flatMap(customMeetings)]);
        const meetings = plain.map(meeting => renamed(meeting, edits.names));
        const classInfo = classId ? base.classes.find(item => item.id === classId || item.name === classId) ?? null : null;
        const codes = new Set(meetings.map(meeting => meeting.course.code ?? ''));
        const choices = classId ? prefs.examAttendance?.[examAttendanceScope(base.term.term, classId)] ?? {} : {};
        const exams = who.type === 'me' ? attendingExams(source.exams, choices, codes) : source.exams;
        const grade = gradeOf(classInfo?.grade, base.term);
        const runOn = who.type === 'me' && base.run && (prefs.run?.on ?? (grade !== null && grade <= 2));
        const labs = who.type === 'me' ? attendingLabs(personalLabs(source.labs, source.meetings, own, added, catalogLabs), prefs.labs) : source.labs;
        const line: Timeline = { term: base.term, periods: base.periods, meetings, labs: labs.map(lab => renamedAlong(lab, plain, edits.names)), exams: exams.map(exam => renamedAlong(exam, plain, edits.names)), holidays: base.holidays, run: runOn && base.run ? { rule: base.run, days: prefs.run?.days ?? [], adjust: prefs.run?.adjust ?? 0 } : null, tasks: who.type === 'me' ? tasks : [] };
        return { loaded: { ...base, line, own, added, classInfo }, error, previewRows };
    }, [base, catalogLabs, catalogRows, classId, prefs.labs, tasks, edits.hidden, error, key, prefs.examAttendance, prefs.run, previewRows, source, who.type]);
}
