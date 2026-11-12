import type { TeachingMeeting } from '@/world/facts';
import { courseToneStyle, eventTone, timelineTones } from '@/timetable/model/courseColors';
import { offWeekLessons } from '@/timetable/model/weekPattern';
import { dueOn, eventsOn, layers, meetingAround, weekOfDate, type CampusEvent, type EventKind, type Timeline } from '@/world/events';
import type { Task } from '@/world/tasks';
import type { ExamRecord } from '@/world/data';
import { wasChanged } from '@/world/exams';
import { courseName, courseShort, roomLabel, roomShort } from '@/world/names';
import { addDays, hm, minutesOf, startOfWeek, WEEKDAYS, type Moment } from '@/world/time';

const DAY_END = 21 * 60 + 8;
/** How far each thing behind shows beside the one in front of it. */
const EDGE = 5;

/** What a tile says under its name: where, a lab's said short, and where there is room that it is a lab (its edge says so too). */
const tileNote = (event: CampusEvent, wide: boolean) => event.lab
    ? `${wide ? '实验 · ' : ''}${event.lab.room ? roomShort(event.lab.room) : event.lab.short}`
    : event.room ? (wide ? roomLabel(event.room) : roomShort(event.room)) : '';

export function WeekView({ line, day, now, wide, record, previewRows, order, onOpen, onTask }: { line: Timeline; day: string; now: Moment; wide: boolean; record: ExamRecord | null; previewRows: TeachingMeeting[]; order: readonly EventKind[]; onOpen: (event: CampusEvent) => void; onTask: (task: Task) => void }) {
    const monday = startOfWeek(day);
    const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
    const week = weekOfDate(line.term, monday);
    const events = days.map(date => eventsOn(line, date));
    const tones = timelineTones(line);
    const hints = week ? offWeekLessons(line.meetings, week, tones) : [];
    const ghosts = week ? previewRows.filter(meeting => meeting.weeks.includes(week)) : [];
    let columns = wide ? 7 : 5;
    days.forEach((_, index) => { if (events[index]!.length || hints.some(hint => hint.day === index + 1) || ghosts.some(meeting => meeting.weekday === index + 1)) columns = Math.max(columns, index + 1); });
    const clock = new Map(line.periods.map(period => [period.period, { start: minutesOf(period.start), end: minutesOf(period.end) }]));
    const scale = wide ? 1.02 : .72;
    const from = (events.flat().some(event => event.kind === 'run') ? minutesOf(line.run!.rule.time[0]) : 480) - 4;
    const y = (minutes: number) => Math.round((minutes - from) * scale);
    const height = y(DAY_END);
    const inThisWeek = days.includes(now.date);
    // Tasks due by the end of a day, with no time of their own, sit in a row under the day they are due.
    const dues = days.map(date => dueOn(line, date));
    const lines = line.periods.map(period => <div key={period.period} className="hl" style={{ top: y(minutesOf(period.start)) }} />);
    return (
        <div className="wk" style={{ gridTemplateColumns: `${wide ? '68px' : '38px'} repeat(${columns},minmax(0,1fr))` }}>
            <div className="corner" />
            {days.slice(0, columns).map((date, index) => {
                const holiday = line.holidays.get(date);
                return <div key={date} className={`dh ${date === now.date ? 'today' : ''}`}>{WEEKDAYS[index + 1]}<small>{holiday ?? `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`}</small></div>;
            })}
            {dues.slice(0, columns).some(list => list.length) && <>
                <div className="due-k">截止</div>
                {dues.slice(0, columns).map((list, index) => <div key={index} className="due">
                    {list.slice(0, 3).map(task => <button key={task.id} className={task.done ? 'task-done' : ''} onClick={() => onTask(task)}>{task.title}</button>)}
                    {list.length > 3 && <small>+{list.length - 3}</small>}
                </div>)}
            </>}
            <div className="ax" style={{ height }}>
                {line.periods.map(period => <span key={period.period} style={{ top: y(minutesOf(period.start)), height: y(minutesOf(period.end)) - y(minutesOf(period.start)) }}>{period.period}<small>{period.start}<br />{period.end}</small></span>)}
                {inThisWeek && <b className="nowlab" style={{ top: y(now.min) }}>{hm(now.min)}</b>}
            </div>
            {days.slice(0, columns).map((date, index) => {
                const past = (end: number) => date < now.date || (date === now.date && end <= now.min);
                const today = events[index]!;
                // A lesson off this week keeps its place, greyed, only where nothing is on that week.
                const quiet = line.holidays.has(date) ? [] : hints.filter(hint => {
                    if (hint.day !== index + 1) return false;
                    const [start, end] = [clock.get(hint.periods[0])?.start, clock.get(hint.periods[1])?.end];
                    return start !== undefined && end !== undefined && !today.some(event => event.start < end && start < event.end);
                });
                return (
                    <div key={date} className={`col ${line.holidays.has(date) ? 'off' : ''}`} style={{ height }}>
                        {lines}
                        {quiet.map(hint => {
                            const start = clock.get(hint.periods[0])!.start;
                            const end = clock.get(hint.periods[1])!.end;
                            const event = meetingAround(line, hint.id, monday);
                            return <button key={hint.id} className="t quiet" style={{ top: y(start) + 1, height: y(end) - y(start) - 2, ...courseToneStyle(hint.colourIndex) }} onClick={() => event && onOpen(event)}>
                                {wide ? courseName(hint.course) : courseShort(hint.course)}<small>{hint.label}</small>
                            </button>;
                        })}
                        {/* Everything on, at its own time, back to front: what is behind shows beside what is in front. */}
                        {layers(today, order).map(({ event, under, over }) => {
                            const tone = eventTone(tones, event, line.meetings);
                            return <button key={event.id} className={`t ${event.kind} ${!event.exam && past(event.end) ? 'past' : ''} ${event.exam && wasChanged(record, event.exam) ? 'changed' : ''} ${event.task?.done ? 'done' : ''}`}
                                style={{ top: y(event.start) + 1, height: Math.max(22, y(event.end) - y(event.start) - 2), right: 2 + under * EDGE, ...(tone !== undefined ? courseToneStyle(tone) : {}) }} onClick={() => onOpen(event)}>
                                {wide ? event.name : event.short}<small>{tileNote(event, wide)}</small>
                                {over === 0 && under > 0 && <i className="more">+{under}</i>}
                            </button>;
                        })}
                        {ghosts.filter(meeting => meeting.weekday === index + 1).map(meeting => {
                            const start = clock.get(meeting.periods[0])!.start;
                            const end = clock.get(meeting.periods[1])!.end;
                            const clash = today.some(event => event.start < end && start < event.end);
                            return <div key={meeting.id} className={`t ${clash ? 'clash' : 'ghost'}`} style={{ top: y(start) + 1, height: y(end) - y(start) - 2 }}>{courseShort(meeting.course.name)}<small>{roomShort(meeting.room)}</small></div>;
                        })}
                        {date === now.date && <div className="wnow" style={{ top: y(now.min) }} />}
                    </div>
                );
            })}
        </div>
    );
}
