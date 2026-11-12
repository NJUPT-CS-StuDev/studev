import type { Lab, TeachingMeeting } from '@/world/facts';
import { sheetName } from '@/world/exams';
import { courseIdentity, sameCourse } from './courseColors';

/**
 * A person's labs as their timetable has them. They are their class's, less those of a course they took off
 * their timetable, plus those a course added from other classes brings: that course's labs for those classes.
 * `kept` are the class's own lessons still on the timetable, `added` the lessons brought in.
 */
export function personalLabs(classLabs: Lab[], classMeetings: TeachingMeeting[], kept: TeachingMeeting[], added: TeachingMeeting[], allLabs: Lab[]): Lab[] {
    const dropped = (lab: Lab) => classMeetings.some(meeting => sameCourse(lab, meeting)) && !kept.some(meeting => sameCourse(lab, meeting));
    const brought = allLabs.filter(lab => added.some(meeting => sameCourse(lab, meeting) && meeting.classes.some(name => lab.classes.includes(name))));
    return [...new Map([...classLabs.filter(lab => !dropped(lab)), ...brought].map(lab => [lab.id, lab])).values()]
        .sort((left, right) => left.date.localeCompare(right.date) || left.start.localeCompare(right.start) || left.id.localeCompare(right.id));
}

/**
 * What a person chose about labs, kept on their device. A lab sheet comes from outside the teaching office, so
 * each is theirs to take or leave whole (`off`, by the sheet's name across its versions); then a lab course
 * (`drop`) or a single sitting (`skip`).
 */
export interface LabChoices { off?: string[]; drop?: string[]; skip?: string[] }
export const labSheet = (lab: Lab) => sheetName(lab.source);
export const attendingLabs = (labs: Lab[], choices: LabChoices | undefined) => labs.filter(lab =>
    !choices?.off?.includes(labSheet(lab)) && !choices?.drop?.includes(courseIdentity(lab)) && !choices?.skip?.includes(lab.id));
