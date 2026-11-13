// A conversation as a tree, as ChatGPT keeps one: a question changed, or an answer asked again, grows a new branch
// beside the old one instead of replacing it, and one goes back and forth between them. What is shown, and what the
// model is given, is the path the chosen branches make from the start. The same rules are android/.../ai/Thread.kt.
import type { Message } from './stream';

/** One message, and the one it follows ('' for the first). */
export interface Node { id: string; parent: string; message: Message }
/** Every message ever said here, and at each fork the branch last chosen. */
export interface Thread { nodes: Node[]; chosen: Record<string, string> }

export const START = '';
export const emptyThread = (): Thread => ({ nodes: [], chosen: {} });

/** What follows a message, oldest first. */
export const children = (thread: Thread, parent: string) => thread.nodes.filter(node => node.parent === parent);

/** The conversation as shown: from the start, at each fork the branch chosen, else the newest. */
export function path(thread: Thread): Node[] {
    const out: Node[] = [];
    for (let at = START; ;) {
        const next = children(thread, at);
        if (!next.length) return out;
        const pick = next.find(node => node.id === thread.chosen[at]) ?? next.at(-1)!;
        out.push(pick);
        at = pick.id;
    }
}

/** The last message shown, which the next one follows. */
export const tip = (thread: Thread) => path(thread).at(-1)?.id ?? START;

/** A message and everything before it, oldest first: what the model is given when answering after it. */
export function lineage(thread: Thread, id: string): Node[] {
    const byId = new Map(thread.nodes.map(node => [node.id, node]));
    const out: Node[] = [];
    for (let node = byId.get(id); node; node = byId.get(node.parent)) out.unshift(node);
    return out;
}

/** A message said after `parent`, and its branch chosen there. */
export const append = (thread: Thread, parent: string, id: string, message: Message): Thread =>
    ({ nodes: [...thread.nodes, { id, parent, message }], chosen: { ...thread.chosen, [parent]: id } });

/** A branch chosen at its fork. */
export function choose(thread: Thread, id: string): Thread {
    const node = thread.nodes.find(item => item.id === id);
    return node ? { ...thread, chosen: { ...thread.chosen, [node.parent]: id } } : thread;
}

/** Where a message stands among those beside it: the n-th of how many, and the ones before and after. */
export function siblings(thread: Thread, id: string): { index: number; count: number; previous?: string; next?: string } {
    const node = thread.nodes.find(item => item.id === id);
    const all = node ? children(thread, node.parent) : [];
    const index = all.findIndex(item => item.id === id);
    return { index, count: all.length, previous: all[index - 1]?.id, next: all[index + 1]?.id };
}

/** Messages said one after another, as a thread without forks. */
export const chain = (messages: Message[], ids: string[]): Thread =>
    messages.reduce((thread, message, at) => append(thread, at ? ids[at - 1]! : START, ids[at]!, message), emptyThread());
