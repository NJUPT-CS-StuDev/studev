import type { TeachingClass, TeachingMeeting } from '../facts';
export type { TeachingWeek, TeachingPeriod, TeachingTerm, TeachingClass, TeachingMeeting } from '../facts';

/** teaching/<term>/classes/<id>.json */
export interface TimetableClassFile { class: TeachingClass; meetings: TeachingMeeting[] }
