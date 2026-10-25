import type { CSSProperties } from 'react';
import type { TeachingMeeting, TeachingPeriod, TeachingWeek } from '@/academics/timetable';
import { courseIdentity } from '../model/courseColors';
import { meetingDate, todayInShanghai } from '../model/calendar';
import { describeMeetingOverlap, groupOverlappingMeetings, type MeetingOverlap } from '../model/overlapLayout';
import { alternatingWeekLabel, showAsInactiveAlternating, showAsSuspended } from '../model/weekPattern';

interface TimetableGridProps {
    meetings: TeachingMeeting[];
    week: TeachingWeek;
    periods: TeachingPeriod[];
    tones: Map<string, number>;
    onOpen: (meeting: TeachingMeeting, target: HTMLElement) => void;
}

const weekdayLabel = ['一', '二', '三', '四', '五', '六', '日'];
const shortDate = (value: string) => `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`;

const courseButton = (
    meeting: TeachingMeeting,
    tones: Map<string, number>,
    overlap: MeetingOverlap | null,
    activeThisWeek: boolean,
    suspended: boolean,
    onOpen: TimetableGridProps['onOpen'],
    style?: CSSProperties,
) => {
    const tone = tones.get(courseIdentity(meeting)) ?? 0;
    const alternating = alternatingWeekLabel(meeting);
    const inactiveLabel = suspended ? '本周停课' : `${alternating ?? ''} · 本周不上课`;
    const overlapLabel = overlap?.kind === 'parallel' ? `并行 ${overlap.count} 项` : overlap ? `重叠 ${overlap.count} 项` : null;
    const overlapDescription = overlap?.kind === 'parallel'
        ? `，同一课程共有${overlap.count}项并行安排`
        : overlap
            ? `，共有${overlap.count}项时间重叠安排`
            : '';
    return (
        <button
            key={meeting.meeting_id}
            type="button"
            className={`timetable-course course-tone-${tone} ${activeThisWeek ? '' : 'is-inactive'} ${suspended ? 'is-suspended' : ''} ${overlap ? 'has-overlap' : ''}`}
            style={style}
            onClick={event => onOpen(meeting, event.currentTarget)}
            aria-label={`${meeting.course_name}，${meeting.location ?? '地点未注明'}，第${meeting.start_period}至${meeting.end_period}节${activeThisWeek ? overlapDescription : `，${suspended ? '本周停课' : `${alternating ?? ''}课程，本周不上课`}`}`}
        >
            <strong>{meeting.course_name}</strong>
            {meeting.location ? <span>{meeting.location}</span> : null}
            {!activeThisWeek ? <em>{inactiveLabel}</em> : overlapLabel ? <em>{overlapLabel}</em> : null}
        </button>
    );
};

const visibleDays = [1, 2, 3, 4, 5, 6, 7];

export function TimetableGrid({ meetings, week, periods, tones, onOpen }: TimetableGridProps) {
    const active = meetings.filter(meeting => meeting.week_numbers.includes(week.week));
    const suspendedIds = new Set(meetings.filter(meeting => showAsSuspended(meeting, week.week)).map(meeting => meeting.meeting_id));
    const visible = meetings.filter(meeting => meeting.week_numbers.includes(week.week) || suspendedIds.has(meeting.meeting_id) || showAsInactiveAlternating(meeting, week.week));
    const activeIds = new Set(active.map(meeting => meeting.meeting_id));
    const today = todayInShanghai();
    const columns = 7;
    const groups = groupOverlappingMeetings(visible);
    const overlapFor = (meeting: TeachingMeeting): MeetingOverlap | null => activeIds.has(meeting.meeting_id)
        ? describeMeetingOverlap(meeting, active)
        : null;
    return (
        <div className="timetable-scroll">
            <div className="timetable-grid" style={{ '--day-count': columns } as CSSProperties}>
                <div className="timetable-corner" aria-hidden="true" />
                {visibleDays.map((weekday, index) => {
                    const date = meetingDate(week, weekday);
                    return <div key={weekday} className={`timetable-day-head ${date === today ? 'is-today' : ''}`} style={{ gridColumn: index + 2, gridRow: 1 }}><strong>周{weekdayLabel[weekday - 1]}</strong><span>{shortDate(date)}</span></div>;
                })}
                {periods.map(period => (
                    <div key={`line-${period.period}`} className={`timetable-period-line ${[6, 10].includes(period.period) ? 'day-part-start' : ''}`} style={{ gridColumn: '1 / -1', gridRow: period.period + 1 }} aria-hidden="true" />
                ))}
                {periods.map(period => (
                    <div key={period.period} className="timetable-period-label" style={{ gridColumn: 1, gridRow: period.period + 1 }}><strong>{period.period}</strong><span>{period.start_time}</span><span>{period.end_time}</span></div>
                ))}
                {groups.map(group => {
                    const column = group.weekday + 1;
                    if (group.positioned.length === 1) {
                        const meeting = group.positioned[0]?.meeting;
                        return meeting ? courseButton(meeting, tones, overlapFor(meeting), activeIds.has(meeting.meeting_id), suspendedIds.has(meeting.meeting_id), onOpen, { gridColumn: column, gridRow: `${meeting.start_period + 1} / ${meeting.end_period + 2}` }) : null;
                    }
                    return (
                        <div
                            key={`${group.weekday}:${group.startPeriod}:${group.positioned.map(item => item.meeting.meeting_id).join(':')}`}
                            className="timetable-overlap-group"
                            style={{
                                '--overlap-columns': group.slotCount,
                                '--overlap-rows': group.endPeriod - group.startPeriod + 1,
                                gridColumn: column,
                                gridRow: `${group.startPeriod + 1} / ${group.endPeriod + 2}`,
                            } as CSSProperties}
                            aria-label={`${group.positioned.length}项同时段安排`}
                        >
                            {group.positioned.map(({ meeting, slot }) => courseButton(meeting, tones, overlapFor(meeting), activeIds.has(meeting.meeting_id), suspendedIds.has(meeting.meeting_id), onOpen, {
                                gridColumn: slot + 1,
                                gridRow: `${meeting.start_period - group.startPeriod + 1} / ${meeting.end_period - group.startPeriod + 2}`,
                            }))}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
