// The conversations kept on this device, as ChatGPT lists them: each named by its first question until renamed, the
// newest first, grouped by when they were last spoken in. The same rules are android/.../ai/Chats.kt.
import { path, type Thread } from './thread';

/** One conversation: its name (empty until one is given, then its first question names it) and when it last changed. */
export interface Saved<P> { id: string; title: string; updated: number; thread: Thread; proposals: P[] }

/** What a conversation is called: the name given it, else its first question, cut to a line. */
export function titleOf(chat: { title: string; thread: Thread }): string {
    if (chat.title.trim()) return chat.title.trim();
    const first = path(chat.thread).find(node => node.message.role === 'user')?.message.content ?? '';
    const line = first.replace(/\s+/g, ' ').trim();
    return line.length > 28 ? `${line.slice(0, 28)}…` : line || '新对话';
}

/** Whole days from one moment to another, counted in local days. */
const daysApart = (from: number, to: number) => {
    const day = (ms: number) => { const at = new Date(ms); return Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()) / 86400000; };
    return day(to) - day(from);
};

/** The conversations newest first, in groups: 今天, 昨天, 前 7 天, 前 30 天, then by month. */
export function chatGroups<P>(chats: Saved<P>[], now: number): { name: string; chats: Saved<P>[] }[] {
    const groups = new Map<string, Saved<P>[]>();
    for (const chat of [...chats].sort((left, right) => right.updated - left.updated)) {
        const days = daysApart(chat.updated, now), at = new Date(chat.updated);
        const name = days <= 0 ? '今天' : days === 1 ? '昨天' : days <= 7 ? '前 7 天' : days <= 30 ? '前 30 天' : `${at.getFullYear()}年${at.getMonth() + 1}月`;
        groups.set(name, [...(groups.get(name) ?? []), chat]);
    }
    return [...groups].map(([name, list]) => ({ name, chats: list }));
}
