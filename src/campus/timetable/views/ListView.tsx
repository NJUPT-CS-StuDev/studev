// The same line as a list: one's tasks by when they are due, with the exams among them, since an exam is the
// hardest deadline there is. A task is added here in one line, its day and time read from what is typed.
import { useState } from 'react';
import { upcomingExams, type CampusEvent, type Timeline } from '@/world/events';
import { eventsOn } from '@/world/events';
import { courseName, roomLabel } from '@/world/names';
import { newTaskId, parseQuickTask, saveTask, taskGroup, taskOrder, TASK_GROUPS, toggleDone, type Task, type TaskGroup } from '@/world/tasks';
import { dateLabel, daysBetween, hm, minutesOf, WEEKDAYS, weekdayOf, type Moment } from '@/world/time';
import { Chevron } from '@/world/ui';

const examGroup = (date: string, now: Moment): TaskGroup => {
    const days = daysBetween(now.date, date);
    return days === 0 ? 'today' : days === 1 ? 'tomorrow' : days <= 7 ? 'week' : 'later';
};
const when = (task: Task, now: Moment) => {
    const day = (date: string) => daysBetween(now.date, date) === 0 ? '今天' : daysBetween(now.date, date) === 1 ? '明天' : `${dateLabel(date)} ${WEEKDAYS[weekdayOf(date)]}`;
    return [task.date ? `计划 ${day(task.date)} ${task.start !== undefined ? hm(task.start) : ''}${task.end !== undefined ? `–${hm(task.end)}` : ''}` : '',
        task.due ? `截止 ${day(task.due.date)} ${task.due.time !== undefined ? hm(task.due.time) : '当天结束'}` : ''].filter(Boolean).join(' · ');
};

export function ListView({ line, now, courses, onTask, onOpen }: { line: Timeline; now: Moment; courses: Map<string, string>; onTask: (task: Task) => void; onOpen: (event: CampusEvent) => void }) {
    const [draft, setDraft] = useState('');
    const [showDone, setShowDone] = useState(false);
    const top = line.tasks.filter(task => !task.parent);
    const open = top.filter(task => !task.done).sort(taskOrder);
    const done = top.filter(task => task.done).sort((left, right) => (right.done ?? '').localeCompare(left.done ?? ''));
    const exams = upcomingExams(line, now.date).map(({ exam }) => exam);
    const steps = (task: Task) => line.tasks.filter(item => item.parent === task.id);
    const add = () => {
        const parsed = parseQuickTask(draft, now);
        if (!parsed.title) return;
        saveTask({ id: newTaskId(), ...parsed });
        setDraft('');
    };
    const row = (task: Task) => {
        const parts = steps(task);
        return (
            <div key={task.id} className={`trow-i p${task.priority ?? 0}`}>
                <button className={`tcheck ${task.done ? 'on' : ''}`} aria-label={task.done ? '标为未完成' : '完成'} onClick={() => toggleDone(task)} />
                <button className="tmain" onClick={() => onTask(task)}>
                    <b className={task.done ? 'task-done' : ''}>{task.title}</b>
                    <small>{[when(task, now), task.course ? courses.get(task.course) : '', parts.length ? `步骤 ${parts.filter(item => item.done).length}/${parts.length}` : '', task.note ? '有备注' : ''].filter(Boolean).join(' · ')}</small>
                </button>
                <Chevron />
            </div>
        );
    };
    return (
        <div className="tlist">
            <div className="sfield tadd">
                <input value={draft} placeholder="添加任务，如：明天 14:00 交毛概作业" aria-label="添加任务" onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') add(); }} />
                {draft.trim() && <button className="ib" onClick={add}>添加</button>}
            </div>
            {TASK_GROUPS.map(({ key, name }) => {
                const tasks = open.filter(task => taskGroup(task, now) === key);
                const dated = key === 'overdue' || key === 'someday' ? [] : exams.filter(exam => examGroup(exam.date, now) === key);
                if (!tasks.length && !dated.length) return null;
                return (
                    <section key={key} className={`tgroup ${key}`}>
                        <h3 className="sh">{name}<span>{tasks.length + dated.length}</span></h3>
                        {dated.map(exam => {
                            const event = eventsOn(line, exam.date).find(item => item.exam?.id === exam.id);
                            return <button key={exam.id} className="trow-i exam" onClick={() => event && onOpen(event)}>
                                <span className="tag">考试</span>
                                <span className="tmain"><b>{courseName(exam.course.name)}</b><small>{dateLabel(exam.date)} {WEEKDAYS[weekdayOf(exam.date)]} {hm(minutesOf(exam.start))} · {roomLabel(exam.room ?? exam.location)}</small></span>
                                <Chevron />
                            </button>;
                        })}
                        {tasks.map(row)}
                    </section>
                );
            })}
            {!open.length && !exams.length && <p className="empty">没有要做的事。在上面输入一件，回车就加上了。</p>}
            {done.length > 0 && <section className="tgroup done">
                <button className="sh tdone-h" onClick={() => setShowDone(!showDone)}>已完成 {done.length} 项 <Chevron /></button>
                {showDone && done.map(row)}
            </section>}
        </div>
    );
}
