// One's own task, opened from the list or the timeline. Its title is edited where it stands; when it is planned,
// when it is due, how important it is and which course it is for sit in one row, each opening its own few choices
// in place; then its steps and a note. Everything is kept as it is changed.
import { useEffect, useState, type ReactNode } from 'react';
import { courseIdentity } from '@/timetable/model/courseColors';
import type { Timeline } from '@/world/events';
import { courseName, courseShort } from '@/world/names';
import { DAY_REMINDERS, deleteTask, newTaskId, saveTask, TIMED_REMINDERS, toggleDone, type Task } from '@/world/tasks';
import { addDays, dayWord, hm, minutesOf, momentNow, weekdayOf } from '@/world/time';
import { availableSlots, type TimeSlot } from '@/world/planning';
import { Sheet } from '@/world/ui';
import { EventChoices } from './EventChoices';

const PRIORITIES = [{ value: 0, name: '无' }, { value: 1, name: '低' }, { value: 2, name: '中' }, { value: 3, name: '高' }] as const;
const DURATIONS = [15, 30, 60, 90, 120];
type Panel = 'plan' | 'due' | 'priority' | 'course' | null;

/** The days most often meant, as one taps them: today, tomorrow, the day after, this Friday, next Monday. */
function quickDays(today: string) {
    const weekday = weekdayOf(today);
    const friday = addDays(today, (5 - weekday + 7) % 7), monday = addDays(today, 8 - weekday);
    return [{ name: '今天', date: today }, { name: '明天', date: addDays(today, 1) }, { name: '后天', date: addDays(today, 2) },
        ...(friday > addDays(today, 2) ? [{ name: '周五', date: friday }] : []), { name: '下周一', date: monday }];
}

export function TaskSheet({ task, line, top, onClose }: { task: Task; line: Timeline; top?: ReactNode; onClose: () => void }) {
    const now = momentNow();
    const [title, setTitle] = useState(task.title);
    const [note, setNote] = useState(task.note ?? '');
    const [step, setStep] = useState('');
    const [panel, setPanel] = useState<Panel>(null);
    const [slots, setSlots] = useState<TimeSlot[] | null>(null);
    useEffect(() => setTitle(task.title), [task.title]);
    useEffect(() => setSlots(null), [task, line.preferences]);
    const save = (change: Partial<Task>) => saveTask({ ...task, ...change });
    const steps = line.tasks.filter(item => item.parent === task.id);
    const courses = [...new Map(line.meetings.map(meeting => [courseIdentity(meeting), line.names?.[courseIdentity(meeting)] ?? courseName(meeting.course.name)])).entries()];
    const duration = task.start !== undefined && task.end !== undefined ? task.end - task.start : 30;
    const planOn = (date: string) => save({ date, start: task.start ?? 9 * 60, end: task.end ?? (task.start ?? 9 * 60) + duration });
    const suggest = (minutes: number) => setSlots(availableSlots(line, { from: now.date, to: addDays(now.date, 6), minutes, exclude: task.id, due: task.due }, now).slice(0, 6));
    const toggle = (list: number[] | undefined, minutes: number) => list?.includes(minutes) ? list.filter(value => value !== minutes) : [...(list ?? []), minutes].sort((a, b) => a - b);
    const open = (next: Panel) => setPanel(panel === next ? null : next);
    const plan = task.date ? `${dayWord(task.date, now.date)} ${hm(task.start!)}${task.end !== undefined ? `–${hm(task.end)}` : ''}` : '安排时间';
    const due = task.due ? `${dayWord(task.due.date, now.date)}${task.due.time !== undefined ? ` ${hm(task.due.time)}` : ''} 截止` : '截止';
    const late = Boolean(task.due && (task.due.date < now.date || (task.due.date === now.date && (task.due.time ?? 1440) <= now.min)) && !task.done);
    const course = task.course ? courses.find(([id]) => id === task.course)?.[1] : undefined;
    return (
        <Sheet top={top} className={`toned task p${task.priority ?? 0}`} onClose={onClose} title={<span className="ttitle">
            <button className={`tcheck ${task.done ? 'on' : ''}`} aria-label={task.done ? '标为未完成' : '完成'} onClick={() => toggleDone(task)} />
            <input className={task.done ? 'task-done' : ''} value={title} aria-label="任务" onChange={event => setTitle(event.target.value)}
                onBlur={() => title.trim() && title.trim() !== task.title ? save({ title: title.trim() }) : setTitle(task.title)}
                onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }} />
        </span>}>
            <div className="tchips">
                <button className={`${task.date ? 'set' : ''} ${panel === 'plan' ? 'open' : ''}`} onClick={() => open('plan')}>{plan}</button>
                <button className={`${task.due ? 'set' : ''} ${late ? 'late' : ''} ${panel === 'due' ? 'open' : ''}`} onClick={() => open('due')}>{due}</button>
                <button className={`${task.priority ? `set p${task.priority}` : ''} ${panel === 'priority' ? 'open' : ''}`} onClick={() => open('priority')}>{task.priority ? `${PRIORITIES[task.priority].name}优先级` : '优先级'}</button>
                {courses.length > 0 && <button className={`${course ? 'set' : ''} ${panel === 'course' ? 'open' : ''}`} onClick={() => open('course')}>{course ? courseShort(course) : '课程'}</button>}
            </div>
            {panel === 'plan' && <div className="tpanel">
                <div className="picks">{quickDays(now.date).map(day => <button key={day.name} className={task.date === day.date ? 'on' : ''} onClick={() => planOn(day.date)}>{day.name}</button>)}
                    <input className="tf" type="date" aria-label="日期" value={task.date ?? ''} onChange={event => event.target.value && planOn(event.target.value)} /></div>
                {task.date && <>
                    <div className="trow">
                        <label><span>开始</span><input className="tf" type="time" value={hm(task.start!)} onChange={event => { if (!event.target.value) return; const start = minutesOf(event.target.value); save({ start, end: Math.min(1440, start + duration) }); }} /></label>
                        <label><span>用时</span><select className="tf" value={duration} onChange={event => save({ end: Math.min(1440, task.start! + Number(event.target.value)) })}>{[...new Set([...DURATIONS, duration])].sort((a, b) => a - b).map(minutes => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} 分钟` : `${minutes / 60} 小时`}</option>)}</select></label>
                    </div>
                    <span className="tlabel">提醒</span>
                    <div className="picks">{TIMED_REMINDERS.map(item => <button key={item.minutes} className={task.remind?.includes(item.minutes) ? 'on' : ''} onClick={() => save({ remind: toggle(task.remind, item.minutes) })}>{item.name}</button>)}</div>
                </>}
                <div className="picks"><button onClick={() => suggest(duration)}>找一段空闲</button>{task.date && <button onClick={() => save({ date: undefined, start: undefined, end: undefined, remind: undefined })}>不安排时间</button>}</div>
                {slots && <div>{slots.length ? slots.map(slot => <button className="kv" key={`${slot.date}:${slot.start}`} onClick={() => { save({ date: slot.date, start: slot.start, end: slot.end }); setSlots(null); }}>
                    <span className="v">{dayWord(slot.date, now.date)} {hm(slot.start)}–{hm(slot.end)}<small>{slot.penalty ? `与 ${slot.clashes.length} 项“尽量避开”的安排重叠` : '这段时间没有别的安排'}</small></span></button>)
                    : <p className="meta">截止前的七天里没有合适的空闲，可以缩短用时。</p>}</div>}
            </div>}
            {panel === 'due' && <div className="tpanel">
                <div className="picks">{quickDays(now.date).map(day => <button key={day.name} className={task.due?.date === day.date ? 'on' : ''} onClick={() => save({ due: { ...task.due, date: day.date } })}>{day.name}</button>)}
                    <input className="tf" type="date" aria-label="截止日期" value={task.due?.date ?? ''} onChange={event => event.target.value && save({ due: { ...task.due, date: event.target.value } })} /></div>
                {task.due && <>
                    <label className="tline"><span>时间</span><input className="tf" type="time" value={task.due.time !== undefined ? hm(task.due.time) : ''} onChange={event => save({ due: { ...task.due!, time: event.target.value ? minutesOf(event.target.value) : undefined, remind: undefined } })} /><small>留空就是当天结束前</small></label>
                    <span className="tlabel">提醒</span>
                    <div className="picks">{(task.due.time !== undefined ? TIMED_REMINDERS : DAY_REMINDERS).map(({ minutes, name }) => <button key={minutes} className={task.due?.remind?.includes(minutes) ? 'on' : ''} onClick={() => save({ due: { ...task.due!, remind: toggle(task.due?.remind, minutes) } })}>{name}</button>)}</div>
                    <div className="picks"><button onClick={() => save({ due: undefined })}>不设截止</button></div>
                </>}
            </div>}
            {panel === 'priority' && <div className="tpanel"><div className="picks tflags">{PRIORITIES.map(item => <button key={item.value} className={`p${item.value} ${(task.priority ?? 0) === item.value ? 'on' : ''}`} onClick={() => { save({ priority: item.value === 0 ? undefined : item.value }); setPanel(null); }}>{item.name}</button>)}</div></div>}
            {panel === 'course' && <div className="tpanel"><div className="picks">
                <button className={!task.course ? 'on' : ''} onClick={() => { save({ course: undefined }); setPanel(null); }}>不属于哪门课</button>
                {courses.map(([id, name]) => <button key={id} className={task.course === id ? 'on' : ''} onClick={() => { save({ course: id }); setPanel(null); }}>{courseShort(name)}</button>)}
            </div></div>}
            <div className="tsteps">
                {steps.map(item => <div key={item.id} className="tstep">
                    <button className={`tcheck ${item.done ? 'on' : ''}`} aria-label={item.done ? '标为未完成' : '完成'} onClick={() => toggleDone(item)} />
                    <span className={item.done ? 'task-done' : ''}>{item.title}</span>
                    <button className="tskip" aria-label="删除步骤" onClick={() => deleteTask(item.id)}>×</button>
                </div>)}
                <input className="tadd-step" value={step} placeholder="+ 添加步骤" onChange={event => setStep(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter' && step.trim()) { saveTask({ id: newTaskId(), title: step.trim(), parent: task.id }); setStep(''); } }} />
            </div>
            <textarea className="tnote" rows={3} value={note} placeholder="备注" onChange={event => setNote(event.target.value)} onBlur={() => note.trim() !== (task.note ?? '') && save({ note: note.trim() || undefined })} />
            <details className="tmore"><summary>更多</summary>
                <EventChoices line={line} event={{ kind: 'task', id: task.id, date: task.date ?? task.due?.date ?? line.term.weeks[0]!.start, name: task.title, short: task.title, start: task.start ?? 0, end: task.end ?? 1440, room: null, teachers: [], task }} />
            </details>
            <div className="btns">
                <button className="btn danger-text" onClick={() => { deleteTask(task.id); onClose(); }}>删除</button>
                <button className="btn go" onClick={() => { toggleDone(task); if (!task.done) onClose(); }}>{task.done ? '标为未完成' : '完成'}</button>
            </div>
        </Sheet>
    );
}
