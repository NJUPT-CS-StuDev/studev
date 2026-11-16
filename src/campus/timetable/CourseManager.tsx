import { useEffect, useMemo, useState } from 'react';
import { loadClassMeetings, loadMeetings } from '@/world/data';
import type { Lab, TeachingMeeting, TeachingPeriod, TeachingTerm } from '@/world/facts';
import { timetableEdits, updateTimetableEdits, type Preferences } from '@/world/preferences';
import { courseName, roomLabel } from '@/world/names';
import { dateLabel, WEEKDAYS } from '@/world/time';
import { weeksText } from '@/world/exams';
import { Chevron, Sheet, TextAction } from '@/world/ui';
import { courseIdentity, sameCourse } from './model/courseColors';
import { managedCourses, type CustomCourse } from './model/courses';
import { CourseResources } from './EventSheet';
import { CustomCourses } from './CustomCourses';

const sources = { class: '班级课表', added: '从全校课程添加', custom: '自行添加' };

export function CourseManager({ term, periods, prefs, labs, onLabs, onClose }: { term: TeachingTerm; periods: TeachingPeriod[]; prefs: Preferences; labs: Lab[]; onLabs: () => void; onClose: () => void }) {
    const edits = timetableEdits(prefs, term.term);
    const [rows, setRows] = useState<{ own: TeachingMeeting[]; all: TeachingMeeting[] } | null>(null);
    const [failed, setFailed] = useState(false);
    const [retry, setRetry] = useState(0);
    const [selected, setSelected] = useState<string | null>(null);
    const [hidden, setHidden] = useState(false);
    const [editing, setEditing] = useState<CustomCourse | 'new' | null>(null);
    const [naming, setNaming] = useState<string | null>(null);
    const addedKey = edits.added.join('\n');
    useEffect(() => {
        let live = true; setRows(null); setFailed(false);
        void Promise.all([prefs.class ? loadClassMeetings(prefs.class) : Promise.resolve([]), edits.added.length ? loadMeetings() : Promise.resolve([])])
            .then(([own, all]) => { if (live) setRows({ own, all }); }, () => { if (live) setFailed(true); });
        return () => { live = false; };
    }, [prefs.class, addedKey, retry]);
    const courses = useMemo(() => rows ? managedCourses(rows.own, rows.all, edits) : [], [rows, edits]);
    const picked = courses.find(course => course.id === selected);
    const titleOf = (course: typeof courses[number]) => course.custom?.name ?? edits.names?.[courseIdentity(course.meetings[0]!)] ?? courseName(course.meetings[0]!.course.name);
    const leaveDetail = () => { setSelected(null); setNaming(null); };
    if (editing) return <CustomCourses key={editing === 'new' ? 'new' : editing.id} term={term.term} weeks={term.weeks.length} periods={periods.length} initial={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />;
    if (picked) {
        const first = picked.meetings[0]!;
        const linkedLabs = labs.filter(lab => sameCourse(lab, first));
        const changeName = (name: string | null) => {
            updateTimetableEdits(term.term, current => {
                const names = { ...current.names }, id = courseIdentity(first);
                if (name?.trim()) names[id] = name.trim(); else delete names[id];
                return { ...current, names: Object.keys(names).length ? names : undefined };
            }); setNaming(null);
        };
        const remove = () => {
            updateTimetableEdits(term.term, current => picked.source === 'custom'
                ? { ...current, custom: (current.custom ?? []).filter(course => `custom:${course.id}` !== picked.id) }
                : picked.source === 'added' ? { ...current, added: current.added.filter(id => id !== picked.id) }
                    : { ...current, hidden: [...new Set([...current.hidden, picked.id])] });
            leaveDetail();
        };
        return <Sheet title={titleOf(picked)} top={<button className="back" onClick={leaveDetail}>‹ 我的课程</button>} onClose={leaveDetail}>
            <p className="meta">{sources[picked.source]}{picked.hidden ? ' · 已隐藏' : ''}</p>
            <h3 className="sh">上课安排</h3>
            {picked.meetings.map(meeting => {
                const start = periods.find(period => period.period === meeting.periods[0])?.start;
                const end = periods.find(period => period.period === meeting.periods[1])?.end;
                return <div className="kv" key={meeting.id}><span className="v">{WEEKDAYS[meeting.weekday]} · 第 {meeting.periods[0]}{meeting.periods[0] === meeting.periods[1] ? '' : `–${meeting.periods[1]}`} 节{start && end ? ` · ${start}–${end}` : ''}<small>{weeksText(meeting.weeks)} · {meeting.room ? roomLabel(meeting.room) : meeting.location || '地点未定'}</small><small>{meeting.teachers.map(teacher => teacher.name).join('、') || '教师未定'}</small></span></div>;
            })}
            <CourseResources code={first.course.code} course={courseName(first.course.name)} />
            {linkedLabs.length > 0 && <><h3 className="sh">关联实验 · {linkedLabs.length} 次</h3>{linkedLabs.map(lab => <div className="kv" key={lab.id}><span className="v">{lab.project}<small>{dateLabel(lab.date)} {lab.start}–{lab.end} · {lab.room ? roomLabel(lab.room) : lab.place}</small></span></div>)}<button className="kv" onClick={onLabs}><span className="v">管理实验安排</span><Chevron /></button></>}
            {picked.custom ? <button className="btn wide" onClick={() => setEditing(picked.custom!)}>编辑课程</button> : naming === null
                ? <button className="kv" onClick={() => setNaming(titleOf(picked))}><span className="v">编辑名称</span><Chevron /></button>
                : <><div className="kv rename"><input className="tf" aria-label="课程显示名称" maxLength={60} value={naming} onChange={event => setNaming(event.target.value)} /><TextAction disabled={!naming.trim() || naming.trim() === titleOf(picked)} onClick={() => changeName(naming)}>保存名称</TextAction></div><TextAction muted onClick={() => setNaming(null)}>取消</TextAction>{edits.names?.[courseIdentity(first)] && <TextAction muted onClick={() => changeName(null)}>恢复原名</TextAction>}</>}
            {picked.hidden ? <button className="btn wide" onClick={() => { updateTimetableEdits(term.term, current => ({ ...current, hidden: current.hidden.filter(id => id !== picked.id) })); leaveDetail(); }}>恢复到课表</button>
                : <button className="kv" onClick={remove}><span className="v danger">{picked.source === 'class' ? '从我的课表隐藏' : '移除这门课'}</span></button>}
        </Sheet>;
    }
    return <Sheet title="我的课程" onClose={onClose}>
        <div className="btns"><a className="btn" href="/search/?scope=course">从全校课程添加</a><button className="btn go" onClick={() => setEditing('new')}>自定义课程</button></div>
        <div className="choice course-filter">{[[false, '已显示'], [true, '已隐藏']].map(([value, label]) => <button key={String(value)} className={hidden === value ? 'on' : ''} onClick={() => setHidden(Boolean(value))}>{label}</button>)}</div>
        {failed ? <div className="empty"><p>课程暂时无法加载</p><TextAction refresh onClick={() => setRetry(value => value + 1)}>重试</TextAction></div> : !rows ? <p className="fine" aria-busy="true">正在加载课程…</p>
            : <>{courses.filter(course => course.hidden === hidden).map(course => <button className="kv" key={course.id} aria-label={`查看课程详情：${titleOf(course)}`} onClick={() => setSelected(course.id)}><span className="v">{titleOf(course)}<small>{[...new Set(course.meetings.flatMap(meeting => meeting.teachers.map(teacher => teacher.name)))].join('、') || sources[course.source]} · {course.meetings.length} 项安排{edits.names?.[courseIdentity(course.meetings[0]!)] ? ' · 已改名' : ''}</small></span><Chevron /></button>)}{!courses.some(course => course.hidden === hidden) && <p className="empty">{hidden ? '没有隐藏的课程' : '还没有课程，可以选择班级或添加课程。'}</p>}</>}
    </Sheet>;
}
