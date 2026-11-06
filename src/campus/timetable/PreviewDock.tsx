import type { TeachingMeeting } from '@/world/facts';
import { courseName, courseShort } from '@/world/names';
import { WEEKDAYS } from '@/world/time';

/** A course laid over the timetable before it is added, with any clash named. */
export function PreviewDock({ rows, mine, week, added, onCancel, onAdd }: { rows: TeachingMeeting[]; mine: TeachingMeeting[]; week: number | null; added: boolean; onCancel: () => void; onAdd: () => void }) {
    const overlaps = (left: TeachingMeeting, right: TeachingMeeting) => left.weekday === right.weekday && left.teaching_class.id !== right.teaching_class.id && left.periods[0] <= right.periods[1] && right.periods[0] <= left.periods[1];
    const clashes = rows.flatMap(row => mine.filter(other => overlaps(row, other) && other.weeks.some(item => row.weeks.includes(item))));
    const inThisWeek = clashes.find(other => week !== null && other.weeks.includes(week));
    const first = inThisWeek ?? clashes[0];
    const slots = [...new Set(rows.map(row => `${WEEKDAYS[row.weekday]} ${row.periods[0]}–${row.periods[1]} 节`))].slice(0, 3).join('，');
    return (
        <div className="dock">
            <div className="m">{courseName(rows[0]!.course.name)}
                <small className={first ? 'clash' : ''}>{first ? `与${courseShort(first.course.name)}时间冲突` : `${rows[0]!.teachers.map(teacher => teacher.name).join(' ')} · ${slots}`}</small>
            </div>
            <button className="btn" onClick={onCancel}>取消</button>
            <button className="btn ink" disabled={added} onClick={onAdd}>{added ? '已加入' : '加入课表'}</button>
        </div>
    );
}
