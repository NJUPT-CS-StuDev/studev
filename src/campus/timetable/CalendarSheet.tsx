// The timetable as a calendar file, written here from this person's own timetable. Keeping a
// calendar up to date afterwards is what the Android app does.
import { useState } from 'react';
import { writePreferences, type Preferences } from '@/world/preferences';
import { loadCalendar } from '@/world/data';
import type { Timeline } from '@/world/events';
import { Sheet, Toggle } from '@/world/ui';
import { CALENDARS, DEFAULT_EXAM_REMINDERS, EXAM_REMINDERS, calendarFile, daysOffEntries, downloadCalendar, examEntries, lessonEntries, runEntries, type CalendarKind, type ExamReminder } from './model/calendar';

export function CalendarSheet({ line, className, prefs, onClose }: { line: Timeline; className: string; prefs: Preferences; onClose: () => void }) {
    const kinds = CALENDARS.filter(({ kind }) => kind !== 'run' || line.run);
    const [picked, setPicked] = useState<CalendarKind[]>(kinds.map(({ kind }) => kind));
    const reminders = (prefs.examReminders ?? DEFAULT_EXAM_REMINDERS).filter((key): key is ExamReminder => EXAM_REMINDERS.some(item => item.key === key));
    const toggleReminder = (key: ExamReminder) => writePreferences(current => ({ ...current, examReminders: EXAM_REMINDERS.map(item => item.key).filter(item => (item === key) !== reminders.includes(item)) }));
    const download = async () => {
        const entries = [
            ...(picked.includes('lessons') ? [...lessonEntries(line), ...daysOffEntries(await loadCalendar())] : []),
            ...(picked.includes('exams') ? examEntries(line.exams, reminders) : []),
            ...(picked.includes('run') && line.run ? runEntries(line.run) : []),
        ];
        downloadCalendar(`StuDev ${className}.ics`, calendarFile(`StuDev ${className}`, entries, new Date()));
    };
    return (
        <Sheet title="下载到日历" onClose={onClose}>
            <p className="fine lead">按你现在的课表写，包括隐藏和添加的课、不参加的考试；之后有变动需要重新下载。要自动同步请用安卓 App。</p>
            {kinds.map(({ kind, name }) => (
                <button className="kv" key={kind} onClick={() => setPicked(current => current.includes(kind) ? current.filter(item => item !== kind) : [...current, kind])}>
                    <span className="v">{name}</span><Toggle on={picked.includes(kind)} />
                </button>
            ))}
            {picked.includes('exams') && <>
                <h3 className="sh gap">考试提醒</h3>
                <div className="picks">
                    {EXAM_REMINDERS.map(({ key, name }) => <button key={key} className={reminders.includes(key) ? 'on' : ''} onClick={() => toggleReminder(key)}>{name}</button>)}
                </div>
            </>}
            <button className="btn go wide" disabled={!picked.length} onClick={() => void download()}>下载</button>
        </Sheet>
    );
}
