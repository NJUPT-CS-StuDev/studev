import type { CSSProperties } from 'react';
import type { TeachingMeeting, TeachingPeriod, TeachingWeek } from '@/academics/timetable';
import { courseToneStyle } from '../model/courseColors';
import { meetingDate, todayInShanghai } from '../model/calendar';
import { timetableCells, type TimetableCell } from '../model/presentation';
import { groupOverlappingMeetings } from '../model/overlapLayout';

interface TimetableGridProps {
    meetings: TeachingMeeting[]; week: TeachingWeek; periods: TeachingPeriod[];
    tones: Map<string, number>; day?: number;
    onOpen: (meeting: TeachingMeeting, target: HTMLElement) => void;
}
const weekdayLabel = '一二三四五六日';
const shortDate = (value: string) => `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`;
const courseButton = (meeting: TeachingMeeting, cell: TimetableCell, onOpen: TimetableGridProps['onOpen'], style: CSSProperties) => {
    const overlapDescription = cell.overlap === 'parallel' ? `，同一课程共有${cell.overlapCount}项并行安排` : cell.overlap ? `，共有${cell.overlapCount}项时间重叠安排` : '';
    return <button key={cell.id} type="button"
        className={`timetable-course course-palette ${cell.state !== 'active' ? 'is-inactive' : ''} ${cell.state === 'suspended' ? 'is-suspended' : ''} ${cell.overlap ? 'has-overlap' : ''}`}
        data-meeting={cell.id} data-state={cell.state} data-colour={cell.colourIndex} data-slot={cell.slot}
        style={{...courseToneStyle(cell.colourIndex), ...style}} onClick={event => onOpen(meeting, event.currentTarget)}
        aria-label={`${cell.course}，${cell.room || '地点未注明'}，第${cell.periods[0]}至${cell.periods[1]}节${overlapDescription}${cell.state !== 'active' ? `，${cell.label}` : ''}${cell.note ? `，${cell.note}` : ''}`}>
        <strong>{cell.course}</strong>
        {cell.room ? <span>{cell.room}</span> : null}
        {cell.note ? <small>{cell.note}</small> : null}
        {cell.label ? <em>{cell.label}</em> : null}
    </button>;
};

export function TimetableGrid({meetings, week, periods, day, onOpen}: TimetableGridProps) {
    const cells = new Map(timetableCells(meetings, week.week).map(cell => [cell.id, cell]));
    const days = day ? [day] : [1,2,3,4,5,6,7];
    const groups = groupOverlappingMeetings(meetings.filter(meeting => cells.has(meeting.id) && days.includes(meeting.weekday)));
    const byId = new Map(meetings.map(meeting => [meeting.id, meeting]));
    const today = todayInShanghai();
    return <div className={`timetable-scroll ${day ? 'is-day-view' : ''}`}>
        <div className="timetable-grid" style={{'--day-count':days.length} as CSSProperties}>
            <div className="timetable-corner" aria-hidden="true" />
            {days.map((weekday,index) => {
                const date = meetingDate(week,weekday);
                return <div key={weekday} className={`timetable-day-head ${date === today ? 'is-today' : ''}`} style={{gridColumn:index+2, gridRow:1}}><strong>周{weekdayLabel[weekday-1]}</strong><span>{shortDate(date)}</span></div>;
            })}
            {periods.map(period=><div key={`line-${period.period}`} className={`timetable-period-line ${[6,10].includes(period.period)?'day-part-start':''}`} style={{gridColumn:'1 / -1',gridRow:period.period+1}} aria-hidden="true" />)}
            {periods.map(period=><div key={period.period} className="timetable-period-label" style={{gridColumn:1,gridRow:period.period+1}}><strong>{period.period}</strong><span>{period.start}</span><span>{period.end}</span></div>)}
            {groups.map(group=><div key={`${group.weekday}:${group.startPeriod}`} className="timetable-overlap-group" style={{
                '--overlap-columns':group.slotCount, '--overlap-rows':group.endPeriod-group.startPeriod+1,
                gridColumn:days.indexOf(group.weekday)+2, gridRow:`${group.startPeriod+1} / ${group.endPeriod+2}`,
            } as CSSProperties}>
                {group.positioned.map(({meeting,slot})=>courseButton(byId.get(meeting.id)!,cells.get(meeting.id)!,onOpen,{
                    gridColumn:slot+1,gridRow:`${meeting.periods[0]-group.startPeriod+1} / ${meeting.periods[1]-group.startPeriod+2}`,
                }))}
            </div>)}
        </div>
    </div>;
}
