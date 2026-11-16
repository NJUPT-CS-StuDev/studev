// The editor for a personal course, reached from the same course list as teaching-office courses.
import { useState } from 'react';
import { newTaskId } from '@/world/tasks';
import { updateTimetableEdits } from '@/world/preferences';
import { WEEKDAYS } from '@/world/time';
import { Sheet, TextAction } from '@/world/ui';
import { parseWeeks, type CustomCourse } from './model/courses';

export function CustomCourses({ term, weeks, periods, initial, onClose }: { term: string; weeks: number; periods: number; initial?: CustomCourse; onClose: () => void }) {
    const [name, setName] = useState(initial?.name ?? '');
    const [days, setDays] = useState<number[]>(initial?.days ?? [1]);
    const [from, setFrom] = useState(initial?.periods[0] ?? 1);
    const [to, setTo] = useState(initial?.periods[1] ?? 2);
    const [weekText, setWeekText] = useState(initial?.weeks.join(',') ?? `1-${weeks}`);
    const [room, setRoom] = useState(initial?.room ?? '');
    const [teacher, setTeacher] = useState(initial?.teacher ?? '');
    const parsed = parseWeeks(weekText, weeks);
    const ready = name.trim() && days.length && parsed && from <= to;
    const add = () => {
        if (!ready) return;
        const course: CustomCourse = { id: initial?.id ?? newTaskId(), name: name.trim(), days: [...days].sort(), periods: [from, to], weeks: parsed!, ...(room.trim() ? { room: room.trim() } : {}), ...(teacher.trim() ? { teacher: teacher.trim() } : {}) };
        updateTimetableEdits(term, current => ({ ...current, custom: initial ? (current.custom ?? []).map(item => item.id === initial.id ? course : item) : [...(current.custom ?? []), course] }));
        onClose();
    };
    const toggleDay = (day: number) => setDays(current => current.includes(day) ? current.filter(item => item !== day) : [...current, day]);
    return (
        <Sheet title={initial ? '编辑课程' : '自定义课程'} onClose={onClose}>
            <label className="course-field">课程名称<input className="tf" maxLength={60} value={name} placeholder="如：金工实习" onChange={event => setName(event.target.value)} /></label>
            <p className="fine lead">上课日</p>
            <div className="picks">{[1, 2, 3, 4, 5, 6, 7].map(day => <button key={day} className={days.includes(day) ? 'on' : ''} onClick={() => toggleDay(day)}>{WEEKDAYS[day]}</button>)}</div>
            <div className="trow">
                <label><span>从第几节</span><select className="tf" value={from} onChange={event => { const value = Number(event.target.value); setFrom(value); if (to < value) setTo(value); }}>{Array.from({ length: periods }, (_, at) => <option key={at} value={at + 1}>{at + 1}</option>)}</select></label>
                <label><span>到第几节</span><select className="tf" value={to} onChange={event => setTo(Number(event.target.value))}>{Array.from({ length: periods }, (_, at) => <option key={at} value={at + 1} disabled={at + 1 < from}>{at + 1}</option>)}</select></label>
            </div>
            <div className="trow">
                <label><span>周次（如 1-16、单1-15、3,5,7）</span><input className="tf" value={weekText} onChange={event => setWeekText(event.target.value)} /></label>
                <label><span>地点（可不填）</span><input className="tf" value={room} onChange={event => setRoom(event.target.value)} /></label>
            </div>
            <label className="course-field">教师（选填）<input className="tf" value={teacher} maxLength={40} onChange={event => setTeacher(event.target.value)} /></label>
            {!parsed && <p className="fine" role="alert">请填写有效周次，如 1-16 或 单1-15，范围为 1–{weeks} 周。</p>}
            <div className="btns form-actions"><TextAction muted onClick={onClose}>取消</TextAction><button className="btn go" disabled={!ready} onClick={add}>{initial ? '保存修改' : '添加课程'}</button></div>
        </Sheet>
    );
}
