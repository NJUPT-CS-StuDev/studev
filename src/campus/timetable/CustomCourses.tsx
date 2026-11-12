// Courses of one's own: what the teaching office's timetable does not have (an elective it misses, a practical
// that takes a week), added by hand and kept on this device.
import { useState } from 'react';
import { newTaskId } from '@/world/tasks';
import { updateTimetableEdits, type TimetableEdits } from '@/world/preferences';
import { WEEKDAYS } from '@/world/time';
import { Sheet } from '@/world/ui';
import { parseWeeks, type CustomCourse } from './model/courses';
import { weeksText } from '@/world/exams';

export function CustomCourses({ term, weeks, periods, edits, onClose }: { term: string; weeks: number; periods: number; edits: TimetableEdits; onClose: () => void }) {
    const [name, setName] = useState('');
    const [days, setDays] = useState<number[]>([1]);
    const [from, setFrom] = useState(1);
    const [to, setTo] = useState(2);
    const [weekText, setWeekText] = useState(`1-${weeks}`);
    const [room, setRoom] = useState('');
    const parsed = parseWeeks(weekText, weeks);
    const ready = name.trim() && days.length && parsed && from <= to;
    const add = () => {
        if (!ready) return;
        const course: CustomCourse = { id: newTaskId(), name: name.trim(), days: [...days].sort(), periods: [from, to], weeks: parsed!, ...(room.trim() ? { room: room.trim() } : {}) };
        updateTimetableEdits(term, current => ({ ...current, custom: [...(current.custom ?? []), course] }));
        setName(''); setRoom('');
    };
    const remove = (id: string) => updateTimetableEdits(term, current => ({ ...current, custom: (current.custom ?? []).filter(course => course.id !== id) }));
    const toggleDay = (day: number) => setDays(current => current.includes(day) ? current.filter(item => item !== day) : [...current, day]);
    return (
        <Sheet title="自己的课" onClose={onClose}>
            <p className="fine lead">教务课表里没有的课：任选课、实验、占一整周的实习。加在这里的课和其他课一样显示、提醒、写进日历，只存在本机。</p>
            {(edits.custom ?? []).map(course => <div key={course.id} className="kv">
                <span className="v">{course.name}<small>{course.days.map(day => WEEKDAYS[day]).join('、')} {course.periods[0] === course.periods[1] ? `第 ${course.periods[0]} 节` : `${course.periods[0]}–${course.periods[1]} 节`} · {weeksText(course.weeks)}{course.room ? ` · ${course.room}` : ''}</small></span>
                <button className="ib" onClick={() => remove(course.id)}>删除</button>
            </div>)}
            <h3 className="sh gap">加一门</h3>
            <input className="tf" value={name} placeholder="课名，如：金工实习" onChange={event => setName(event.target.value)} />
            <div className="picks">{[1, 2, 3, 4, 5, 6, 7].map(day => <button key={day} className={days.includes(day) ? 'on' : ''} onClick={() => toggleDay(day)}>{WEEKDAYS[day]}</button>)}</div>
            <div className="trow">
                <label><span>从第几节</span><select className="tf" value={from} onChange={event => { const value = Number(event.target.value); setFrom(value); if (to < value) setTo(value); }}>{Array.from({ length: periods }, (_, at) => <option key={at} value={at + 1}>{at + 1}</option>)}</select></label>
                <label><span>到第几节</span><select className="tf" value={to} onChange={event => setTo(Number(event.target.value))}>{Array.from({ length: periods }, (_, at) => <option key={at} value={at + 1} disabled={at + 1 < from}>{at + 1}</option>)}</select></label>
            </div>
            <div className="trow">
                <label><span>周次（如 1-16、单1-15、3,5,7）</span><input className="tf" value={weekText} onChange={event => setWeekText(event.target.value)} /></label>
                <label><span>地点（可不填）</span><input className="tf" value={room} onChange={event => setRoom(event.target.value)} /></label>
            </div>
            {!parsed && <p className="fine">周次写不出来，例如 1-16 或 单1-15。</p>}
            <div className="btns"><button className="btn go wide" disabled={!ready} onClick={add}>加上</button></div>
        </Sheet>
    );
}
