// What the AI keeps in mind about the person asking, written by them or by the AI when asked to remember: plain lines
// kept on this device, shown and changed in “记忆”, turned off there too (then nothing is sent and nothing is kept).
// The same rules are android/.../ai/Memory.kt.
export interface Memory { on: boolean; text: string }
export const STARTING_MEMORY: Memory = { on: true, text: '' };
/** As long as it may grow; past this the AI is told to make room. */
export const MEMORY_LIMIT = 4000;

const plain = (line: string) => line.replace(/^[-*•]\s*/, '').replace(/[ \t\n\r\u3000，。,.！!？?；;：:“”"']/g, '').toLowerCase();

/** The memory with one more thing in it, as a line of its own; the same thing again changes nothing. */
export function remembered(text: string, fact: string): string {
    const said = fact.replace(/[ \t\n\r\u3000]+/g, ' ').trim();
    if (!said) throw new Error('要记住的话是空的。');
    const lines = text.split('\n').map(line => line.trimEnd()).filter(Boolean);
    if (lines.some(line => plain(line) === plain(said))) return lines.join('\n');
    const next = [...lines, `- ${said}`].join('\n');
    if (next.length > MEMORY_LIMIT) throw new Error('记忆已经满了，请对方在“记忆”里删掉一些再记。');
    return next;
}

const KEY = 'studev_ai_memory';
export function readMemory(): Memory {
    try { const kept = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Memory | null; if (kept && typeof kept.on === 'boolean' && typeof kept.text === 'string') return kept; } catch { /* None kept. */ }
    return STARTING_MEMORY;
}
export function writeMemory(memory: Memory) { try { localStorage.setItem(KEY, JSON.stringify(memory)); } catch { /* This page only. */ } }
