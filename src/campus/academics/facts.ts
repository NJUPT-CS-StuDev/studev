// Current njupt-data facts, shared by the packager and the web client.
export interface TeachingWeek { week: number; start: string; end: string }
export interface TeachingTerm { term: string; year: number; number: number; weeks: TeachingWeek[]; observed_at: string }
export interface TeachingPeriod { period: number; start: string; end: string; part: string | null }
export interface TeachingClass { id: string; name: string; grade: string | null; college: string | null; major: string | null; campus: string | null; students: number | null; practice: string[] }
export interface TeachingMeeting {
    id: string; course: { code: string | null; name: string; category: string | null; nature: string | null; credits: number | null; hours: number | null; hours_composition: string | null; assessment: string | null; exam: string | null };
    teachers: { name: string; title: string | null; role: string | null; weeks: number[] }[];
    teaching_class: { id: string | null; name: string | null; size: number | null; enrolled: number | null; capacity: number | null };
    campus: string | null; location: string | null; room: string | null; weekday: number; periods: [number, number]; weeks: number[]; method: string | null; classes: string[];
}
export interface Exam { id: string; class: string; course: { code: string | null; name: string }; teacher: string | null; campus: string | null; location: string | null; room: string | null; date: string; start: string; end: string; students: number | null; note: string | null }
export type ExamSlot = { date: string; start: string; end: string; campus: string | null; location: string | null; teacher: string | null; students: number | null };
export interface ExamChange { observed: string; class: string; course: { code: string | null; name: string }; change: 'added' | 'removed' | 'changed'; before: ExamSlot[] | null; after: ExamSlot[] | null }
export interface ExamSource { file: string; url: string; notice: string; title: string }
export interface Room { id: string; building: string; floor: string; number: string; campus: string; kinds: string[]; names: string[]; listed?: boolean; seats?: number }
export interface RoomDay { date: string; observed_at?: string; week: number; weekday: number; free?: Record<string, string[]>; occupied: Record<string, RoomOccupant[]> }

export interface Campus { id: string; aliases: string[] }
export interface Building { id: string; campus: string; floors: string[] }
export interface RoomOccupant { kind: 'class' | 'exam'; id: string; course: string; teachers: string[]; classes: string[]; periods: [number, number] }
