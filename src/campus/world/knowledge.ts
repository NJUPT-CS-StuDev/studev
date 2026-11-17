// The knowledge as the data release carries it (built by njupt-knowledge): course outlines in teaching order, topics
// with what they build on, and source documents whose questions name the topics they test. Backlinks are already
// computed there; this only reads them. Every end opens the same three kinds of place by the same paths.
import { DATA_RELEASE, releaseReady } from '@/world/config';
import { fetchJson, fetchText } from '@/world/fetch';
import { plainText, type Inline, type Keyed } from '@/world/doc';
import type { KnowledgeCatalog } from '@/knowledge/catalog';
import tokens from '../../../design/tokens.json';

/** A subject's outline; codes are the course plans taught now that teach it, former the codes it had before. */
export interface KnowledgeCourse { id: string; name: string; codes: string[]; former: string[]; chapters: { title: string; topics: string[] }[]; path: string }
export interface MaterialRef { material: string; heading: string; anchor: string }
export interface KnowledgeTopic { id: string; title: string; requires: string[]; path: string; taught_by: string[]; references: MaterialRef[]; leads_to: string[] }
export interface KnowledgeMaterial { path: string; title: string; kind: string; course: string; term: string | null; source: string; sections: number }
export interface Knowledge { courses: KnowledgeCourse[]; topics: KnowledgeTopic[]; materials: KnowledgeMaterial[] }

/** A campus course and its entries in each major's training plan. */
export interface CurriculumCourse {
    code: string; name: string; requires: string[]; former: string[]; plans: CurriculumEntry[];
}
export interface CurriculumEntry {
    college: string; major: string; grade: string; term: number | null; credits: number | null;
    hours: string; exam_mode: string; category: string; nature: string; weeks: string;
}

const base = () => DATA_RELEASE.knowledge_base;
let catalog: Promise<KnowledgeCatalog> | null = null;
export const loadKnowledgeCatalog = () => catalog ??= releaseReady.then(() => fetchJson<KnowledgeCatalog>(`${DATA_RELEASE.base}/knowledge-catalog.json`)).catch(error => { catalog = null; throw error; });
let index: Promise<Knowledge> | null = null;
export const loadKnowledge = () => index ??= releaseReady.then(() => fetchJson<Knowledge>(`${base()}/knowledge.json`)).catch(error => { index = null; throw error; });
let curriculum: Promise<CurriculumCourse[]> | null = null;
export const loadCurriculum = () => curriculum ??= releaseReady.then(() => fetchJson<CurriculumCourse[]>(`${DATA_RELEASE.base}/curriculum/courses.json`)).catch(error => { curriculum = null; throw error; });
const texts = new Map<string, Promise<string>>();
/** One document's Markdown, by its path from the knowledge's root. */
export function loadKnowledgeText(path: string) {
    let text = texts.get(path);
    if (!text) {
        text = releaseReady.then(() => fetchText(`${base()}/${path.split('/').map(encodeURIComponent).join('/')}`));
        texts.set(path, text);
        text.catch(() => texts.delete(path));
    }
    return text;
}
/** A picture or file inside the knowledge, by its path from the root. */
export const knowledgeFile = (path: string) => `${base()}/${path.split('/').map(encodeURIComponent).join('/')}`;

/** Where a link inside a knowledge document leads: a topic, a course, or a place in a material; null if outside. */
export type KnowledgePlace = { topic: string } | { course: string } | { material: string; anchor: string | null };
export function knowledgePlace(href: string): KnowledgePlace | null {
    const [path, anchor] = href.split('#') as [string, string | undefined];
    const decoded = decodeURIComponent(path);
    if (/^topics\/.+\.md$/.test(decoded)) return { topic: decoded.slice('topics/'.length, -'.md'.length) };
    if (/^courses\/.+\.md$/.test(decoded)) return { course: decoded.slice('courses/'.length, -'.md'.length) };
    if (/^materials\/.+\.md$/.test(decoded)) return { material: decoded, anchor: anchor ? decodeURIComponent(anchor) : null };
    return null;
}

/** Material passages that name this topic; a reference alone makes no claim about an exam. */
export function referenced(topic: KnowledgeTopic) {
    return { references: topic.references.length, materials: new Set(topic.references.map(ref => ref.material)).size };
}


/**
 * A source document as its readers see it: groups (一、填空题…), and in them questions, each with what the source
 * asks, the answer to reveal (the source's 答案 or our 参考解答, with any 订正 and 补充) and the topics it tests. The
 * same reading on every end: a level-2 heading opens a group, a level-3 heading a question, a paragraph beginning
 * 答案 / 参考解答 / 订正 / 补充 starts that part, and the 知识点 line names the topics.
 */
export type MaterialPart =
    | { kind: 'text'; blocks: Keyed[] }
    | { kind: 'group'; title: string; anchor: string; sections: number }
    | { kind: 'section'; title: string; anchor: string; asks: Keyed[]; answer: { label: AnswerLabel; blocks: Keyed[] }[]; topics: { title: string; href: string }[] };
export type AnswerLabel = '答案' | '参考解答' | '订正' | '补充' | '原文';
const LABELS: AnswerLabel[] = ['参考解答', '答案', '订正', '补充', '原文'];

/** Whether these parsed blocks contain the document address being opened. */
export function containsAnchor(blocks: Keyed[], anchor: string): boolean {
    const contains = (value: unknown): boolean => {
        if (!value || typeof value !== 'object') return false;
        if ('anchor' in value && value.anchor === anchor) return true;
        return Object.values(value).some(child => Array.isArray(child) ? child.some(contains) : contains(child));
    };
    return blocks.some(contains);
}

function linksOf(inlines: Inline[], out: { title: string; href: string }[] = []) {
    for (const inline of inlines) {
        if (inline.type === 'link') out.push({ title: plainText(inline.children), href: inline.href });
        else if ('children' in inline) linksOf(inline.children, out);
    }
    return out;
}

export function materialParts(blocks: Keyed[]): MaterialPart[] {
    const parts: MaterialPart[] = [];
    let section: Extract<MaterialPart, { kind: 'section' }> | null = null;
    let group: Extract<MaterialPart, { kind: 'group' }> | null = null;
    for (const keyed of blocks) {
        const block = keyed.block;
        if (block.type === 'heading' && block.level <= 2) {
            section = null;
            if (block.level === 1) { parts.push({ kind: 'text', blocks: [keyed] }); continue; }
            group = { kind: 'group', title: plainText(block.inlines), anchor: block.anchor, sections: 0 };
            parts.push(group);
            continue;
        }
        if (block.type === 'heading' && block.level === 3) {
            const title = plainText(block.inlines);
            section = { kind: 'section', title, anchor: block.anchor, asks: [], answer: [], topics: [] };
            parts.push(section);
            if (group) group.sections++;
            continue;
        }
        if (!section) {
            const last = parts[parts.length - 1];
            if (last?.kind === 'text') last.blocks.push(keyed); else parts.push({ kind: 'text', blocks: [keyed] });
            continue;
        }
        const text = block.type === 'paragraph' ? plainText(block.inlines).trim() : '';
        if (text.startsWith('知识点：') && block.type === 'paragraph') { section.topics.push(...linksOf(block.inlines)); continue; }
        const label = LABELS.find(name => text.startsWith(`${name}：`) || text.startsWith(`${name}（`) || text === name);
        if (label) { section.answer.push({ label, blocks: [keyed] }); continue; }
        if (section.answer.length) section.answer[section.answer.length - 1]!.blocks.push(keyed);
        else section.asks.push(keyed);
    }
    return parts;
}

/** A subject's stable slot in the course palette shared by all three clients. */
export function toneOf(id: string): number {
    let hash = 0;
    for (const char of id) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
    return hash % Object.keys(tokens.course.light).length;
}
/** The colour a kind of document wears. */
export const KIND_TONE: Record<string, string> = { 期末试卷: 'danger', 答案: 'success', 习题: 'shop', 复习要点: 'warning', 课件: 'brand', 实验: 'food' };
