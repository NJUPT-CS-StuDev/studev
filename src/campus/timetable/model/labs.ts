import type { Lab, TeachingMeeting } from '@/world/facts';
import { courseIdentity } from './courseColors';

/**
 * A person's labs. They are their class's, less those of a course they took off their timetable,
 * plus those a course added from other classes brings: that course's labs for those classes.
 * `kept` are the class's own lessons still on the timetable, `added` the lessons brought in.
 */
export function personalLabs(classLabs: Lab[], classMeetings: TeachingMeeting[], kept: TeachingMeeting[], added: TeachingMeeting[], allLabs: Lab[]): Lab[] {
    const still = new Set(kept.map(courseIdentity));
    const dropped = new Set(classMeetings.map(courseIdentity).filter(course => !still.has(course)));
    const brought = allLabs.filter(lab => added.some(meeting => courseIdentity(meeting) === courseIdentity(lab) && meeting.classes.some(name => lab.classes.includes(name))));
    return [...new Map([...classLabs.filter(lab => !dropped.has(courseIdentity(lab))), ...brought].map(lab => [lab.id, lab])).values()]
        .sort((left, right) => left.date.localeCompare(right.date) || left.start.localeCompare(right.start) || left.id.localeCompare(right.id));
}
