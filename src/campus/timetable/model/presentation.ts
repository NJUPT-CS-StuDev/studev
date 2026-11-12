import type { TeachingMeeting } from '@/world/facts';
import { courseIdentity, courseTones } from './courseColors';
import { describeMeetingOverlap, groupOverlappingMeetings } from './overlapLayout';
import { alternatingWeekLabel, offThisWeek } from './weekPattern';
import { roomLabel } from '@/world/names';

const meetingNote = (meeting: TeachingMeeting): string => [
    meeting.room === '翻转课堂线上自学' ? '翻转课堂 · 线上自学' : '',
    meeting.method && meeting.method !== '面授讲课' ? meeting.method.trim() : '',
].filter(Boolean).join(' · ');
const meetingRoom = (meeting: TeachingMeeting): string => meeting.room === '翻转课堂线上自学' ? '' : roomLabel(meeting.room);

/** On this week, off this week within its run of weeks (greyed in place), or not shown. */
const meetingState = (meeting: TeachingMeeting, week: number) => meeting.weeks.includes(week) ? 'active' : offThisWeek(meeting, week) ? 'off' : 'hidden';

/** The lessons of a week as cells. `tones` are the timetable's colours when it holds more than these lessons. */
export function timetableCells(meetings: TeachingMeeting[], week: number, tones = courseTones(meetings)) {
    const active = meetings.filter(meeting => meeting.weeks.includes(week));
    return groupOverlappingMeetings(meetings.filter(meeting => meetingState(meeting, week) !== 'hidden')).flatMap(group =>
        group.positioned.map(({ meeting, slot }) => {
            const state = meetingState(meeting, week);
            const overlap = state === 'active' ? describeMeetingOverlap(meeting, active) : null;
            return {
                id: meeting.id, day: meeting.weekday, periods: meeting.periods, course: meeting.course.name,
                room: meetingRoom(meeting), state, colourIndex: tones.get(courseIdentity(meeting))!,
                note: meetingNote(meeting),
                label: state === 'off' ? [alternatingWeekLabel(meeting), '本周不上课'].filter(Boolean).join(' · ') : overlap
                        ? `${overlap.kind === 'parallel' ? '并行' : '重叠'} ${overlap.count} 项` : '',
                slot, columns: group.slotCount, overlap: overlap?.kind ?? '', overlapCount: overlap?.count ?? 0,
            };
        }));
}

