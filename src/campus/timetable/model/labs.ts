import type { Lab } from '@/world/facts';
import { sheetName } from '@/world/exams';
import { courseIdentity } from './courseColors';

/**
 * A person's lab sources: their class and separately selected other classes. Lecture attendance has no part
 * in choosing these facts; LabChoices alone decides whether a sheet, course or sitting is attended.
 */
export function personalLabs(classLabs: Lab[], extraClasses: string[], allLabs: Lab[]): Lab[] {
    const brought = allLabs.filter(lab => lab.classes.some(name => extraClasses.includes(name)));
    return [...new Map([...classLabs, ...brought].map(lab => [lab.id, lab])).values()]
        .sort((left, right) => left.date.localeCompare(right.date) || left.start.localeCompare(right.start) || left.id.localeCompare(right.id));
}

/**
 * What a person chose about labs, kept on their device. A lab sheet comes from outside the teaching office, so
 * each is theirs to take or leave whole (`off`, by the sheet's name across its versions); then a lab course
 * (`drop`) or a single sitting (`skip`).
 */
export interface LabChoices { off?: string[]; drop?: string[]; skip?: string[]; classes?: string[] }
export const labSheet = (lab: Lab) => sheetName(lab.source);
/** A sheet gives projects separate codes; attendance in the whole named lab course spans those codes. */
export const labCourseKey = (lab: Lab) => `${labSheet(lab)}:${lab.course.name.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')}`;
export function migrateLabChoices(labs: Lab[], choices: LabChoices): LabChoices {
    if (!choices.drop?.length) return choices;
    const drop = [...new Set(choices.drop.map(key => { const lab = labs.find(lab => courseIdentity(lab) === key); return lab ? labCourseKey(lab) : key; }))];
    return drop.every((key, i) => key === choices.drop![i]) && drop.length === choices.drop.length ? choices : { ...choices, drop };
}
export const attendingLabs = (labs: Lab[], choices: LabChoices | undefined) => labs.filter(lab =>
    !choices?.off?.includes(labSheet(lab)) && !choices?.drop?.includes(labCourseKey(lab)) && !choices?.skip?.includes(lab.id));
