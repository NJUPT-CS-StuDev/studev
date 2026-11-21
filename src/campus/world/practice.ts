// Coursework with no place on the timetable (课程设计, 实践), read from what the timetable prints for it:
// "<course><teachers>(共N周)/<weeks>". The data's name is the course where the data proves where it ends; then what
// follows it, up to the bracket, is who leads it. Where the name is not proven it is the whole head and no one is named.
import type { Practice } from './facts';

/** The people leading a piece of practice coursework, as the timetable prints them after its proven name. */
export function practiceTeachers(practice: Practice): string[] {
    if (!practice.text.startsWith(practice.name)) return [];
    const rest = practice.text.slice(practice.name.length).replace(/\(共\d+周\)\/.*$/, '');
    return rest.split(/[,，、]/).map(name => name.trim()).filter(Boolean);
}

/** A name as people read it: a closing quote the source dropped the opening of gets it back. */
export function practiceName(practice: Practice): string {
    const name = practice.name;
    return name.includes('”') && !name.includes('“') ? `“${name}` : name;
}

/** Where the coursework stands in the term: not started, under way, or done. */
export function practiceProgress(weeks: number[], week: number | null): { state: 'ahead' | 'now' | 'done'; text: string } {
    const first = Math.min(...weeks), last = Math.max(...weeks);
    if (week === null || week < first) return { state: 'ahead', text: week === null ? `第 ${first} 周开始` : `${first - week} 周后开始` };
    if (week > last) return { state: 'done', text: '已结束' };
    return { state: 'now', text: `进行中 · 第 ${week - first + 1} / ${last - first + 1} 周` };
}
