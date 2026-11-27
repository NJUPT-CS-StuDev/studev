// This device's copy of the platform reads it has seen, kept per account. A page shows the copy at once and the
// server's answer when it arrives, so a read costs no round trip on the screen. The server stays the authority:
// every write, sign-in and sign-out drops the whole copy, and a copy is never used to authorize anything.
const NAME = 'studev-replica', STORE = 'reads', LIMIT = 256;

export interface Kept { text: string; at: number }

const memory = new Map<string, Kept>();
let epoch = 0;
let opened: Promise<IDBDatabase | null> | undefined;

function database(): Promise<IDBDatabase | null> {
    opened ||= new Promise(resolve => {
        try {
            const request = indexedDB.open(NAME, 1);
            request.onupgradeneeded = () => request.result.createObjectStore(STORE);
            request.onsuccess = () => resolve(request.result);
            request.onerror = request.onblocked = () => resolve(null);
        } catch { resolve(null); }
    });
    return opened;
}

async function transact<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    const db = await database();
    if (!db) return undefined;
    return new Promise(resolve => {
        try {
            const tx = db.transaction(STORE, mode);
            const request = work(tx.objectStore(STORE));
            tx.oncomplete = () => resolve(request ? request.result : undefined);
            tx.onerror = tx.onabort = () => resolve(undefined);
        } catch { resolve(undefined); }
    });
}

/** Whose copy a read belongs to: the account this device last confirmed, or nobody. */
export function owner(): string {
    try { return (JSON.parse(localStorage.getItem('studev_auth_user') || 'null') as { id?: string } | null)?.id || '-'; }
    catch { return '-'; }
}

export const stamp = () => epoch;

export async function recall(key: string): Promise<Kept | undefined> {
    const known = memory.get(key);
    if (known) return known;
    const since = epoch;
    const kept = await transact<Kept | undefined>('readonly', store => store.get(key) as IDBRequest<Kept | undefined>);
    if (!kept || since !== epoch || typeof kept.text !== 'string') return undefined;
    memory.set(key, kept);
    return kept;
}

/** Keeps an answer unless the copy was dropped after its request began. */
export function keep(key: string, text: string, since: number): Kept | undefined {
    if (since !== epoch) return undefined;
    const kept = { text, at: Date.now() };
    memory.set(key, kept);
    void transact('readwrite', store => {
        store.put(kept, key);
        const count = store.count();
        count.onsuccess = () => {
            if (count.result <= LIMIT) return;
            const all = store.getAll(), keys = store.getAllKeys();
            keys.onsuccess = () => {
                const entries = (all.result as Kept[]).map((value, index) => [value.at, keys.result[index]!] as const).sort((a, b) => a[0] - b[0]);
                for (const [, oldest] of entries.slice(0, entries.length - LIMIT)) store.delete(oldest);
            };
        };
    });
    return kept;
}

export function forget() {
    epoch++;
    memory.clear();
    void transact('readwrite', store => { store.clear(); });
}
