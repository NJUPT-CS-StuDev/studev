// The same line as a list: one's tasks by when they are due, with the exams among them, since an exam is the
// hardest deadline there is. A task is added here in one line, what it says of its day, time and course shown as it
// is typed. A task is held and dragged to put it elsewhere in its group, or into today, tomorrow or no day at all.
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { eventsOn, upcomingExams, type CampusEvent, type Timeline } from '@/world/events';
import { courseIdentity } from '@/timetable/model/courseColors';
import { courseName, courseShort, roomLabel } from '@/world/names';
import { DROP_GROUPS, moveTask, newTaskId, parseQuickTask, saveTask, saveTasks, taskGroup, taskOrder, TASK_GROUPS, toggleDone, type QuickTask, type Task, type TaskGroup } from '@/world/tasks';
import { dayWord as dayOf, daysBetween, hm, minutesOf, type Moment } from '@/world/time';
import { Chevron } from '@/world/ui';
import { readHints, suggestTasks, TASK_EXAMPLES, writeHints } from '@/world/suggestions';

const examGroup = (date: string, now: Moment): TaskGroup => {
    const days = daysBetween(now.date, date);
    return days === 0 ? 'today' : days === 1 ? 'tomorrow' : days <= 7 ? 'week' : 'later';
};
const dayWord = (date: string, now: Moment) => dayOf(date, now.date);
/** What a row says on its right: when it is planned, and when it is due; red once it is late. */
function whenOf(task: Task, now: Moment): { text: string; tone: '' | 'late' | 'today' } {
    const parts: string[] = [];
    if (task.date) parts.push(`${dayWord(task.date, now)} ${hm(task.start!)}${task.end !== undefined ? `–${hm(task.end)}` : ''}`);
    if (task.due) parts.push(`${task.date ? '截止 ' : ''}${dayWord(task.due.date, now)}${task.due.time !== undefined ? ` ${hm(task.due.time)}` : ''}${task.date ? '' : ' 截止'}`);
    const group = taskGroup(task, now);
    return { text: parts.join(' · '), tone: group === 'overdue' ? 'late' : group === 'today' ? 'today' : '' };
}
/** What one typed line was read as, said back before it is added. */
function readBack(quick: QuickTask, now: Moment, courses: Map<string, string>): string[] {
    const said: string[] = [];
    if (quick.date) said.push(`${dayWord(quick.date, now)} ${hm(quick.start!)}${quick.end !== undefined ? `–${hm(quick.end)}` : ''}`);
    if (quick.due) said.push(`${dayWord(quick.due.date, now)}${quick.due.time !== undefined ? ` ${hm(quick.due.time)}` : ''} 截止`);
    if (quick.priority) said.push(['', '低优先级', '中优先级', '高优先级'][quick.priority]!);
    if (quick.course) said.push(courseShort(courses.get(quick.course) ?? quick.course));
    return said;
}

interface Drag { id: string; from: TaskGroup; pointer: number; y: number; dy: number; width: number; left: number; top: number; target: { group: TaskGroup; index: number } | null }
const HOLD = 320;

export function ListView({ line, now, courses, onTask, onOpen }: { line: Timeline; now: Moment; courses: Map<string, string>; onTask: (task: Task) => void; onOpen: (event: CampusEvent) => void }) {
    const [draft, setDraft] = useState('');
    const [showDone, setShowDone] = useState(false);
    const [drag, setDrag] = useState<Drag | null>(null);
    const [hints, setHints] = useState(readHints);
    const listRef = useRef<HTMLDivElement>(null);
    const hold = useRef<{ timer: number; pointer: number; x: number; y: number; id: string; row: HTMLElement } | null>(null);
    const top = line.tasks.filter(task => !task.parent);
    const open = top.filter(task => !task.done).sort(taskOrder);
    const done = top.filter(task => task.done).sort((left, right) => (right.done ?? '').localeCompare(left.done ?? ''));
    const exams = upcomingExams(line, now.date).map(({ exam }) => exam);
    const steps = (task: Task) => line.tasks.filter(item => item.parent === task.id);
    const quickCourses = useMemo(() => [...new Map(line.meetings.map(meeting => [courseIdentity(meeting), { identity: courseIdentity(meeting), names: [courseName(meeting.course.name), courseShort(meeting.course.name)] }])).values()], [line.meetings]);
    const quick = draft.trim() ? parseQuickTask(draft, now, quickCourses) : null;
    const suggested = suggestTasks(line, now, hints.setAside);
    const setAside = (key: string) => setHints(writeHints(current => ({ ...current, setAside: [...current.setAside, key] })));
    const said = quick ? readBack(quick, now, courses) : [];
    const add = () => {
        if (!quick?.title) return;
        const { marks, ...task } = quick;
        // A task just added goes first in its group, where it is seen.
        saveTask({ id: newTaskId(), ...task, order: -Date.now() });
        setDraft('');
    };
    const grouped = (key: TaskGroup) => open.filter(task => taskGroup(task, now) === key);

    /** Where a task held at height `y` would go: the nearest gap between the rows of the groups it can go into. */
    /** A task goes back into its own group, or into one that gives it a day; the others are not where it can go. */
    const accepts = (group: TaskGroup, from: TaskGroup) => group === from || DROP_GROUPS.includes(group);
    const where = (y: number, from: TaskGroup): Drag['target'] => {
        const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-slot]') ?? [])];
        let best: Drag['target'] = null, distance = Infinity;
        for (const row of rows) {
            const box = row.getBoundingClientRect();
            const group = row.dataset.group as TaskGroup, index = Number(row.dataset.index);
            if (!accepts(group, from)) continue;
            const edges: [number, number][] = row.dataset.slot === 'empty' ? [[box.top + box.height / 2, index]] : [[box.top, index], [box.bottom, index + 1]];
            for (const [edge, at] of edges) {
                const gap = Math.abs(y - edge);
                if (gap < distance) { distance = gap; best = { group, index: at }; }
            }
        }
        return best;
    };
    const lift = (id: string, pointer: number, y: number, row: HTMLElement) => {
        const box = row.getBoundingClientRect();
        navigator.vibrate?.(12);
        setDrag({ id, from: row.dataset.group as TaskGroup, pointer, y, dy: 0, width: box.width, left: box.left, top: box.top, target: null });
    };
    // Holding a row picks it up: with a mouse once it moves, with a finger after a moment held still.
    const onPointerDown = (event: ReactPointerEvent<HTMLElement>, task: Task) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest('.tcheck')) return;
        const row = event.currentTarget;
        const start = { pointer: event.pointerId, x: event.clientX, y: event.clientY, id: task.id, row };
        hold.current = { ...start, timer: event.pointerType === 'mouse' ? 0 : window.setTimeout(() => { if (hold.current?.id === task.id) lift(task.id, start.pointer, start.y, row); }, HOLD) };
    };
    useEffect(() => {
        const move = (event: PointerEvent) => {
            if (drag && event.pointerId === drag.pointer) {
                setDrag(current => current && { ...current, dy: event.clientY - current.y, target: where(event.clientY, current.from) });
                return;
            }
            const pending = hold.current;
            if (!pending || event.pointerId !== pending.pointer) return;
            const far = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
            if (event.pointerType === 'mouse' && far > 6) { hold.current = null; lift(pending.id, pending.pointer, pending.y, pending.row); }
            else if (event.pointerType !== 'mouse' && far > 8) { clearTimeout(pending.timer); hold.current = null; }
        };
        const up = (event: PointerEvent) => {
            const pending = hold.current;
            if (pending && event.pointerId === pending.pointer) { clearTimeout(pending.timer); hold.current = null; }
            if (!drag || event.pointerId !== drag.pointer) return;
            const task = open.find(item => item.id === drag.id);
            if (task && drag.target) saveTasks(moveTask(task, drag.target.group, drag.target.index, grouped(drag.target.group), now));
            // The click that ends a drag is not a tap on the row.
            const swallow = (stop: MouseEvent) => { stop.stopPropagation(); stop.preventDefault(); };
            window.addEventListener('click', swallow, { capture: true, once: true });
            setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 50);
            setDrag(null);
        };
        // While a finger holds a task, the page does not scroll under it.
        const still = (event: TouchEvent) => { if (drag) event.preventDefault(); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        window.addEventListener('touchmove', still, { passive: false });
        return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); window.removeEventListener('touchmove', still); };
    });

    const row = (task: Task, slot?: { group: TaskGroup; index: number }) => {
        const parts = steps(task);
        const when = whenOf(task, now);
        return (
            <div key={task.id} className={`trow-i p${task.priority ?? 0}`}
                {...(slot ? { 'data-slot': 'task', 'data-group': slot.group, 'data-index': slot.index } : {})}
                onPointerDown={slot ? event => onPointerDown(event, task) : undefined} onContextMenu={slot ? event => event.preventDefault() : undefined}>
                <button className={`tcheck ${task.done ? 'on' : ''}`} aria-label={task.done ? '标为未完成' : '完成'} onClick={() => toggleDone(task)} />
                <button className="tmain" onClick={() => onTask(task)}>
                    <b className={task.done ? 'task-done' : ''}>{task.title}</b>
                    <span className="tmeta">
                        {task.course && courses.get(task.course) && <i>{courseShort(courses.get(task.course)!)}</i>}
                        {parts.length > 0 && <i>{parts.filter(item => item.done).length}/{parts.length}</i>}
                        {task.note && <i aria-label="有备注">≡</i>}
                        {when.text && <em className={when.tone}>{when.text}</em>}
                    </span>
                </button>
            </div>
        );
    };
    const dragging = drag ? open.find(task => task.id === drag.id) : undefined;
    const dropLine = (key: TaskGroup, index: number) => drag?.target?.group === key && drag.target.index === index ? <div key={`drop-${index}`} className="tdrop" /> : null;
    return (
        <div className={`tlist ${drag ? 'dragging' : ''}`} ref={listRef}>
            <div className="tadd">
                <div className="sfield">
                    <input value={draft} placeholder="添加任务，如：明天下午3点 交毛概作业 #毛概 !!" aria-label="添加任务" enterKeyHint="done"
                        onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) add(); }} />
                    {draft.trim() && <button className="ib" onClick={add}>添加</button>}
                </div>
                {quick && <p className="tread">{said.length
                    ? <>{said.map(item => <span key={item}>{item}</span>)}<b>{quick.title}</b></>
                    : <small>没有读出日期，会放进“还没排日期”</small>}</p>}
                {!draft && !open.length && <p className="tread examples">{TASK_EXAMPLES.map(example => <button key={example} onClick={() => setDraft(example)}>{example}</button>)}</p>}
                {open.length > 1 && !hints.dragTold && <p className="thint">按住一件事可以拖动，拖到“今天”“明天”就改了日期<button aria-label="知道了" onClick={() => setHints(writeHints(current => ({ ...current, dragTold: true })))}>×</button></p>}
            </div>
            {suggested.length > 0 && !drag && <section className="tgroup suggest">
                <h3 className="sh">从你的安排里<span /></h3>
                {suggested.map(({ key, task }) => <div key={key} className="trow-i">
                    <button className="tplus" aria-label="加上" onClick={() => saveTask({ id: newTaskId(), ...task, order: -Date.now() })}>+</button>
                    <span className="tmain"><b>{task.title}</b><span className="tmeta">{task.course && courses.get(task.course) && <i>{courseShort(courses.get(task.course)!)}</i>}<em>{dayWord(task.due!.date, now)} 截止</em></span></span>
                    <button className="tskip" aria-label="不用" onClick={() => setAside(key)}>×</button>
                </div>)}
            </section>}
            {TASK_GROUPS.map(({ key, name }) => {
                const tasks = grouped(key).filter(task => task.id !== drag?.id);
                const dated = key === 'overdue' || key === 'someday' ? [] : exams.filter(exam => examGroup(exam.date, now) === key);
                const target = Boolean(drag) && DROP_GROUPS.includes(key);
                if (!tasks.length && !dated.length && !target) return null;
                return (
                    <section key={key} className={`tgroup ${key} ${drag && !accepts(key, drag.from) ? 'closed' : ''}`}>
                        <h3 className="sh">{name}<span>{tasks.length + dated.length || ''}</span></h3>
                        {dated.map(exam => {
                            const event = eventsOn(line, exam.date).find(item => item.exam?.id === exam.id);
                            return <button key={exam.id} className="trow-i exam" onClick={() => event && onOpen(event)}>
                                <span className="tag">考试</span>
                                <span className="tmain"><b>{courseName(exam.course.name)}</b><span className="tmeta"><em className={key === 'today' ? 'today' : ''}>{dayWord(exam.date, now)} {hm(minutesOf(exam.start))} · {roomLabel(exam.room ?? exam.location)}</em></span></span>
                            </button>;
                        })}
                        {tasks.flatMap((task, index) => [dropLine(key, index), row(task, { group: key, index })])}
                        {tasks.length > 0 && dropLine(key, tasks.length)}
                        {!tasks.length && target && <div className={`tempty ${drag?.target?.group === key ? 'on' : ''}`} data-slot="empty" data-group={key} data-index={0}>{key === 'someday' ? '放到这里，去掉日期' : `放到这里，改到${name}`}</div>}
                    </section>
                );
            })}
            {!open.length && !exams.length && <p className="empty">没有要做的事。在上面输入一件，回车就加上了。</p>}
            {done.length > 0 && <section className="tgroup done">
                <button className="sh tdone-h" onClick={() => setShowDone(!showDone)}>已完成 {done.length} 项 <Chevron /></button>
                {showDone && done.map(task => row(task))}
            </section>}
            {drag && dragging && <div className="tfloat" style={{ top: drag.top + drag.dy, left: drag.left, width: drag.width }}>{row(dragging)}</div>}
        </div>
    );
}
