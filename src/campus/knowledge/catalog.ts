import type { CurriculumCourse, Knowledge, KnowledgeCourse } from '@/world/knowledge';

export type CatalogCourse = Pick<KnowledgeCourse, 'id' | 'name' | 'codes' | 'former'> & {
    chapters: string[]; topics: number; materials: number;
};
export type CatalogCurriculum = Pick<CurriculumCourse, 'code' | 'name' | 'requires'> & {
    plans: Pick<CurriculumCourse['plans'][number], 'grade' | 'major' | 'category' | 'nature' | 'credits' | 'term'>[];
};
export interface KnowledgeCatalog { courses: CatalogCourse[]; curriculum: CatalogCurriculum[] }

/** A shared link wins over personal defaults; use the class facts rather than guessing from its number. */
export function catalogScope(curriculum: CatalogCurriculum[], person: { grade?: string | null; major?: string | null } | null, explicit: { cohort?: string | null; major?: string | null }) {
    const cohorts = [...new Set(curriculum.flatMap(course => course.plans.map(plan => plan.grade)))].sort().reverse();
    const cohort = explicit.cohort && cohorts.includes(explicit.cohort) ? explicit.cohort : person?.grade && cohorts.includes(person.grade) ? person.grade : cohorts[0] ?? '';
    const majors = [...new Set(curriculum.flatMap(course => course.plans.filter(plan => plan.grade === cohort).map(plan => plan.major)))];
    const wanted = explicit.major ?? person?.major;
    return { cohort, major: wanted && majors.includes(wanted) ? wanted : '全部专业' };
}

/** Keep the recorded edges, including prerequisites outside a display filter; an unrecorded edge is not a claim of independence. */
export function courseRelations(curriculum: CatalogCurriculum[], selected: CatalogCurriculum[], focus = 'all') {
    const byCode = new Map(curriculum.map(course => [course.code, course]));
    const selectedCodes = new Set(selected.map(course => course.code));
    const edges = curriculum.flatMap(course => course.requires.filter(code => byCode.has(code)).map(code => ({ from: code, to: course.code })))
        .filter(edge => selectedCodes.has(edge.from) || selectedCodes.has(edge.to));
    const connected = new Set(edges.flatMap(edge => [edge.from, edge.to]));
    const choices = selected.filter(course => connected.has(course.code));
    const shown = focus === 'all' ? edges : edges.filter(edge => edge.from === focus || edge.to === focus);
    const codes = new Set(shown.flatMap(edge => [edge.from, edge.to]));
    const nodes = curriculum.filter(course => codes.has(course.code));
    return { nodes, edges: shown, choices, unlinked: selected.filter(course => !connected.has(course.code)).length };
}

/** The page's first reading, projected at build time from the same release its documents use. */
export function knowledgeCatalog(knowledge: Knowledge, curriculum: CurriculumCourse[]): KnowledgeCatalog {
    return {
        courses: knowledge.courses.map(course => ({
            id: course.id, name: course.name, codes: course.codes, former: course.former,
            chapters: course.chapters.map(chapter => chapter.title),
            topics: new Set(course.chapters.flatMap(chapter => chapter.topics)).size,
            materials: knowledge.materials.filter(material => material.course === course.id).length,
        })),
        curriculum: curriculum.map(({ code, name, requires, plans }) => ({
            code, name, requires,
            plans: plans.map(({ grade, major, category, nature, credits, term }) => ({ grade, major, category, nature, credits, term })),
        })),
    };
}
