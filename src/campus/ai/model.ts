// Which model answers: the free quota, kept going for love by hicancan and the student development centre, reached
// through the platform and asked when signed in; or one's own key to a provider that speaks OpenAI's chat completions,
// kept only on this device and used straight from it, with no sign-in. The same choice is android/.../ai/Assistant.kt.

/** One's own provider: where its chat completions are, which model, and the key, which never leaves this device. */
export interface Own { base: string; model: string; key: string }
export interface Choice { use: 'free' | 'own'; own: Own }

export const OWNER_QQ = '2366522877';
export const OWNER_AVATAR = `https://q1.qlogo.cn/g?b=qq&nk=${OWNER_QQ}&s=100`;

/** DeepSeek, filled in to start from. */
export const STARTING_OWN: Own = { base: 'https://api.deepseek.com', model: 'deepseek-chat', key: '' };
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
/** OpenAI-compatible model discovery endpoints, trying direct /models and falling back to /v1/models. */
export function modelsEndpoints(base: string): string[] {
    const root = base.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '').replace(/\/models$/, '');
    const first = `${root}/models`;
    return /\/v\d+$/.test(root) ? [first] : [first, `${root}/v1/models`];
}
export async function fetchModels(base: string, key: string): Promise<string[]> {
    if (addressError(base)) throw new Error('接口地址格式不对');
    if (!key.trim()) throw new Error('请先填写 API Key');
    for (const url of modelsEndpoints(base)) {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${key.trim()}` } });
        if (res.status === 404) continue;
        if (!res.ok) throw new Error(res.status === 401 ? 'API Key 无效或无权限' : `请求失败（${res.status}）`);
        const body = await res.json() as { data?: { id?: string }[] };
        const ids = [...new Set((body.data ?? []).map(item => item.id?.trim()).filter((id): id is string => Boolean(id)))];
        if (ids.length) return ids;
    }
    throw new Error('接口没有返回模型列表，可直接手动填写模型名');
}
/** A key is sent only to the HTTPS address explicitly entered, with no embedded credentials or query. */
export function addressError(base: string): string | null {
    try {
        const url = new URL(base.trim());
        if (url.protocol === 'https:' && url.hostname && !url.username && !url.password && !url.search && !url.hash) return null;
    } catch { /* The settings form says what is missing. */ }
    return '接口地址以 https:// 开头，只写地址本身。';
}
/** What one's own model is called in the picker. */
export const ownName = (own: Own) => own.model || '我的 API';
