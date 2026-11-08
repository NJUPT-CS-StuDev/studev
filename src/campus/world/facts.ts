// Current campus facts, shared by the packager and the web client.
export interface TeachingWeek { week: number; start: string; end: string }
export interface TeachingTerm { term: string; year: number; number: number; weeks: TeachingWeek[]; observed_at: string }
export interface TeachingPeriod { period: number; start: string; end: string; part: string | null }
export interface TeachingClass { id: string; name: string; grade: string | null; college: string | null; major: string | null; campus: string | null; students: number | null; practice: Practice[] }
/** Coursework off the timetable (课程设计, 实践): its weeks, and its name as far as the data proves it. */
export interface Practice { name: string; weeks: number[]; text: string }
export interface TeachingMeeting {
    id: string; course: { code: string | null; name: string; category: string | null; nature: string | null; credits: number | null; hours: number | null; hours_composition: string | null; assessment: string | null; exam: string | null };
    teachers: { id: string; name: string; title: string | null; role: string | null; weeks: number[] }[];
    /** size: how many students the whole teaching class (合班) has. */
    teaching_class: { id: string; size: number | null };
    campus: string | null; room: string | null; location: string | null; weekday: number; periods: [number, number]; weeks: number[]; method: string | null; classes: string[];
}
export interface Exam { id: string; classes: string[]; course: { code: string | null; name: string }; teacher: string | null; campus: string | null; location: string; room: string | null; date: string; start: string; end: string; students: number | null; note: string | null; source: string }
export interface ExamSlot { date: string; start: string; end: string; campus: string | null; location: string | null; teacher: string | null; students: number | null }
export interface ExamChange { observed: string; class: string; course: { code: string | null; name: string }; change: 'added' | 'removed' | 'changed'; before: ExamSlot[] | null; after: ExamSlot[] | null }
export interface ExamSource { file: string; url: string; notice: string; title: string }
export interface Room { id: string; building: string; floor: string; number: string; campus: string; kinds: string[]; names: string[]; listed?: boolean; seats?: number }
export interface RoomDay { date: string; observed_at?: string; week: number; weekday: number; free?: Record<string, string[]>; occupied: Record<string, RoomOccupant[]> }

export interface Campus { id: string; aliases: string[] }
export interface Building { id: string; campus: string; floors: string[] }
export interface RoomOccupant { kind: 'class' | 'exam'; id: string; course: string; teachers: string[]; classes: string[]; periods: [number, number] }
