// The timetable: pick who, unfold along time. Everything on screen is in the address.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { updateExamAttendance, updateRun, updateTimetableEdits, writePreferences } from '@/world/preferences';
import { courseIdentity } from '@/timetable/model/courseColors';
import { usePreferences } from '@/world/usePreferences';
import { useTasks } from '@/world/useTasks';
import { LAYER_ORDER, lastLesson, toggleRun, weekOfDate, weekShown, type CampusEvent } from '@/world/events';
import { loadExamRecord, type ExamRecord } from '@/world/data';
import { roomLabel } from '@/world/names';
import { addDays, dateLabel, daysBetween, momentNow, startOfWeek, WEEKDAYS, weekdayOf, type Moment } from '@/world/time';
import { useUrl, useWide } from '@/world/useUrl';
import { Back, Chevron } from '@/world/ui';
import { parseWho, useTimeline, type Who } from './useTimeline';
import { ClassPicker } from './ClassPicker';
import { DayView } from './views/DayView';
import { WeekView } from './views/WeekView';
import { TermView, type TermMode } from './views/TermView';
import { EventSheet } from './EventSheet';
import { CalendarSheet } from './CalendarSheet';
import { PreviewDock } from './PreviewDock';
import { TaskSheet } from './TaskSheet';
import { ListView } from './views/ListView';
import { courseName } from '@/world/names';
import type { Task } from '@/world/tasks';
import '../campus.css';

// The list is one's own: tasks by when they are due, exams among them.
const SCALES = [['day', '天'], ['week', '周'], ['term', '学期'], ['list', '清单']] as const;
type Scale = typeof SCALES[number][0];
const whoTitle = (who: Exclude<Who, { type: 'me' }>) => who.type === 'teacher' ? `${who.id} 老师` : who.type === 'room' ? roomLabel(who.id) : who.id;

export default function TimetableApp() {
    const { params, set } = useUrl();
    const { prefs, ready } = usePreferences();
    const wide = useWide();
    const [now, setNow] = useState<Moment>(momentNow);
    useEffect(() => { const timer = setInterval(() => setNow(momentNow()), 30_000); return () => clearInterval(timer); }, []);

    const who = useMemo(() => parseWho(params.get('who')), [params]);
    const scale = (params.get('scale') as Scale | null) ?? (wide ? 'week' : 'day');
    const picked = /^\d{4}-\d{2}-\d{2}$/.test(params.get('t') ?? '') ? params.get('t')! : null;
    const preview = params.get('preview');
    const tasks = useTasks();
    const { loaded, error, previewRows } = useTimeline(who, prefs, ready, preview, tasks);
    const [open, setOpen] = useState<CampusEvent | null>(null);
    // A task is opened by its id, so the sheet always shows it as it now is.
    const [taskId, setTaskId] = useState<string | null>(null);
    const [calendar, setCalendar] = useState(false);
    const classId = who.type === 'me' ? prefs.class ?? null : who.type === 'class' ? who.id : null;
    const [record, setRecord] = useState<ExamRecord | null>(null);
    useEffect(() => { let live = true; setRecord(null); if (classId) void loadExamRecord(classId).then(next => { if (live) setRecord(next); }); return () => { live = false; }; }, [classId]);

    const page = useRef<HTMLDivElement>(null);
    // Pinching, or ctrl with the wheel, moves between day, week and term.
    const stepScale = useCallback((direction: number) => {
        const order = SCALES.map(item => item[0]);
        const next = order[order.indexOf(scale) + direction];
        if (next) set({ scale: next });
    }, [scale, set]);
    useEffect(() => {
        const element = page.current;
        if (!element) return;
        let last = 0;
        const step = (direction: number) => { const time = performance.now(); if (time - last > 450) { last = time; stepScale(direction); } };
        const wheel = (event: WheelEvent) => { if (event.ctrlKey) { event.preventDefault(); step(event.deltaY > 0 ? 1 : -1); } };
        const points = new Map<number, [number, number]>();
        let span = 0;
        const distance = () => { const [a, b] = [...points.values()]; return Math.hypot(a![0] - b![0], a![1] - b![1]); };
        const down = (event: PointerEvent) => { points.set(event.pointerId, [event.clientX, event.clientY]); if (points.size === 2) span = distance(); };
        const move = (event: PointerEvent) => {
            if (!points.has(event.pointerId)) return;
            points.set(event.pointerId, [event.clientX, event.clientY]);
            if (points.size === 2 && span) { const d = distance(); if (d / span < .72) { step(1); span = d; } else if (d / span > 1.38) { step(-1); span = d; } }
        };
        const up = (event: PointerEvent) => { points.delete(event.pointerId); if (points.size < 2) span = 0; };
        element.addEventListener('wheel', wheel, { passive: false });
        element.addEventListener('pointerdown', down);
        element.addEventListener('pointermove', move);
        element.addEventListener('pointerup', up);
        element.addEventListener('pointercancel', up);
        return () => { element.removeEventListener('wheel', wheel); element.removeEventListener('pointerdown', down); element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', up); element.removeEventListener('pointercancel', up); };
    }, [stepScale]);

    if (ready && who.type === 'me' && !prefs.class) return <div className="sd page"><ClassPicker /></div>;
    if (error) return <div className="sd page"><div className="wrap narrow"><p className="empty">课表暂时打不开，请刷新重试。</p></div></div>;
    if (!loaded) return <div className="sd page" aria-busy="true" />;

    const { term, line } = loaded;
    const isMe = who.type === 'me';
    // A week opened as "now" shows what is left of this one, or the next one once this is over.
    const day = picked ?? (scale === 'week' ? weekShown(line, now) : now.date);
    const ahead = picked ? 0 : daysBetween(startOfWeek(now.date), startOfWeek(day)) / 7;
    const rolled = ahead > 0;
    const week = weekOfDate(term, day);
    const nowWeek = weekOfDate(term, now.date);
    const last = scale === 'term' ? lastLesson(line) : null;
    const monday = startOfWeek(day);
    const termName = `${term.year}–${term.year + 1} 学年第${term.number === 1 ? '一' : '二'}学期`;
    const title = !isMe ? whoTitle(who) : scale === 'list' ? '清单' : scale === 'term' ? termName : scale === 'week' ? (week ? `第 ${week} 周` : '假期') : `${dateLabel(day)} ${WEEKDAYS[weekdayOf(day)]}`;
    const pending = line.tasks.filter(task => !task.parent && !task.done).length;
    const subtitle = scale === 'list' ? (pending ? `${pending} 件要做` : '没有要做的事') : scale === 'term'
        ? `${dateLabel(term.weeks[0]!.start)} – ${dateLabel(term.weeks.at(-1)!.end)} · ${nowWeek ? `第 ${nowWeek} / ${term.weeks.length} 周` : `${term.weeks.length} 周`}${last ? ` · 课上到 ${dateLabel(last)}` : ''}`
        : scale === 'week' ? `${ahead === 1 ? '下周 · ' : ahead > 1 ? `${ahead} 周后 · ` : ''}${dateLabel(monday)} – ${dateLabel(addDays(monday, 6))}` : week ? `第 ${week} 周` : '假期';
    const showShift = scale !== 'term' && scale !== 'list' && !(scale === 'day' && !wide);
    const shift = (direction: number) => set({ t: addDays(day, direction * (scale === 'week' ? 7 : 1)) });
    const openEvent = (event: CampusEvent) => event.task ? setTaskId(event.task.id) : setOpen(event);
    const openTask = (task: Task) => setTaskId(task.id);
    const editing = taskId ? line.tasks.find(task => task.id === taskId) ?? null : null;
    const courses = new Map(line.meetings.map(meeting => [courseIdentity(meeting), courseName(meeting.course.name)]));

    const mine = {
        hideCourse: (id: string) => id.startsWith('custom:') ? updateTimetableEdits(term.term, edits => ({ ...edits, custom: (edits.custom ?? []).filter(course => `custom:${course.id}` !== id) })) : updateTimetableEdits(term.term, edits => edits.added.includes(id)
            ? { ...edits, added: edits.added.filter(item => item !== id) } : { ...edits, hidden: [...edits.hidden, id] }),
        skipExam: (id: string) => { if (prefs.class) updateExamAttendance(term.term, prefs.class, { [id]: false }); },
        labs: (key: 'skip' | 'drop', value: string) => writePreferences(current => ({ ...current, labs: { ...current.labs, [key]: [...new Set([...(current.labs?.[key] ?? []), value])] } })),
    };

    return (
        <div className="sd page" ref={page}>
            {/* One width for every scale: the title, buttons and tabs stay put when switching. */}
            <div className="wrap">
                <header className="ph">
                    <div>
                        {!isMe && <button className="back" onClick={() => set({ who: null, scale: null, preview: null }, { push: true })}><Back />我的课表</button>}
                        <h1>{title}</h1>
                        <p>{subtitle}{isMe && wide && prefs.class ? ` · ${prefs.class}` : ''}</p>
                    </div>
                    <div className="acts">
                        {showShift && <>
                            <button className="ib" aria-label="上一个" onClick={() => shift(-1)}><Back /></button>
                            <button className="ib" onClick={() => set({ t: rolled ? now.date : null })}>今天</button>
                            <button className="ib" aria-label="下一个" onClick={() => shift(1)}><Chevron /></button>
                        </>}
                        {isMe && prefs.class && <button className="ib" onClick={() => setCalendar(true)}>日历</button>}
                        {isMe && wide && <a className="ib" href="/search/?scope=course">加课</a>}
                    </div>
                </header>
                <div className="tabs" role="tablist">
                    {SCALES.filter(([key]) => key !== 'list' || isMe).map(([key, label]) => <button key={key} role="tab" aria-selected={scale === key} className={scale === key ? 'on' : ''} onClick={() => set({ scale: key, mode: null })}>{label}</button>)}
                </div>
                {scale === 'day' && <DayView line={line} day={day} now={now} isMe={isMe} record={record} order={prefs.layers ?? LAYER_ORDER} onPick={date => set({ t: date === now.date ? null : date })} onOpen={openEvent} onTask={openTask} />}
                {scale === 'week' && <WeekView line={line} day={day} now={now} wide={wide} record={record} previewRows={previewRows} order={prefs.layers ?? LAYER_ORDER} onOpen={openEvent} onTask={openTask} />}
                {scale === 'list' && isMe && <ListView line={line} now={now} courses={courses} onTask={openTask} onOpen={openEvent} />}
                {scale === 'term' && <TermView line={line} now={now} isMe={isMe} record={record} practice={loaded.classInfo?.practice ?? []} mode={(params.get('mode') as TermMode | null) ?? 'course'} onMode={next => set({ mode: next === 'course' ? null : next })} onPick={date => set({ t: date, scale: 'week' }, { push: true })} onOpen={openEvent} />}
                {preview && previewRows.length > 0 && <PreviewDock rows={previewRows} mine={line.meetings} week={week} added={prefs.timetable?.[term.term]?.added.includes(preview) ?? false}
                    onCancel={() => set({ preview: null })}
                    onAdd={() => { updateTimetableEdits(term.term, edits => ({ ...edits, added: [...new Set([...edits.added, preview])] })); set({ preview: null }); }} />}
            </div>
            {calendar && prefs.class && <CalendarSheet line={line} className={prefs.class} prefs={prefs} onClose={() => setCalendar(false)} />}
            {editing && <TaskSheet key={editing.id} task={editing} line={line} onClose={() => setTaskId(null)} />}
            {open && <EventSheet event={open} line={line} now={now} isMe={isMe} record={record} campus={loaded.classInfo?.campus ?? null} order={prefs.layers ?? LAYER_ORDER} onClose={() => setOpen(null)} onOpen={setOpen}
                onSkipLab={event => { mine.labs('skip', event.lab!.id); setOpen(null); }}
                onRename={(event, name) => { const id = courseIdentity(event.meeting!); updateTimetableEdits(term.term, edits => { const names = { ...edits.names }; if (name) names[id] = name; else delete names[id]; return { ...edits, names: Object.keys(names).length ? names : undefined }; }); setOpen(null); }}
                onDropLab={event => { mine.labs('drop', courseIdentity(event.lab!)); setOpen(null); }}
                onHide={event => { mine.hideCourse(event.meeting!.teaching_class.id); setOpen(null); }}
                onSkipExam={event => { mine.skipExam(event.exam!.id); setOpen(null); }}
                onUnplan={() => { updateRun({ days: toggleRun(line.run!.days, open.date) }); setOpen(null); }}
                onPlan={() => { setOpen(null); set({ scale: 'term', mode: 'run' }, { push: true }); }}
                onExams={() => { setOpen(null); set({ scale: 'term', mode: 'exam' }, { push: true }); }} />}
        </div>
    );
}

