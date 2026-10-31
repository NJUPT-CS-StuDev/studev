import type { TeachingMeeting } from '@/academics/timetable';
import { courseToneIndex } from './courseColors';
import { describeMeetingOverlap, groupOverlappingMeetings } from './overlapLayout';
import { alternatingWeekLabel, showAsInactiveAlternating, showAsSuspended } from './weekPattern';

const meetingNote = (meeting: TeachingMeeting): string => [
    meeting.location === '翻转课堂线上自学' ? '翻转课堂 · 线上自学' : '',
    meeting.method && meeting.method !== '面授讲课' ? meeting.method.trim() : '',
].filter(Boolean).join(' · ');
const meetingRoom = (meeting: TeachingMeeting): string => meeting.location === '翻转课堂线上自学' ? '' : meeting.location ?? meeting.room ?? '';

/** Display policy and its real-data examples live in academics/parity/spec.json. */
const meetingState = (meeting: TeachingMeeting, week: number) => meeting.weeks.includes(week)
    ? 'active' : showAsSuspended(meeting, week) ? 'suspended' : showAsInactiveAlternating(meeting, week) ? 'inactive' : 'hidden';

export function timetableCells(meetings: TeachingMeeting[], week: number) {
    const active = meetings.filter(meeting => meeting.weeks.includes(week));
    return groupOverlappingMeetings(meetings.filter(meeting => meetingState(meeting, week) !== 'hidden')).flatMap(group =>
        group.positioned.map(({ meeting, slot }) => {
            const state = meetingState(meeting, week);
            const overlap = state === 'active' ? describeMeetingOverlap(meeting, active) : null;
            return {
                id: meeting.id, day: meeting.weekday, periods: meeting.periods, course: meeting.course.name,
                room: meetingRoom(meeting), state, colourIndex: courseToneIndex(meeting),
                note: meetingNote(meeting),
                label: state === 'suspended' ? '本周停课' : state === 'inactive'
                    ? `${alternatingWeekLabel(meeting) ?? ''} · 本周不上课` : overlap
                        ? `${overlap.kind === 'parallel' ? '并行' : '重叠'} ${overlap.count} 项` : '',
                slot, columns: group.slotCount, overlap: overlap?.kind ?? '', overlapCount: overlap?.count ?? 0,
            };
        }));
}

export type TimetableCell = ReturnType<typeof timetableCells>[number];
