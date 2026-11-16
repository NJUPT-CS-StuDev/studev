import type { CurriculumCourse, Knowledge, KnowledgeCourse } from '@/world/knowledge';

export type CatalogCourse = Pick<KnowledgeCourse, 'id' | 'name' | 'codes' | 'former'> & {
    chapters: string[]; topics: number; materials: number;
};
export type CatalogCurriculum = Pick<CurriculumCourse, 'code' | 'name' | 'requires'> & {
    plans: Pick<CurriculumCourse['plans'][number], 'grade' | 'major' | 'category' | 'nature' | 'credits' | 'term'>[];
};
export interface KnowledgeCatalog { courses: CatalogCourse[]; curriculum: CatalogCurriculum[] }

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
