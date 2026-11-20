import assistant from '@/world/assistant.json';
import { readMemory, remembered, writeMemory } from './memory';

export const PROJECT_LIMIT = 8000;

/** What a project asks of the AI; the house style is the assistant's own, and what one asks for oneself is memory. */
export function projectInstructions(note?: string): string | undefined {
    return note?.trim() ? note.trim().slice(0, PROJECT_LIMIT) : undefined;
}

// Personal instructions used to live apart from memory, in this browser only. Whatever one wrote there becomes lines
// of memory once, so it follows the account like the rest; the house style it started from is not one's own.
const legacy = 'studev_ai_instructions:';
export function foldPersonalInstructions() {
    try {
        const keys = Object.keys(localStorage).filter(key => key.startsWith(legacy));
        let memory = readMemory();
        for (const key of keys) {
            const text = localStorage.getItem(key)?.trim() ?? '';
            if (text && text !== assistant.style.trim()) {
                for (const line of text.split('\n').map(line => line.replace(/^[-*#\s]+/, '').trim()).filter(Boolean)) {
                    try { memory = { ...memory, text: remembered(memory.text, line) }; } catch { break; }
                }
            }
            localStorage.removeItem(key);
        }
        if (keys.length) writeMemory(memory);
    } catch { /* storage unavailable: nothing was kept here */ }
}
