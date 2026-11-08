import { eventsOn, runTally, type CampusEvent, type Timeline } from '@/world/events';
import type { ExamRecord } from '@/world/data';
import { changeLines, changesOf, courseOf, lessonsLeft, publishedOn, sheetName, weeksText } from '@/world/exams';
import { courseName, isRoom, roomLabel, unplaced } from '@/world/names';
import { dateLabel, hm, momentText, WEEKDAYS, weekdayOf, type Moment } from '@/world/time';
import { Chevron, Sheet } from '@/world/ui';

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

/**
 * One thing on the timetable, wherever it was tapped: a lesson, an exam or 早锻炼. It says what
 * matters for going there and preparing, and links on to the course, the people and the rest.
 */
export function EventSheet({ event, line, now, isMe, record, campus, onClose, onOpen, onHide, onSkipExam, onUnplan, onPlan, onExams }: {
    event: CampusEvent; line: Timeline; now: Moment; isMe: boolean; record: ExamRecord | null; campus: string | null;
    onClose: () => void; onOpen: (event: CampusEvent) => void; onHide: (event: CampusEvent) => void; onSkipExam: (event: CampusEvent) => void;
    onUnplan: () => void; onPlan: () => void; onExams: () => void;
}) {
    const when = `${WEEKDAYS[weekdayOf(event.date)]} ${dateLabel(event.date)} · ${hm(event.start)}–${hm(event.end)}`;
    const run = line.run;
    if (event.kind === 'run' && run) {
        const place = run.rule.xianlin;
        return (
            <Sheet title="早锻炼" onClose={onClose}>
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
    const course = <a className="kv" href={whoLink('course', courseName(event.name))}><span className="k">课程</span><span className="v">这门课的全部时段</span><Chevron /></a>;

    if (event.kind === 'exam' && event.exam) {
        const exam = event.exam;
        const facts = courseOf(line.meetings, exam);
        const changes = changesOf(record, exam);
        const sheet = record?.sources.find(source => source.file === exam.source);
        return (
            <Sheet title={<><span className="tag">考试</span>{event.name}</>} onClose={onClose}>
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
        <Sheet title={event.name} onClose={onClose}>
            {meeting && <div className="meta">{courseLine(meeting.course)}</div>}
            <div className="meta strong">{when}{name ? ` · ${name}` : ' · 课表没写地点'}</div>
            {go}
            {meeting && <div className="kv"><span className="k">周次</span><span className="v">{weeksText(meeting.weeks)}<small>{left ? `还剩 ${left} 次` : '已经上完'}</small></span></div>}
            {meeting && <Together label="合班" classes={meeting.classes} people={meeting.teaching_class.size} />}
            {teachers}
            {isRoom(event.room) && <a className="kv" href={whoLink('room', event.room!)}><span className="k">教室</span><span className="v">{name} 的课表</span><Chevron /></a>}
            {course}
            {examEvent && <button className="kv" onClick={() => onOpen(examEvent)}><span className="k">考试</span><span className="v">{dateLabel(exam.date)} {WEEKDAYS[weekdayOf(exam.date)]} {exam.start}</span><Chevron /></button>}
            {isMe && <button className="kv" onClick={() => onHide(event)}><span className="k" /><span className="v danger">从我的课表移除</span></button>}
        </Sheet>
    );
}
