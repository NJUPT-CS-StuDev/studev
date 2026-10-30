import { CalendarPlus, Clipboard, EyeOff, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { TeachingMeeting, TeachingPeriod, TeachingWeek } from '@/academics/timetable';
import { buildClassCalendar, downloadCalendar, meetingDate } from '../model/calendar';
import { alternatingWeekLabel, formatWeekNumbers, suspendedWeeks } from '../model/weekPattern';

interface CourseDetailPanelProps {
    className: string;
    meeting: TeachingMeeting;
    week: TeachingWeek;
    weeks: TeachingWeek[];
    periods: TeachingPeriod[];
    tone: number;
    updatedAt: string;
    returnFocus: HTMLElement | null;
    onClose: () => void;
    /** Takes the course out of the visitor's own timetable; null when viewing someone else's class. */
    onRemove: (() => void) | null;
    removeLabel: string;
}

const row = (label: string, value: string | number | null | undefined) => value === null || value === undefined || value === '' ? null : (
    <div className="course-detail-row"><dt>{label}</dt><dd>{value}</dd></div>
);

export function CourseDetailPanel({ className, meeting, week, weeks, periods, tone, updatedAt, returnFocus, onClose, onRemove, removeLabel }: CourseDetailPanelProps) {
    const panelRef = useRef<HTMLElement>(null);
    const dragStart = useRef<number | null>(null);
    const start = periods.find(item => item.period === meeting.periods[0]);
    const end = periods.find(item => item.period === meeting.periods[1]);
    const date = meetingDate(week, meeting.weekday);
    const activeThisWeek = meeting.weeks.includes(week.week);
    const suspended = suspendedWeeks(meeting.weeks);
    const status = activeThisWeek ? '本周上课' : suspended.includes(week.week) ? '本周停课' : `${alternatingWeekLabel(meeting) ?? ''} · 本周不上课`;

    useEffect(() => {
        const panel = panelRef.current;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        panel?.focus();
        const keydown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
            if (event.key !== 'Tab' || !panel) return;
            const focusable = [...panel.querySelectorAll<HTMLElement>('button,[href],[tabindex]:not([tabindex="-1"])')].filter(element => !element.hasAttribute('disabled'));
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        };
        document.addEventListener('keydown', keydown);
        return () => {
            document.removeEventListener('keydown', keydown);
            document.body.style.overflow = previousOverflow;
            returnFocus?.focus();
        };
    }, [onClose, returnFocus]);

    const copy = async () => {
        await navigator.clipboard.writeText([meeting.course.name, `${date} 第${meeting.periods[0]}-${meeting.periods[1]}节`, meeting.location, meeting.teachers.map(t => t.name).join(',')].filter(Boolean).join('\n'));
    };
    const calendar = () => downloadCalendar(`${className}-${meeting.course.name}.ics`, buildClassCalendar(className, [meeting], weeks, periods));

    return (
        <div className="course-detail-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
            <aside
                ref={panelRef}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-labelledby="course-detail-title"
                className={`course-detail-panel course-tone-${tone}`}
                onPointerDown={event => { if ((event.target as HTMLElement).closest('[data-drag-handle]')) dragStart.current = event.clientY; }}
                onPointerUp={event => { if (dragStart.current !== null && event.clientY - dragStart.current > 80) onClose(); dragStart.current = null; }}
            >
                <div className="course-detail-handle" data-drag-handle aria-hidden="true" />
                <header className="course-detail-header">
                    <div><p>课程详情 · {status}</p><h2 id="course-detail-title">{meeting.course.name}</h2></div>
                    <button type="button" onClick={onClose} aria-label="关闭课程详情"><X aria-hidden="true" /></button>
                </header>
                <div className="course-detail-body">
                    <section><h3>课程</h3><dl>{row('课程号', meeting.course.code)}{row('课程类别', meeting.course.category)}{row('课程性质', meeting.course.nature)}{row('学分', meeting.course.credits)}{row('总学时', meeting.course.hours)}{row('课程总学时', meeting.course.hours)}{row('学时组成', meeting.course.hours_composition)}</dl></section>
                    <section><h3>上课安排</h3><dl>{row('上课周次', formatWeekNumbers(meeting.weeks))}{row('停课', suspended.length ? `第${suspended.join('、')}周（原本连续上课，这几周未排课）` : null)}{row('当前选择', `第${week.week}周${activeThisWeek ? '' : `（${status}）`}`)}{row('对应日期', activeThisWeek ? date : null)}{row('星期', `星期${'一二三四五六日'[meeting.weekday - 1]}`)}{row('节次', `第${meeting.periods[0]}-${meeting.periods[1]}节`)}{row('时间', start && end ? `${start.start}–${end.end}` : null)}{row('校区', meeting.campus)}{row('教室', meeting.location)}{row('授课方式', meeting.method)}</dl></section>
                    <section><h3>教学</h3><dl>{row('教师', meeting.teachers.map(t => t.name).join(','))}{row('教师职称', meeting.teachers.map(t => t.title).filter(Boolean).join(','))}{row('主辅讲', meeting.teachers.map(t => t.role).filter(Boolean).join(','))}{row('教学班', meeting.teaching_class.name)}{row('教学班组成', meeting.classes.join('、'))}{row('教学班人数', meeting.teaching_class.size)}{row('选课人数', meeting.teaching_class.enrolled)}{row('最终容量', meeting.teaching_class.capacity)}</dl></section>
                    {(meeting.course.assessment || meeting.course.exam) ? <section><h3>考核</h3><dl>{row('考核方式', meeting.course.assessment)}{row('考试方式', meeting.course.exam)}</dl></section> : null}
                    <section><h3>补充</h3><dl>{row('数据更新时间', updatedAt)}</dl></section>
                </div>
                <footer className="course-detail-actions">
                    <button type="button" onClick={() => void copy()}><Clipboard aria-hidden="true" />复制课程信息</button>
                    <button type="button" onClick={calendar}><CalendarPlus aria-hidden="true" />导出到日历</button>
                    {onRemove ? <button type="button" className="is-quiet" onClick={onRemove}><EyeOff aria-hidden="true" />{removeLabel}</button> : null}
                </footer>
            </aside>
        </div>
    );
}
