// Which model answers: the free quota, kept going for love by hicancan and the student development centre, reached
// through the platform and asked when signed in; or one's own key to a provider that speaks OpenAI's chat completions,
// kept only on this device and used straight from it, with no sign-in. The same choice is android/.../ai/Assistant.kt.

/** One's own provider: where its chat completions are, which model, and the key, which never leaves this device. */
export interface Own { base: string; model: string; key: string }
export interface Choice { use: 'free' | 'own'; own: Own }

/** DeepSeek, filled in to start from. */
export const STARTING_OWN: Own = { base: 'https://api.deepseek.com', model: 'deepseek-flash', key: '' };
const KEY = 'studev_ai_model';

export function readChoice(): Choice {
    try {
        const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Choice | null;
        if (raw && (raw.use === 'free' || raw.use === 'own') && raw.own) return { use: raw.use === 'own' && raw.own.key ? 'own' : 'free', own: { ...STARTING_OWN, ...raw.own } };
    } catch { /* Nothing chosen yet. */ }
    return { use: 'free', own: STARTING_OWN };
}
export function writeChoice(choice: Choice) { try { localStorage.setItem(KEY, JSON.stringify(choice)); } catch { /* Kept for this page only. */ } }

/** Where a provider's chat completions are, from the address one gives: its root, or its /v1, or the endpoint itself. */
export const endpoint = (base: string) => {
    const root = base.trim().replace(/\/+$/, '');
    return root.endsWith('/chat/completions') ? root : `${root}/chat/completions`;
};
/** A key is sent only to the HTTPS address explicitly entered, with no embedded credentials or query. */
export function addressError(base: string): string | null {
    try {
        const url = new URL(base.trim());
        if (url.protocol === 'https:' && url.hostname && !url.username && !url.password && !url.search && !url.hash) return null;
    } catch { /* The settings form says what is missing. */ }
    return '请填写完整的 HTTPS 接口地址，不带账号、查询参数或片段。';
}
/** What one's own model is called in the picker. */
export const ownName = (own: Own) => own.model || '我的 API';
