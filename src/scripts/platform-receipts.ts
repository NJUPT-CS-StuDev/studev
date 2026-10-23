export interface LocalReceipt {
    id: string;
    formId: string;
    title: string;
    token: string;
    createdAt: string;
    completed: boolean;
    abandoned?: boolean;
}
const key = 'studev-form-receipts-v1';
export function receiptStorageAvailable():boolean {
    const probe='studev-receipt-storage-probe';
    try { sessionStorage.setItem(probe,'1'); const ok=sessionStorage.getItem(probe)==='1';sessionStorage.removeItem(probe);return ok; }
    catch { return false; }
}
export function receipts(): LocalReceipt[] { try {
    const value = JSON.parse(sessionStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value.filter(v => v && typeof v.id === 'string' && typeof v.token === 'string').slice(-100) : [];
}
catch {
    return [];
} }
export function rememberReceipt(value: LocalReceipt) { try {
    const items = receipts().filter(v => v.id !== value.id);
    items.push(value);
    sessionStorage.setItem(key, JSON.stringify(items.slice(-100)));
    return true;
}
catch {
    return false;
} }
export function forgetReceipt(id: string) { try {
    sessionStorage.setItem(key, JSON.stringify(receipts().filter(v => v.id !== id)));
}
catch { /* Storage may be unavailable. */ } }
