import type { Practice, TeachingTerm } from '@/world/facts';
import { weeksText } from '@/world/exams';
import { practiceName, practiceProgress, practiceTeachers } from '@/world/practice';
import { dateLabel } from '@/world/time';
import { Sheet } from '@/world/ui';
import { CourseResources, Teachers } from './EventSheet';

/** One piece of practice coursework: who leads it, which weeks, how far along, and the course's resources. */
export function PracticeSheet({ practice, term, week, onClose }: { practice: Practice; term: TeachingTerm; week: number | null; onClose: () => void }) {
    const name = practiceName(practice);
    const progress = practiceProgress(practice.weeks, week);
    const first = term.weeks.find(item => item.week === Math.min(...practice.weeks));
    const last = term.weeks.find(item => item.week === Math.max(...practice.weeks));
    return (
        <Sheet title={<><span className="tag practice">实践</span>{name}</>} onClose={onClose}>
            <div className="kv"><span className="k">周次</span><span className="v">{weeksText(practice.weeks)}{first && last && <small>{dateLabel(first.start)} – {dateLabel(last.end)}</small>}</span></div>
            <div className="kv"><span className="k">进度</span><span className={`v progress ${progress.state}`}>{progress.text}</span></div>
            <Teachers names={practiceTeachers(practice)} />
            <div className="kv"><span className="k">安排</span><span className="v">不占课表格子<small>具体时间、地点和要求以指导老师的安排为准。</small></span></div>
            <CourseResources course={name.replace(/[“”"]/g, '').replace(/实践$/, '').trim()} />
        </Sheet>
    );
}
