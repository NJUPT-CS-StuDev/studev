import type { TeachingMeeting } from '@/academics/timetable';
import { courseIdentity } from './courseColors';

export interface PositionedMeeting {
    meeting: TeachingMeeting;
    slot: number;
}

export interface MeetingGroup {
    weekday: number;
    startPeriod: number;
    endPeriod: number;
    slotCount: number;
    positioned: PositionedMeeting[];
}

export interface MeetingOverlap {
    count: number;
    kind: 'parallel' | 'overlap';
}

const intersects = (left: TeachingMeeting, right: TeachingMeeting): boolean => (
    left.weekday === right.weekday
    && left.periods[0] <= right.periods[1]
    && left.periods[1] >= right.periods[0]
);

export const describeMeetingOverlap = (
    meeting: TeachingMeeting,
    activeMeetings: TeachingMeeting[],
): MeetingOverlap | null => {
    const overlapping = activeMeetings.filter(other => intersects(meeting, other));
    if (overlapping.length <= 1) return null;
    const identity = courseIdentity(meeting);
    return {
        count: overlapping.length,
        kind: overlapping.every(other => courseIdentity(other) === identity) ? 'parallel' : 'overlap',
    };
};

export const groupOverlappingMeetings = (meetings: TeachingMeeting[]): MeetingGroup[] => {
    const groups: MeetingGroup[] = [];
    for (const weekday of [1, 2, 3, 4, 5, 6, 7]) {
        const sorted = meetings
            .filter(meeting => meeting.weekday === weekday)
            .sort((left, right) => left.periods[0] - right.periods[0] || left.periods[1] - right.periods[1] || left.id.localeCompare(right.id));
        let component: TeachingMeeting[] = [];
        let componentEnd = 0;
        const flush = () => {
            if (!component.length) return;
            const slotEnds: number[] = [];
            const positioned = component.map(meeting => {
                const available = slotEnds.findIndex(end => end < meeting.periods[0]);
                const slot = available === -1 ? slotEnds.length : available;
                slotEnds[slot] = meeting.periods[1];
                return { meeting, slot };
            });
            groups.push({
                weekday,
                startPeriod: Math.min(...component.map(meeting => meeting.periods[0])),
                endPeriod: Math.max(...component.map(meeting => meeting.periods[1])),
                slotCount: slotEnds.length,
                positioned,
            });
            component = [];
            componentEnd = 0;
        };
        for (const meeting of sorted) {
            if (component.length && meeting.periods[0] > componentEnd) flush();
            component.push(meeting);
            componentEnd = Math.max(componentEnd, meeting.periods[1]);
        }
        flush();
    }
    return groups;
};
