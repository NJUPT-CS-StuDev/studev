import type { TeachingMeeting } from '@/academics/facts';
import { courseToneStyle } from '@/timetable/model/courseColors';
import { timetableCells } from '@/timetable/model/presentation';
import { eventsOn, weekOfDate, type CampusEvent, type Timeline } from '@/world/events';
import { courseName, courseShort, roomLabel, roomShort } from '@/world/names';
import { addDays, hm, minutesOf, startOfWeek, WEEKDAYS, type Moment } from '@/world/time';

const DAY_END = 21 * 60 + 8;

export function WeekView({ line, day, now, wide, previewRows, onOpen }: { line: Timeline; day: string; now: Moment; wide: boolean; previewRows: TeachingMeeting[]; onOpen: (event: CampusEvent) => void }) {
    const monday = startOfWeek(day);
    const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
    const week = weekOfDate(line.term, monday);
    const events = days.map(date => eventsOn(line, date));
    const cells = week ? timetableCells(line.meetings, week) : [];
    const ghosts = week ? previewRows.filter(meeting => meeting.weeks.includes(week)) : [];
    let columns = wide ? 7 : 5;
    days.forEach((_, index) => { if (events[index]!.length || cells.some(cell => cell.day === index + 1) || ghosts.some(meeting => meeting.weekday === index + 1)) columns = Math.max(columns, index + 1); });
    const clock = new Map(line.periods.map(period => [period.period, { start: minutesOf(period.start), end: minutesOf(period.end) }]));
    const scale = wide ? 1.02 : .72;
    const from = (events.flat().some(event => event.kind === 'run') ? minutesOf(line.run!.rule.time[0]) : 480) - 4;
    const y = (minutes: number) => Math.round((minutes - from) * scale);
    const height = y(DAY_END);
    const inThisWeek = days.includes(now.date);
    const lines = line.periods.map(period => <div key={period.period} className="hl" style={{ top: y(minutesOf(period.start)) }} />);
    return (
        <div className="wk" style={{ gridTemplateColumns: `${wide ? '68px' : '32px'} repeat(${columns},minmax(0,1fr))` }}>
            <div className="corner" />
            {days.slice(0, columns).map((date, index) => {
                const holiday = line.holidays.get(date);
                return <div key={date} className={`dh ${date === now.date ? 'today' : ''}`}>{WEEKDAYS[index + 1]}<small>{holiday ?? `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`}</small></div>;
            })}
            <div className="ax" style={{ height }}>
                {line.periods.map(period => <span key={period.period} style={{ top: y(minutesOf(period.start)), height: y(minutesOf(period.end)) - y(minutesOf(period.start)) }}>{period.period}<small>{period.start}<br />{period.end}</small></span>)}
                {inThisWeek && <b className="nowlab" style={{ top: y(now.min) }}>{hm(now.min)}</b>}
            </div>
            {days.slice(0, columns).map((date, index) => {
                const past = (end: number) => date < now.date || (date === now.date && end <= now.min);
                const all = line.holidays.has(date) ? [] : cells.filter(cell => cell.day === index + 1);
                const clashes = (left: typeof all[number], right: typeof all[number]) => left !== right && left.periods[0] <= right.periods[1] && right.periods[0] <= left.periods[1];
                // A lesson that is not on this week gives way to one that is.
                const lessons = all.filter(cell => cell.state === 'active' || !all.some(other => other.state === 'active' && clashes(cell, other)));
                return (
                    <div key={date} className={`col ${line.holidays.has(date) ? 'off' : ''}`} style={{ height }}>
                        {lines}
                        {lessons.map(cell => {
                            const start = clock.get(cell.periods[0])?.start;
                            const end = clock.get(cell.periods[1])?.end;
                            if (start === undefined || end === undefined) return null;
                            const event = events[index]!.find(item => item.meeting?.id === cell.id);
                            const quiet = cell.state !== 'active';
                            const shared = lessons.some(other => clashes(cell, other));
                            const width = 100 / cell.columns;
                            return <button key={cell.id} className={`t ${quiet ? 'quiet' : ''} ${!quiet && past(end) ? 'past' : ''}`} disabled={!event}
                                style={{ top: y(start) + 1, height: y(end) - y(start) - 2, ...(shared ? { left: `calc(${cell.slot * width}% + 2px)`, right: 'auto', width: `calc(${width}% - 4px)` } : {}), ...courseToneStyle(cell.colourIndex) }}
                                onClick={() => event && onOpen(event)}>
                                {wide ? courseName(cell.course) : courseShort(cell.course)}<small>{quiet ? cell.label : wide ? cell.room : roomShort(cell.room)}</small>
                            </button>;
                        })}
                        {events[index]!.filter(event => event.kind !== 'class').map(event => (
                            <button key={event.id} className={`t ${event.kind}`} style={{ top: y(event.start) + 1, height: Math.max(22, y(event.end) - y(event.start) - 2) }} onClick={() => onOpen(event)}>
                                {wide ? event.name : event.short}<small>{event.room ? (wide ? roomLabel(event.room) : roomShort(event.room)) : ''}</small>
                            </button>
                        ))}
                        {ghosts.filter(meeting => meeting.weekday === index + 1).map(meeting => {
                            const start = clock.get(meeting.periods[0])!.start;
                            const end = clock.get(meeting.periods[1])!.end;
                            const clash = events[index]!.some(event => event.start < end && start < event.end);
                            return <div key={meeting.id} className={`t ${clash ? 'clash' : 'ghost'}`} style={{ top: y(start) + 1, height: y(end) - y(start) - 2 }}>{courseShort(meeting.course.name)}<small>{roomShort(meeting.room)}</small></div>;
                        })}
                        {date === now.date && <div className="wnow" style={{ top: y(now.min) }} />}
                    </div>
                );
            })}
        </div>
    );
}
