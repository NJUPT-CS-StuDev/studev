import { plainText, type Keyed } from '@/world/doc';

export interface ReferencePreview { title: string; context: string; excerpt: string }

/** The original heading address identifies a passage even when the author repeats its question number. */
export function referencePreviews(blocks: Pick<Keyed, 'block'>[]): Map<string, ReferencePreview> {
    const found = new Map<string, ReferencePreview>();
    const headings: { level: number; title: string }[] = [];
    let current: ReferencePreview | undefined;
    for (const { block } of blocks) {
        if (block.type === 'heading') {
            while (headings.length && headings.at(-1)!.level >= block.level) headings.pop();
            current = { title: plainText(block.inlines), context: headings.filter(heading => heading.level > 1).map(heading => heading.title).join(' › '), excerpt: '' };
            found.set(block.anchor, current);
            headings.push({ level: block.level, title: current.title });
        } else if (current && !current.excerpt && block.type === 'paragraph') {
            const text = plainText(block.inlines).trim();
            if (/^(?:答案|参考解答|订正|补充|知识点)(?:[：:（(]|$)/.test(text)) current = undefined;
            else if (text) current.excerpt = text.replace(/^题干[：:]\s*/, '').slice(0, 160);
        }
    }
    return found;
}
