import { catalogId } from '@/timetable/model/courseCatalog';
import { Check, Plus } from 'lucide-react';
import type { TeachingMeeting } from '@/academics/timetable';
import type { CatalogCourse } from '../model/courseCatalog';
import { formatWeekNumbers, suspendedWeeks } from '../model/weekPattern';

const weekday = (day: number) => `周${'一二三四五六日'[day - 1] ?? day}`;

export const meetingLine = (meeting: TeachingMeeting): string => [
    `${weekday(meeting.weekday)} ${meeting.periods[0]}–${meeting.periods[1]}节`,
    meeting.location?.replace(/－/g, '-') ?? '地点未定',
    formatWeekNumbers(meeting.weeks),
].join(' · ');

export const suspensionNote = (meetings: TeachingMeeting[]): string | null => {
    const weeks = [...new Set(meetings.flatMap(meeting => suspendedWeeks(meeting.weeks)))].sort((left, right) => left - right);
    return weeks.length ? `第${weeks.join('、')}周停课` : null;
};

interface CourseResultsProps {
    courses: CatalogCourse[];
    /** Teaching classes already in the visitor's timetable. */
    inTimetable: Set<string>;
    onAdd: (course: CatalogCourse) => void;
    onRemove: (course: CatalogCourse) => void;
}

/** Teaching classes found by course search, each with its weekly meetings. */
export function CourseResults({ courses, inTimetable, onAdd, onRemove }: CourseResultsProps) {
    return (
        <ul className="course-results">
            {courses.map(course => {
                const added = inTimetable.has(catalogId(course));
                const suspended = suspensionNote(course.meetings);
                return (
                    <li key={catalogId(course)} className="course-result">
                        <div className="course-result-main">
                            <p className="course-result-title">
                                <strong>{course.meetings[0]!.course.name}</strong>
                                {course.meetings[0]!.course.code ? <span>{course.meetings[0]!.course.code}</span> : null}
                                {course.meetings[0]!.course.credits !== null ? <span>{course.meetings[0]!.course.credits} 学分</span> : null}
                            </p>
                            <p className="course-result-teacher">{[...new Set(course.meetings.flatMap(m => m.teachers.map(t => t.name)))].join('、') || '教师未定'}{course.meetings[0]!.campus ? ` · ${course.meetings[0]!.campus}` : ''}</p>
                            <ul className="course-result-meetings">
                                {course.meetings.map(meeting => <li key={meeting.id}>{meetingLine(meeting)}</li>)}
                            </ul>
                            {suspended ? <p className="course-result-flag">{suspended}</p> : null}
                            {course.meetings[0]!.classes.length ? <p className="course-result-classes">教学班：{course.meetings[0]!.classes.slice(0, 6).join('、')}{course.meetings[0]!.classes.length > 6 ? ` 等 ${course.meetings[0]!.classes.length} 个班` : ''}</p> : null}
                        </div>
                        <button
                            type="button"
                            className={added ? 'is-added' : ''}
                            onClick={() => added ? onRemove(course) : onAdd(course)}
                            aria-label={`${added ? '移出' : '加入'}我的课表：${course.meetings[0]!.course.name} ${[...new Set(course.meetings.flatMap(m => m.teachers.map(t => t.name)))].join('、')}`}
                        >
                            {added ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
                            {added ? '已加入' : '加入'}
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}
