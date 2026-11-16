// What the AI is told when it asks about a course, a schedule or a training plan. Pure functions over released data,
// so every client says the same: android/.../world/Answers.kt and windows/StuDev/Ai/Answers.cs follow this file.
import type { CourseMaterials } from './materials';
import { courseKey, materialsSaid } from './materials';
import type { CurriculumCourse, Knowledge } from './knowledge';
import type { TeachingMeeting } from './facts';

const WEEKDAY = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const SHOWN = 24;

/** Teaching weeks as read aloud: [1,2,3,5,7,8] → 1–3、5、7–8 周. */
export function weeksText(weeks: readonly number[]): string {
    const sorted = [...new Set(weeks)].sort((a, b) => a - b);
    const runs: string[] = [];
    let start = 0;
    sorted.forEach((week, i) => {
        if (sorted[i + 1] === week + 1) return;
        runs.push(start === i ? `${week}` : `${sorted[start]}–${week}`);
        start = i + 1;
    });
    return runs.length ? `${runs.join('、')} 周` : '';
}

/** A course name without its bracketed part, compared as courseKey does: 高等数学A（上） → 高等数学a. */
const plainKey = (name: string) => courseKey(name.replace(/[（(].*?[)）]/g, '') || name);

/** One course: its chapters and topics in the knowledge, its compiled materials, and the links students shared. A name
 * that is no course gives the courses it may mean. */
export function courseSaid(index: Knowledge, shared: readonly CourseMaterials[], asked: string) {
    const key = courseKey(asked), code = asked.trim().toUpperCase();
    const exact = index.courses.find(course => courseKey(course.name) === key || course.codes.includes(code) || course.former.includes(code));
    const course = exact ?? (() => { const near = index.courses.filter(course => courseKey(course.name).includes(key)); return near.length === 1 ? near[0] : undefined; })();
    if (!course) {
        const near = index.courses.filter(course => courseKey(course.name).includes(key) || key.includes(plainKey(course.name))).slice(0, 8).map(course => course.name);
        const sharedOnly = materialsSaid(shared, asked);
        return { found: false, courses: near, ...(sharedOnly && 'kinds' in sharedOnly ? { shared: sharedOnly } : {}) };
    }
    const titles = new Map(index.topics.map(topic => [topic.id, topic.title]));
    const materials: Record<string, { title: string; id: string }[]> = {};
    for (const material of index.materials.filter(item => item.course === course.id)) {
        const list = materials[material.kind] ??= [];
        if (list.length < 12) list.push({ title: material.title, id: `questions/${material.path}` });
    }
    const sharedLinks = materialsSaid(shared, course.name);
    return {
        found: true, course: course.name, codes: course.codes, url: `/knowledge/?course=${encodeURIComponent(course.id)}`,
        chapters: course.chapters.map(chapter => ({ title: chapter.title, topics: chapter.topics.map(id => ({ id: `topics/${id}`, title: titles.get(id) ?? id })) })),
        materials,
        ...(sharedLinks && 'kinds' in sharedLinks ? { shared: sharedLinks.kinds } : {}),
    };
}

/** When a course, a teacher, a class or a room meets this term: each meeting with its day, periods, weeks and place. */
export function scheduleSaid(meetings: readonly TeachingMeeting[], asked: string) {
    const key = courseKey(asked), code = asked.trim().toUpperCase();
    const room = (meeting: TeachingMeeting) => (meeting.room ?? '').replace(/^[^/:]*[/:]/, '') || meeting.location || '';
    const matches = (meeting: TeachingMeeting) =>
        meeting.course.code === code || plainKey(meeting.course.name) === plainKey(asked) || courseKey(meeting.course.name) === key
        || meeting.teachers.some(teacher => teacher.name === asked.trim())
        || meeting.classes.some(klass => klass.toUpperCase() === code)
        || (key.length >= 3 && courseKey(room(meeting)) === key);
    const found = meetings.filter(matches).sort((a, b) => a.weekday - b.weekday || a.periods[0] - b.periods[0] || (a.course.name < b.course.name ? -1 : a.course.name > b.course.name ? 1 : 0));
    return {
        asked, count: found.length, ...(found.length > SHOWN ? { cut: true } : {}),
        meetings: found.slice(0, SHOWN).map(meeting => ({
            course: meeting.course.name, teachers: meeting.teachers.map(teacher => teacher.name),
            when: `${WEEKDAY[meeting.weekday]} ${meeting.periods[0]}–${meeting.periods[1]} 节`,
            weeks: weeksText(meeting.weeks), where: room(meeting), campus: meeting.campus, classes: meeting.classes.length,
        })),
    };
}

/** A major's training plan: its courses term by term, with credits, whether required, and what each builds on. */
export function curriculumSaid(courses: readonly CurriculumCourse[], major: string, grade?: string) {
    const all = [...new Set(courses.flatMap(course => course.majors))];
    const meant = all.filter(name => name === major.trim()).length ? [major.trim()] : all.filter(name => name.includes(major.trim()));
    const only = meant.length === 1 ? meant[0] : undefined;
    if (only === undefined) return { found: false, majors: (meant.length ? meant : all).slice(0, 20) };
    const chosen = courses.filter(course => course.majors.includes(only) && (!grade || course.grades.includes(grade)));
    const terms = [...new Set(chosen.flatMap(course => course.terms))].sort((a, b) => a - b);
    const names = new Map(courses.map(course => [course.code, course.name]));
    return {
        found: true, major: only, ...(grade ? { grade } : {}),
        terms: terms.map(term => {
            const list = chosen.filter(course => course.terms.includes(term));
            return {
                term, credits: list.reduce((sum, course) => sum + course.credits, 0),
                courses: list.map(course => ({ name: course.name, code: course.code, credits: course.credits, nature: course.nature, category: course.category,
                    ...(course.requires.length ? { requires: course.requires.map(code => names.get(code) ?? code) } : {}) })),
            };
        }),
    };
}
