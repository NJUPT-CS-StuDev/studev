import { useEffect, useMemo, useState } from 'react';
import type { Exam, TeachingClass, TeachingMeeting, TeachingPeriod, TeachingTerm } from '@/world/facts';
import { attendingExams } from '@/timetable/model/examAttendance';
import { examAttendanceScope, timetableEdits, type Preferences } from '@/world/preferences';
import { loadCalendar, loadClasses, loadClassExams, loadClassMeetings, loadExams, loadMeetings, loadPeriods, loadRuns, loadTerm, type MorningRun } from '@/world/data';
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
export function useTimeline(who: Who, prefs: Preferences, ready: boolean, preview: string | null) {
    const [base, setBase] = useState<Base | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [source, setSource] = useState<{ key: string; meetings: TeachingMeeting[]; exams: Exam[] } | null>(null);
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
            ? Promise.all([loadClassMeetings(classId), loadClassExams(classId)]).then(([meetings, exams]) => ({ meetings, exams }))
            : Promise.all([loadMeetings(), who.type === 'course' ? loadExams() : Promise.resolve([] as Exam[])]).then(([all, exams]) => ({
                exams: who.type === 'course' ? exams.filter(exam => courseName(exam.course.name) === who.id) : [],
                meetings: who.type === 'teacher' ? all.filter(meeting => meeting.teachers.some(teacher => teacher.name === who.id))
                    : who.type === 'course' ? all.filter(meeting => courseName(meeting.course.name) === who.id)
                        : who.type === 'room' ? all.filter(meeting => meeting.room === who.id) : [],
            }));
        load.then(value => { if (live) setSource({ key, ...value }); }).catch(reason => { if (live) setError(String(reason)); });
        return () => { live = false; };
    }, [classId, key, prefs.class, ready, who]);

    const term = base?.term.term ?? '';
    const edits = useMemo(() => who.type === 'me' ? timetableEdits(prefs, term) : { hidden: [] as string[], added: [] as string[] }, [prefs, term, who.type]);
    const [catalogRows, setCatalogRows] = useState<TeachingMeeting[]>([]);
    const needAll = edits.added.length > 0 || Boolean(preview);
    useEffect(() => {
        if (!needAll) return;
        let live = true;
        loadMeetings().then(all => {
            if (!live) return;
            const wanted = new Set(edits.added);
            setCatalogRows(all.filter(meeting => wanted.has(meeting.teaching_class.id)));
            setPreviewRows(preview ? all.filter(meeting => meeting.teaching_class.id === preview) : []);
        }).catch(() => undefined);
        return () => { live = false; };
    }, [edits.added, needAll, preview]);

    return useMemo<{ loaded: Loaded | null; error: string | null; previewRows: TeachingMeeting[] }>(() => {
        if (!base || !source || source.key !== key) return { loaded: null, error, previewRows };
        const hidden = new Set(edits.hidden);
        const own = source.meetings.filter(meeting => !hidden.has(meeting.teaching_class.id));
        const added = catalogRows.filter(meeting => !own.some(row => row.id === meeting.id));
        const meetings = distinct([...own, ...added]);
        const classInfo = classId ? base.classes.find(item => item.id === classId || item.name === classId) ?? null : null;
        const codes = new Set(meetings.map(meeting => meeting.course.code ?? ''));
        const choices = classId ? prefs.examAttendance?.[examAttendanceScope(base.term.term, classId)] ?? {} : {};
        const exams = who.type === 'me' ? attendingExams(source.exams, choices, codes) : source.exams;
        const grade = gradeOf(classInfo?.grade, base.term);
        const runOn = who.type === 'me' && base.run && (prefs.run?.on ?? (grade !== null && grade <= 2));
        const line: Timeline = { term: base.term, periods: base.periods, meetings, exams, holidays: base.holidays, run: runOn && base.run ? { rule: base.run, days: prefs.run?.days ?? [], adjust: prefs.run?.adjust ?? 0 } : null };
        return { loaded: { ...base, line, own, added, classInfo }, error, previewRows };
    }, [base, catalogRows, classId, edits.hidden, error, key, prefs.examAttendance, prefs.run, previewRows, source, who.type]);
}
