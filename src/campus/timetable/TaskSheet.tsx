// One's own task, opened from the list or the timeline: everything about it is changed in place and kept at once.
import { useState, type ReactNode } from 'react';
import { courseIdentity } from '@/timetable/model/courseColors';
import type { Timeline } from '@/world/events';
import { courseName } from '@/world/names';
import { DAY_REMINDERS, deleteTask, newTaskId, saveTask, TIMED_REMINDERS, toggleDone, type Task } from '@/world/tasks';
import { hm, minutesOf } from '@/world/time';
import { Sheet } from '@/world/ui';

const PRIORITIES = [{ value: 0, name: '无' }, { value: 1, name: '低' }, { value: 2, name: '中' }, { value: 3, name: '高' }] as const;

export function TaskSheet({ task, line, top, onClose }: { task: Task; line: Timeline; top?: ReactNode; onClose: () => void }) {
    const [title, setTitle] = useState(task.title);
    const [note, setNote] = useState(task.note ?? '');
    const [step, setStep] = useState('');
    const save = (change: Partial<Task>) => saveTask({ ...task, ...change });
    const steps = line.tasks.filter(item => item.parent === task.id);
    const courses = [...new Map(line.meetings.map(meeting => [courseIdentity(meeting), courseName(meeting.course.name)])).entries()];
    const timed = task.start !== undefined;
    const reminders = timed ? TIMED_REMINDERS : DAY_REMINDERS;
    const toggleReminder = (minutes: number) => save({ remind: task.remind?.includes(minutes) ? task.remind.filter(value => value !== minutes) : [...(task.remind ?? []), minutes].sort((a, b) => a - b) });
    return (
        <Sheet title={<span className={task.done ? 'task-done' : ''}>{task.title}</span>} top={top} className={`toned task p${task.priority ?? 0}`} onClose={onClose}>
            <div className="tfields">
                <input className="tf big" value={title} aria-label="任务" onChange={event => setTitle(event.target.value)} onBlur={() => title.trim() && title.trim() !== task.title && save({ title: title.trim() })}
                    onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }} />
                <div className="trow">
                    <label><span>日期</span><input className="tf" type="date" value={task.date ?? ''} onChange={event => save(event.target.value ? { date: event.target.value } : { date: undefined, start: undefined, end: undefined })} /></label>
                    {task.date && <label><span>开始</span><input className="tf" type="time" value={timed ? hm(task.start!) : ''} onChange={event => save(event.target.value ? { start: minutesOf(event.target.value), remind: undefined } : { start: undefined, end: undefined, remind: undefined })} /></label>}
                    {timed && <label><span>结束</span><input className="tf" type="time" value={task.end !== undefined ? hm(task.end) : ''} onChange={event => { const end = event.target.value ? minutesOf(event.target.value) : undefined; save({ end: end !== undefined && end > task.start! ? end : undefined }); }} /></label>}
                </div>
            </div>
            {task.date && <>
                <h3 className="sh gap">提醒{timed ? '' : ' · 当天截止的任务在这些时刻提醒'}</h3>
                <div className="picks">{reminders.map(item => <button key={item.minutes} className={task.remind?.includes(item.minutes) ? 'on' : ''} onClick={() => toggleReminder(item.minutes)}>{item.name}</button>)}</div>
            </>}
            <h3 className="sh gap">优先级</h3>
            <div className="picks">{PRIORITIES.map(item => <button key={item.value} className={(task.priority ?? 0) === item.value ? 'on' : ''} onClick={() => save({ priority: item.value === 0 ? undefined : item.value })}>{item.name}</button>)}</div>
            {courses.length > 0 && <>
                <h3 className="sh gap">课程</h3>
                <select className="tf" value={task.course ?? ''} onChange={event => save({ course: event.target.value || undefined })}>
                    <option value="">不属于哪门课</option>
                    {courses.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
            </>}
            <h3 className="sh gap">步骤</h3>
            {steps.map(item => <div key={item.id} className="kv tstep">
                <button className={`tcheck ${item.done ? 'on' : ''}`} aria-label={item.done ? '标为未完成' : '完成'} onClick={() => toggleDone(item)} />
                <span className={`v ${item.done ? 'task-done' : ''}`}>{item.title}</span>
                <button className="ib" aria-label="删除步骤" onClick={() => deleteTask(item.id)}>删除</button>
            </div>)}
            <input className="tf" value={step} placeholder="加一个步骤，回车" onChange={event => setStep(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter' && step.trim()) { saveTask({ id: newTaskId(), title: step.trim(), parent: task.id }); setStep(''); } }} />
            <h3 className="sh gap">备注</h3>
            <textarea className="tf" rows={3} value={note} onChange={event => setNote(event.target.value)} onBlur={() => note.trim() !== (task.note ?? '') && save({ note: note.trim() || undefined })} />
            <div className="btns">
                <button className="btn" onClick={() => { deleteTask(task.id); onClose(); }}>删除</button>
                <button className="btn go" onClick={() => toggleDone(task)}>{task.done ? '标为未完成' : '完成'}</button>
            </div>
        </Sheet>
    );
}
