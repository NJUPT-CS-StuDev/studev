import { useEffect, useRef, useState } from 'react';
import { loadMaterials } from '@/world/data';
import { kindCounts, MATERIAL_KINDS, materialsOf, type CourseMaterials, type Material } from '@/world/materials';
import { clusters, eventsOn, meetingAround, runTally, sharingSlot, type CampusEvent, type EventKind, type Timeline } from '@/world/events';
import { courseToneStyle, eventTone, timelineTones } from '@/timetable/model/courseColors';
import type { ExamRecord } from '@/world/data';
import { changeLines, changesOf, courseOf, lessonsLeft, publishedOn, sheetName, weeksText } from '@/world/exams';
import { courseName, isRoom, roomLabel, unplaced } from '@/world/names';
import { dateLabel, hm, momentText, WEEKDAYS, weekdayOf, type Moment } from '@/world/time';
import { Chevron, Sheet } from '@/world/ui';
import { TaskSheet } from './TaskSheet';
import { EventChoices } from './EventChoices';
import { labCourseKey } from './model/labs';

const KIND = { class: '课', lab: '实验', exam: '考试', run: '早锻炼', task: '任务' } as const;
const whoLink = (type: string, id: string) => `/?who=${type}:${encodeURI(id)}&scale=week`;
const courseLine = (course: { credits: number | null; nature: string | null; assessment?: string | null } | null) =>
    course ? [course.credits !== null ? `${course.credits} 学分` : null, course.nature, course.assessment ? `考核：${course.assessment}` : null].filter(Boolean).join(' · ') : '';

/** Classes sitting or taught together, folded: "4 个班 · 102 人", open to see which. */
function Together({ label, classes, people }: { label: string; classes: string[]; people: number | null }) {
    if (classes.length < 2 && people === null) return null;
    return (
        <details className="kv together">
            <summary><span className="k">{label}</span><span className="v">{classes.length > 1 ? `${classes.length} 个班` : classes[0]}{people !== null ? ` · ${people} 人` : ''}</span></summary>
            {classes.length > 1 && <p className="meta">{classes.join('、')}</p>}
        </details>
    );
}

/** A material's name as shown: its file's name, with the folder it is in when the file's name alone says little. */
const shownTitle = (title: string) => {
    const parts = title.replace(/\.[a-z0-9]+$/i, '').split(' · ');
    const name = parts.at(-1)!;
    return name.length > 4 || parts.length < 2 ? name : `${parts.at(-2)} ${name}`;
};

/** One kind of material: the newest few, the rest a tap away. */
function Kind({ kind, items }: { kind: string; items: Material[] }) {
    const [all, setAll] = useState(false);
    const shown = all ? items : items.slice(0, 4);
    return <section><h4>{kind}</h4>
        {shown.map(item => <a key={item.url} href={item.url} target="_blank" rel="noreferrer"><span>{shownTitle(item.title)}</span><small>{[item.term, item.ext?.toUpperCase()].filter(Boolean).join(' · ')}</small></a>)}
        {items.length > shown.length && <button className="more" onClick={() => setAll(true)}>还有 {items.length - shown.length} 份</button>}
    </section>;
}

/** What students have shared for the course, folded: "资料 · 试卷 4 · 复习 2", open to see each by kind. */
function Materials({ course }: { course: string }) {
    const [all, setAll] = useState<CourseMaterials[] | null>(null);
    useEffect(() => { let live = true; void loadMaterials().then(list => { if (live) setAll(list); }, () => {}); return () => { live = false; }; }, []);
    const found = all && materialsOf(all, course);
    if (!found) return null;
    return (
        <details className="kv together materials">
            <summary><span className="k">资料</span><span className="v">{kindCounts(found.items).map(([kind, count]) => `${kind} ${count}`).join(' · ')}</span></summary>
            <div className="mat">
                {MATERIAL_KINDS.map(kind => { const items = found.items.filter(item => item.kind === kind); return items.length > 0 && <Kind key={kind} kind={kind} items={items} />; })}
                <p className="meta">同学们整理的南邮历年资料{found.note && <> · <a href={found.note.url} target="_blank" rel="noreferrer">说明</a></>}</p>
            </div>
        </details>
    );
}

/**
 * One thing on the timetable, wherever it was tapped: a lesson, a lab, an exam or 早锻炼. It says what
 * matters for going there and preparing, and links on to the course, the people and the rest.
 */
export function EventSheet({ event, line, now, isMe, record, campus, order, onClose, onOpen, onHide, onSkipExam, onSkipLab, onDropLab, onRename, onUnplan, onPlan, onExams }: {
    event: CampusEvent; line: Timeline; now: Moment; isMe: boolean; record: ExamRecord | null; campus: string | null; order: readonly EventKind[];
    onClose: () => void; onOpen: (event: CampusEvent) => void; onHide: (event: CampusEvent) => void; onSkipExam: (event: CampusEvent) => void;
    onSkipLab: (event: CampusEvent) => void; onDropLab: (event: CampusEvent) => void; onRename: (event: CampusEvent, name: string | null) => void;
    onUnplan: () => void; onPlan: () => void; onExams: () => void;
}) {
    // The sheet is the tile it opened from, enlarged: the same colour. Things on at the same time sit in a strip
    // above it, in the order they are stacked, and switch in place, by a tap or a sideways swipe.
    const tones = timelineTones(line);
    const toneOf = (item: CampusEvent) => { const tone = eventTone(tones, item, line.courseMeetings ?? line.meetings); return tone !== undefined ? courseToneStyle(tone) : undefined; };
    const group = clusters(eventsOn(line, event.date), order).find(item => item.events.some(other => other.id === event.id));
    const together = group && group.events.length > 1 ? [...group.events].sort((left, right) => (right.layer ?? 0) - (left.layer ?? 0) || order.indexOf(left.kind) - order.indexOf(right.kind) || left.start - right.start || (left.id < right.id ? -1 : 1)) : [];
    const at = together.findIndex(item => item.id === event.id);
    const swipe = useRef<number | null>(null);
    const [naming, setNaming] = useState<string | null>(null);
    const strip = together.length > 1 && (
        <div className="sw" role="tablist" aria-label="同时段"
            onPointerDown={pointer => { swipe.current = pointer.clientX; }}
            onPointerUp={pointer => { const from = swipe.current; swipe.current = null; if (from === null || Math.abs(pointer.clientX - from) < 48) return; const next = together[at + (pointer.clientX < from ? 1 : -1)]; if (next) onOpen(next); }}>
            {together.map(item => <button key={item.id} role="tab" aria-selected={item.id === event.id} className={`sw-i ${item.kind} ${item.id === event.id ? 'on' : ''}`} style={toneOf(item)} onClick={() => onOpen(item)}>
                <b>{item.short}</b><small>{KIND[item.kind]} · {hm(item.start)}</small>
            </button>)}
        </div>
    );
    const dress = { top: <>{strip}{isMe && <EventChoices key={event.id} event={event} line={line} />}</>, className: `toned ${event.kind}`, style: toneOf(event) };
    if (event.task) { const task = line.tasks.find(item => item.id === event.task!.id) ?? event.task; return <TaskSheet key={task.id} task={task} line={line} top={strip || undefined} onClose={onClose} />; }
    const when = `${WEEKDAYS[weekdayOf(event.date)]} ${dateLabel(event.date)} · ${hm(event.start)}–${hm(event.end)}`;
    const run = line.run;
    if (event.kind === 'run' && run) {
        const place = run.rule.xianlin;
        return (
            <Sheet title="早锻炼" {...dress} onClose={onClose}>
                <div className="meta">{when}</div>
                {place && <div className="btns"><a className="btn go" href={`/map/?nav=${encodeURI(`仙林/${place.route[0]}`)}`}>去起点</a></div>}
                {place && <div className="kv"><span className="k">路线</span><span className="v">{place.route.join(' ↔ ')}，约 {place.metres} 米</span></div>}
                {place && <div className="kv"><span className="k">刷脸</span><span className="v">起点 {place.start_scan_end} 前，终点 {place.end_scan_end} 前<small>{place.male_minutes === place.female_minutes ? `${place.male_minutes} 分钟内跑完` : `男生 ${place.male_minutes} 分钟、女生 ${place.female_minutes} 分钟内跑完`}</small></span></div>}
                <button className="kv" onClick={onPlan}><span className="k">次数</span><span className="v">{runTally(run, now).count} / {run.rule.required}<small>编排整个学期</small></span><Chevron /></button>
                <button className="kv" onClick={onUnplan}><span className="k" /><span className="v danger">这天没跑</span></button>
            </Sheet>
        );
    }
    const placed = !unplaced(event.room);
    const name = event.room ? roomLabel(event.room) : null;
    const go = placed ? <div className="btns">
        <a className="btn" href={`/map/?place=${encodeURI(event.room!)}&t=${momentText({ date: event.date, min: event.start })}`}>在地图上看</a>
        <a className="btn go" href={`/map/?nav=${encodeURI(event.room!)}`}>去这里</a>
    </div> : <div style={{ height: 12 }} />;
    const teachers = event.teachers.flatMap(teacher => teacher.split('、')).map(teacher => <a key={teacher} className="kv" href={whoLink('teacher', teacher)}><span className="k">老师</span><span className="v">{teacher} 的课表</span><Chevron /></a>);
    const courseTitle = courseName(event.meeting?.course.name ?? event.lab?.course.name ?? event.exam?.course.name ?? event.name);
    const course = <><a className="kv" href={whoLink('course', courseTitle)}><span className="k">课程</span><span className="v">这门课的全部时段</span><Chevron /></a><Materials course={courseTitle} /></>;

    const dayOff = line.holidays.get(event.date);

    if (event.kind === 'lab' && event.lab) {
        const lab = event.lab;
        const facts = courseOf(line.courseMeetings ?? line.meetings, lab);
        return (
            <Sheet title={<><span className="tag lab">实验</span>{event.name}</>} {...dress} onClose={onClose}>
                {facts && <div className="meta">{courseLine({ credits: facts.credits, nature: facts.nature })}</div>}
                <div className="meta strong">{when} · {name ?? lab.place}</div>
                {dayOff && <div className="meta">这天是{dayOff}，实验表照常排了这一次，以老师通知为准</div>}
                {go}
                <div className="kv"><span className="k">项目</span><span className="v">{lab.project}{lab.group !== null && <small>第 {lab.group} 组</small>}</span></div>
                {/排|[（(]/.test(lab.location) && <div className="kv"><span className="k">座位</span><span className="v">{lab.location.replaceAll(',', '、')}</span></div>}
                <Together label="一起上" classes={lab.classes} people={lab.students} />
                {teachers}
                {isRoom(event.room) && <a className="kv" href={whoLink('room', event.room!)}><span className="k">教室</span><span className="v">{name} 的课表</span><Chevron /></a>}
                {course}
                <div className="kv"><span className="k">来源</span><span className="v">{sheetName(lab.source)}<small>实验中心排课表，{dateLabel(publishedOn(lab.source))} 的版本；调整以老师通知为准</small></span></div>
                {isMe && <button className="kv" onClick={() => onSkipLab(event)}><span className="k" /><span className="v danger">不上这次实验</span></button>}
                {isMe && <button className="kv" onClick={() => onDropLab(event)}><span className="k" /><span className="v danger">不上这门实验<small>共 {line.labs.filter(other => labCourseKey(other) === labCourseKey(lab)).length} 次，可在“我 · 实验安排”里恢复</small></span></button>}
            </Sheet>
        );
    }

    if (event.kind === 'exam' && event.exam) {
        const exam = event.exam;
        const facts = courseOf(line.courseMeetings ?? line.meetings, exam);
        const changes = changesOf(record, exam);
        const sheet = record?.sources.find(source => source.file === exam.source);
        return (
            <Sheet title={<><span className="tag">考试</span>{event.name}</>} {...dress} onClose={onClose}>
                {facts && <div className="meta">{courseLine({ credits: facts.credits, nature: facts.nature })}</div>}
                <div className="meta strong">{when} · {name ?? exam.location}{exam.campus && campus && exam.campus !== campus ? ` · ${exam.campus}校区` : ''}</div>
                {go}
                {changes.map(change => <div key={change.observed} className="kv"><span className="k">{change.change === 'added' ? '新发布' : '改过'}</span><span className="v">{dateLabel(change.observed)} 发现{change.change === 'changed' && changeLines(change).map(text => <small key={text}>{text}</small>)}</span></div>)}
                <Together label="同考场" classes={exam.classes} people={exam.students} />
                {exam.note && <div className="kv"><span className="k">备注</span><span className="v">{exam.note}</span></div>}
                {teachers}
                {isRoom(event.room) && <a className="kv" href={whoLink('room', event.room!)}><span className="k">考场</span><span className="v">{name} 的课表</span><Chevron /></a>}
                {course}
                <button className="kv" onClick={onExams}><span className="k">考试</span><span className="v">全部考试 · {new Set(line.exams.map(item => item.course.code ?? item.course.name)).size} 门</span><Chevron /></button>
                {sheet && <div className="kv"><span className="k">来源</span><span className="v">{sheetName(sheet.file)}<small>{dateLabel(publishedOn(sheet.file))} 发布</small></span></div>}
                {isMe && <button className="kv" onClick={() => onSkipExam(event)}><span className="k" /><span className="v danger">不参加这场考试</span></button>}
            </Sheet>
        );
    }

    const meeting = event.meeting;
    const exam = meeting && line.exams.filter(item => (item.course.code ?? item.course.name) === (meeting.course.code ?? meeting.course.name)).sort((left, right) => left.date.localeCompare(right.date))[0];
    const examEvent = exam && eventsOn(line, exam.date).find(item => item.exam?.id === exam.id);
    const left = meeting ? lessonsLeft(line.term, meeting, line.holidays, now, event.end) : 0;
    return (
        <Sheet title={event.name} {...dress} onClose={onClose}>
            {meeting && <div className="meta">{courseLine(meeting.course)}</div>}
            <div className="meta strong">{when}{name ? ` · ${name}` : ' · 课表没写地点'}</div>
            {go}
            {meeting && <div className="kv"><span className="k">周次</span><span className="v">{weeksText(meeting.weeks)}<small>{left ? `还剩 ${left} 次` : '已经上完'}</small></span></div>}
            {meeting && <Together label="合班" classes={meeting.classes} people={meeting.teaching_class.size} />}
            {teachers}
            {isRoom(event.room) && <a className="kv" href={whoLink('room', event.room!)}><span className="k">教室</span><span className="v">{name} 的课表</span><Chevron /></a>}
            {course}
            {sharingSlot(line, event).map(other => (
                <button key={other.id} className="kv" onClick={() => { const found = meetingAround(line, other.id, event.date); if (found) onOpen(found); }}>
                    <span className="k">同时段</span><span className="v">{courseName(other.course.name)}<small>{weeksText(other.weeks)} · 本周不上</small></span><Chevron />
                </button>
            ))}
            {examEvent && <button className="kv" onClick={() => onOpen(examEvent)}><span className="k">考试</span><span className="v">{dateLabel(exam.date)} {WEEKDAYS[weekdayOf(exam.date)]} {exam.start}</span><Chevron /></button>}
            {/* A name of one's own for the course: 板块课 becomes the sport actually taken. One's own course is named where it was added. */}
            {isMe && meeting && !meeting.teaching_class.id.startsWith('custom:') && (naming === null
                ? <button className="kv" onClick={() => setNaming(event.name)}><span className="k">名称</span><span className="v">改名<small>比如把板块课改成具体上的课</small></span><Chevron /></button>
                : <div className="kv rename">
                    <input className="tf" autoFocus value={naming} onChange={change => setNaming(change.target.value)} onKeyDown={key => { if (key.key === 'Enter' && naming.trim()) { onRename(event, naming.trim()); setNaming(null); } }} />
                    <button className="ib" disabled={!naming.trim()} onClick={() => { onRename(event, naming.trim()); setNaming(null); }}>保存</button>
                    <button className="ib" onClick={() => { onRename(event, null); setNaming(null); }}>原名</button>
                </div>)}
            {isMe && <button className="kv" onClick={() => onHide(event)}><span className="k" /><span className="v danger">{meeting?.teaching_class.id.startsWith('custom:') ? '删除这门课' : '从我的课表移除'}</span></button>}
        </Sheet>
    );
}
