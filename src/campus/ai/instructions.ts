import { useSyncExternalStore } from 'react';
import { readCachedAccount, subscribeCachedAccount } from '../../platform/client/auth-status';
import assistant from '@/world/assistant.json';

export const PERSONAL_LIMIT = 4000;
export const PROJECT_LIMIT = 8000;
export const DEFAULT_INSTRUCTIONS = assistant.style;
const key = 'studev_ai_instructions:';
const changed = 'studev:ai-instructions';

export function instructionOwner(): string | null {
    const account = readCachedAccount();
    return account ? account.id ?? null : 'guest';
}

export function readPersonalInstructions(): string {
    try {
        const owner = instructionOwner();
        return (owner ? localStorage.getItem(key + owner) : null) ?? DEFAULT_INSTRUCTIONS;
    } catch { return DEFAULT_INSTRUCTIONS; }
}

export function writePersonalInstructions(owner: string, value: string) {
    if (owner !== instructionOwner()) throw new Error('当前账号已切换，请重新打开个人指令。');
    localStorage.setItem(key + owner, value.trim().slice(0, PERSONAL_LIMIT));
    window.dispatchEvent(new Event(changed));
}

function subscribe(change: () => void) {
    const cancel = subscribeCachedAccount(change);
    const storage = (event: StorageEvent) => { if (!event.key || event.key.startsWith(key)) change(); };
    window.addEventListener(changed, change);
    window.addEventListener('storage', storage);
    return () => { cancel(); window.removeEventListener(changed, change); window.removeEventListener('storage', storage); };
}

export const usePersonalInstructions = () => useSyncExternalStore(subscribe, readPersonalInstructions, () => DEFAULT_INSTRUCTIONS);
export const useInstructionOwner = () => useSyncExternalStore(subscribe, instructionOwner, () => null);

export function combinedInstructions(personal: string, project?: string): string {
    const note = project?.trim();
    if (!note) return personal.trim().slice(0, PERSONAL_LIMIT);
    return [`个人指令\n${personal.trim().slice(0, PERSONAL_LIMIT)}`, `项目指令\n${note.slice(0, PROJECT_LIMIT)}`].join('\n\n').slice(0, 12000);
}
