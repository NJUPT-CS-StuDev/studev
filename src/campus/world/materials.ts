// What students have shared for a course: past papers, answers, review notes, slides, exercises. A course on the
// timetable finds its materials by its name, written the same way: 高等数学A(上) is 高等数学A（上）. A course whose name
// matches none has none; nothing is guessed from a similar name. The same rules are android/.../world/Materials.kt.
export interface Material { title: string; url: string; kind: string; term?: string; ext?: string }
export interface CourseMaterials { course: string; source: string; note?: { title: string; url: string }; items: Material[] }

/** The kinds, in the order they are shown. */
export const MATERIAL_KINDS = ['试卷', '答案', '复习', '习题', '课件', '实验', '资料'] as const;

/** A course name as compared: brackets one width, no spaces, letters small. */
export const courseKey = (name: string) => name.replace(/（/g, '(').replace(/）/g, ')').replace(/[ \t　]/g, '').toLowerCase();

/** The materials of one course, or none. */
export function materialsOf(all: readonly CourseMaterials[], course: string): CourseMaterials | null {
    const key = courseKey(course);
    return all.find(item => courseKey(item.course) === key) ?? null;
}

/** How many of each kind, in the order shown: 试卷 4 · 复习 2. */
export const kindCounts = (items: readonly Material[]) =>
    MATERIAL_KINDS.map(kind => [kind, items.filter(item => item.kind === kind).length] as const).filter(([, count]) => count > 0);

/** One course's materials by kind, a dozen of each at most. */
function byKind(found: CourseMaterials) {
    const kinds: Record<string, { title: string; url: string; term?: string }[]> = {};
    for (const kind of MATERIAL_KINDS) {
        const items = found.items.filter(item => item.kind === kind).slice(0, 12).map(({ title, url, term }) => ({ title, url, ...(term ? { term } : {}) }));
        if (items.length) kinds[kind] = items;
    }
    return { course: found.course, kinds };
}

/** A course's materials as the AI is told them; for a loose name (高数, 大学物理), every course it may mean, up to three. */
export function materialsSaid(all: readonly CourseMaterials[], course: string) {
    const found = materialsOf(all, course);
    if (found) return byKind(found);
    const stem = (name: string) => courseKey(name).replace(/[a-z]$|\(.\)$/, '');
    const key = stem(course);
    const like = all.filter(item => key.length >= 2 && (courseKey(item.course).includes(key) || key.includes(stem(item.course))));
    if (like.length && like.length <= 3) return { course, courses: like.map(byKind) };
    return { course, found: false, ...(like.length ? { courses: like.map(item => item.course) } : {}) };
}
