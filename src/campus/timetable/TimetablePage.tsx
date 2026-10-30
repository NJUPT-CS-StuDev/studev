import { catalogId } from '@/timetable/model/courseCatalog';
import { CalendarClock, ChevronLeft, ChevronRight, Download, ListPlus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TeachingMeeting } from '@/academics/timetable';
import { timetableEdits, updateTimetableEdits, writePreferences } from '@/shared/lib/preferences';
import { usePreferences } from '@/shared/lib/usePreferences';
import type { LoadedClassSchedule, TeachingScheduleClient } from './model/TeachingScheduleClient';
import type { CatalogCourse } from './model/courseCatalog';
import { allocateCourseTones, courseIdentity } from './model/courseColors';
import { buildClassCalendar, downloadCalendar, todayInShanghai, weekdayInShanghai, meetingDate } from './model/calendar';
import { TimetableGrid } from './ui/TimetableGrid';
import { CourseDetailPanel } from './ui/CourseDetailPanel';
import { CourseManager, type TimetableCourse } from './ui/CourseManager';
import './timetable.css';

interface TimetablePageProps {
    className: string;
    week: number | null;
    /** A course search typed into the site header while this timetable is open. */
    courseQuery: string;
    client: TeachingScheduleClient;
    onChange: (params: Record<string, string | null>, replace?: boolean) => void;
}

const currentWeek = (loaded: LoadedClassSchedule): number => {
    const today = todayInShanghai();
    return loaded.term.weeks.find(week => today >= week.start && today <= week.end)?.week ?? 1;
};

const teachingClassOf = (meeting: TeachingMeeting): string => meeting.teaching_class.id ?? meeting.id;

const groupCourses = (meetings: TeachingMeeting[], source: TimetableCourse['source'], hidden: Set<string>): TimetableCourse[] => {
    const groups = new Map<string, TeachingMeeting[]>();
    for (const meeting of meetings) groups.set(teachingClassOf(meeting), [...(groups.get(teachingClassOf(meeting)) ?? []), meeting]);
    return [...groups].map(([id, list]) => ({
        meetings: list.sort((left, right) => left.weekday - right.weekday || left.periods[0] - right.periods[0]),
        source,
        hidden: hidden.has(id),
    })).sort((left, right) => left.meetings[0]!.course.name.localeCompare(right.meetings[0]!.course.name, 'zh-CN'));
};

export function TimetablePage({ className, week: requestedWeek, courseQuery, client, onChange }: TimetablePageProps) {
    const [loadState, setLoadState] = useState<{ className: string; loaded: LoadedClassSchedule | null; error: string | null }>({ className: '', loaded: null, error: null });
    const loaded = loadState.className === className ? loadState.loaded : null;
    const error = loadState.className === className ? loadState.error : null;
    const [dayView, setDayView] = useState(false);
    const [day, setDay] = useState(weekdayInShanghai);
    const [selected, setSelected] = useState<TeachingMeeting | null>(null);
    const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
    const [managing, setManaging] = useState(false);
    const [catalog, setCatalog] = useState<CatalogCourse[] | null>(null);
    const { prefs, ready } = usePreferences();

    useEffect(() => {
        const controller = new AbortController();
        client.loadClass(className, controller.signal).then(nextLoaded => {
            setLoadState({ className, loaded: nextLoaded, error: null });
        }).catch(reason => {
            if (reason instanceof DOMException && reason.name === 'AbortError') return;
            setLoadState({ className, loaded: null, error: reason instanceof Error ? reason.message : '课表加载失败' });
        });
        return () => controller.abort();
    }, [className, client]);

    // The first class someone opens becomes their class; another one stays a visit.
    useEffect(() => {
        if (ready && loaded && !prefs.class) writePreferences(current => ({ ...current, class: loaded.classInfo.name }));
    }, [loaded, prefs.class, ready]);

    useEffect(() => {
        if (!loaded) return;
        const week = requestedWeek && loaded.term.weeks.some(item => item.week === requestedWeek) ? requestedWeek : currentWeek(loaded);
        if (week !== requestedWeek || loaded.classInfo.name !== className) {
            onChange({ class: loaded.classInfo.name, week: String(week), q: courseQuery || null }, true);
        }
    }, [className, courseQuery, loaded, onChange, requestedWeek]);

    // A course search from the header opens the course manager on its results.
    useEffect(() => { if (courseQuery) setManaging(true); }, [courseQuery]);

    useEffect(() => {
        const pop = () => setSelected(null);
        window.addEventListener('popstate', pop);
        return () => window.removeEventListener('popstate', pop);
    }, []);

    const term = loaded ? loaded.term.term : '';
    const mine = Boolean(loaded && prefs.class === loaded.classInfo.name);
    const edits = useMemo(() => mine ? timetableEdits(prefs, term) : { hidden: [], added: [] }, [mine, prefs, term]);
    const loadCatalog = useCallback(() => client.loadCatalog().then(list => { setCatalog(list); return list; }), [client]);
    useEffect(() => { if (edits.added.length && !catalog) void loadCatalog().catch(() => undefined); }, [catalog, edits.added.length, loadCatalog]);

    const hidden = useMemo(() => new Set(edits.hidden), [edits.hidden]);
    const addedMeetings = useMemo(() => {
        if (!catalog || !edits.added.length) return [];
        const wanted = new Set(edits.added);
        return catalog.filter(course => wanted.has(catalogId(course))).flatMap(course => course.meetings);
    }, [catalog, edits.added]);
    const meetings = useMemo(() => {
        if (!loaded) return [];
        const own = loaded.meetings.filter(meeting => !hidden.has(teachingClassOf(meeting)));
        const ids = new Set(own.map(meeting => meeting.id));
        return [...own, ...addedMeetings.filter(meeting => !ids.has(meeting.id))];
    }, [addedMeetings, hidden, loaded]);
    const managedCourses = useMemo(() => loaded ? [
        ...groupCourses(loaded.meetings, 'class', hidden),
        ...groupCourses(addedMeetings.filter(meeting => !loaded.meetings.some(own => own.id === meeting.id)), 'added', new Set()),
    ] : [], [addedMeetings, hidden, loaded]);

    const openMeeting = useCallback((meeting: TeachingMeeting, target: HTMLElement) => {
        setReturnFocus(target);
        setSelected(meeting);
        if (window.history.state?.courseDetail) window.history.replaceState({ ...window.history.state, courseDetail: meeting.id }, '', window.location.href);
        else window.history.pushState({ ...window.history.state, courseDetail: meeting.id }, '', window.location.href);
    }, []);
    const closeMeeting = useCallback(() => {
        if (window.history.state?.courseDetail) window.history.back();
        else setSelected(null);
    }, []);
    const closeManager = useCallback(() => {
        setManaging(false);
        if (courseQuery && loaded) onChange({ class: loaded.classInfo.name, week: requestedWeek ? String(requestedWeek) : null, q: null }, true);
    }, [courseQuery, loaded, onChange, requestedWeek]);

    const makeMine = () => loaded && writePreferences(current => ({ ...current, class: loaded.classInfo.name }));
    const hide = (id: string) => updateTimetableEdits(term, current => ({ ...current, hidden: [...current.hidden, id] }));
    const show = (id: string) => updateTimetableEdits(term, current => ({ ...current, hidden: current.hidden.filter(item => item !== id) }));
    const add = (course: CatalogCourse) => updateTimetableEdits(term, current => ({ ...current, added: [...current.added, catalogId(course)] }));
    const removeAdded = (id: string) => updateTimetableEdits(term, current => ({ ...current, added: current.added.filter(item => item !== id) }));

    const tones = useMemo(() => allocateCourseTones(meetings), [meetings]);
    if (error) return <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-10"><div className="rounded-xl border border-[var(--danger)] bg-[var(--danger-bg)] p-5 text-[var(--danger)] dark:border-[var(--danger)] dark:bg-[var(--danger-bg)] dark:text-[var(--danger)]"><h1 className="text-xl font-semibold">班级课表暂时无法打开</h1><p className="mt-2 text-sm">{error}</p><button className="mt-4 rounded-full bg-[var(--brand)] px-4 py-2 text-sm text-[var(--on-brand)]" onClick={() => window.location.reload()}>重新加载</button></div></main>;
    if (!loaded) return <main className="timetable-page flex-1 w-full max-w-[1320px] mx-auto px-3 py-5 sm:px-4 sm:py-7" aria-busy="true"><div className="h-24 animate-pulse rounded-2xl bg-[var(--surface-sunken)] dark:bg-[var(--surface)]" /><div className="mt-4 h-[680px] animate-pulse rounded-2xl bg-[var(--surface)] dark:bg-[var(--surface)]" /></main>;
    const weekNumber = requestedWeek && loaded.term.weeks.some(item => item.week === requestedWeek) ? requestedWeek : currentWeek(loaded);
    const week = loaded.term.weeks.find(item => item.week === weekNumber) ?? loaded.term.weeks[0];
    if (!week) return null;
    const name = loaded.classInfo.name;
    const changeWeek = (next: number) => onChange({ class: name, week: String(Math.min(loaded.term.weeks.length, Math.max(1, next))) });
    const exportAll = () => downloadCalendar(`${name}-${loaded.term.year}-${loaded.term.year + 1}-${loaded.term.number}.ics`, buildClassCalendar(name, meetings, loaded.term.weeks, loaded.periods));
    const selectedTone = selected ? tones.get(courseIdentity(selected)) ?? 0 : 0;
    const editSummary = [edits.hidden.length ? `不上 ${edits.hidden.length} 门` : '', edits.added.length ? `自选 ${edits.added.length} 门` : ''].filter(Boolean).join(' · ');
    const selectedSource = selected ? (loaded.meetings.some(meeting => meeting.id === selected.id) ? 'class' : 'added') : null;

    return (
        <main className="timetable-page flex-1 w-full max-w-[1320px] mx-auto px-3 py-5 sm:px-4 sm:py-7">
            <header className="timetable-toolbar">
                <div>
                    <p>{mine ? `我的课表 · ${name}` : `${name} 班级课表`} · {`${loaded.term.year}-${loaded.term.year + 1}`} 第{loaded.term.number}学期{editSummary ? ` · ${editSummary}` : ''}</p>
                    <h1>第{weekNumber}周</h1>
                    <span>{week.start} 至 {week.end}</span>
                </div>
                <div className="timetable-toolbar-actions">
                    <div className="timetable-week-switcher"><button type="button" onClick={() => changeWeek(weekNumber - 1)} disabled={weekNumber <= 1} aria-label="上一周"><ChevronLeft /></button><button type="button" onClick={() => changeWeek(currentWeek(loaded))} disabled={weekNumber === currentWeek(loaded)}><CalendarClock />本周</button><button type="button" onClick={() => changeWeek(weekNumber + 1)} disabled={weekNumber >= loaded.term.weeks.length} aria-label="下一周"><ChevronRight /></button></div>
                    {mine ? <button type="button" className="timetable-manage" onClick={() => setManaging(true)}><ListPlus />课程</button> : <button type="button" className="timetable-manage" onClick={makeMine}>设为我的班级</button>}
                    <button type="button" className="timetable-export" onClick={exportAll} aria-label="导出到日历"><Download /><span>导出</span></button>
                </div>
            </header>
            <div className="timetable-view-switcher" aria-label="课表视图"><button type="button" aria-pressed={!dayView} onClick={()=>setDayView(false)}>周视图</button><button type="button" aria-pressed={dayView} onClick={()=>setDayView(true)}>日视图</button></div>
            {dayView ? <div className="timetable-day-picker" aria-label="选择星期">{[1,2,3,4,5,6,7].map(d=><button key={d} type="button" aria-pressed={day===d} onClick={()=>setDay(d)}>周{'一二三四五六日'[d-1]}<br />{Number(meetingDate(week,d).slice(8))}</button>)}</div> : null}
            <TimetableGrid day={dayView ? day : undefined} meetings={meetings} week={week} periods={loaded.periods} tones={tones} onOpen={openMeeting} />
            {selected ? (
                <CourseDetailPanel
                    className={name}
                    meeting={selected}
                    week={week}
                    weeks={loaded.term.weeks}
                    periods={loaded.periods}
                    tone={selectedTone}
                    updatedAt={loaded.term.observed_at}
                    returnFocus={returnFocus}
                    onClose={closeMeeting}
                    onRemove={mine ? () => {
                        if (selectedSource === 'added') removeAdded(teachingClassOf(selected));
                        else hide(teachingClassOf(selected));
                        closeMeeting();
                    } : null}
                    removeLabel={selectedSource === 'added' ? '移出我的课表' : '我不上这门课'}
                />
            ) : null}
            {managing && mine ? (
                <CourseManager
                    className={name}
                    courses={managedCourses}
                    loadCatalog={loadCatalog}
                    initialQuery={courseQuery}
                    onHide={hide}
                    onShow={show}
                    onAdd={add}
                    onRemoveAdded={removeAdded}
                    onClose={closeManager}
                />
            ) : null}
        </main>
    );
}
