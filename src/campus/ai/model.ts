// Which model answers: the free quota, kept going for love by hicancan and the student development centre, reached
// through the platform and asked when signed in; or one's own key to a provider that speaks OpenAI's chat completions,
// kept only on this device and used straight from it, with no sign-in. The same choice is android/.../ai/Assistant.kt.
import { freeService } from '@/world/assistant.json';

/** One's own provider: where its chat completions are, which model, and the key, which never leaves this device. */
export interface Own { base: string; model: string; key: string }
export interface ModelSelection { provider: string; model: string }
export interface ModelOption { id: string; name: string; enabled: boolean }
export interface ModelProvider { id: string; kind: 'api' | 'runtime'; name: string; base: string; key: string; enabled: boolean; models: ModelOption[] }
export interface ModelSettings { providers: ModelProvider[]; selection: ModelSelection }


/** DeepSeek, filled in to start from. */
export const STARTING_OWN: Own = { base: 'https://api.deepseek.com', model: 'deepseek-chat', key: '' };
const KEY = 'studev_ai_model';
export const MODEL_SETTINGS_CHANGED = 'studev:model-settings';
export const FREE_MODEL: ModelSelection = { provider: 'free', model: 'auto' };
export const RUNTIME_PROVIDER = 'runtime';
export { freeService };
export const freeProvider = { id: FREE_MODEL.provider, kind: 'free' as const, name: freeService.providerName, models: [{ id: FREE_MODEL.model, name: freeService.modelName, enabled: true }] };
export const runtimeProvider: ModelProvider = { id: RUNTIME_PROVIDER, kind: 'runtime', name: 'Local Runtime MCP', base: '', key: '', enabled: true, models: [] };
type PreviousChoice = { use?: 'free' | 'own' | 'runtime'; own?: Own; runtime?: { model?: string } };

export function readModelSettings(): ModelSettings {
    const defaults: ModelSettings = { providers: [], selection: FREE_MODEL };
    try {
        const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as (Partial<ModelSettings> & PreviousChoice) | null;
        if (!raw) return defaults;
        if (Array.isArray(raw.providers) && raw.selection) return { providers: raw.providers, selection: raw.selection };
        const providers: ModelProvider[] = [];
        const legacy = raw.own;
        let selection = FREE_MODEL;
        if (legacy?.key && legacy.model && !addressError(legacy.base)) {
            const id = 'personal';
            providers.push({ id, kind: 'api', name: new URL(legacy.base).hostname, base: legacy.base, key: legacy.key, enabled: true, models: [{ id: legacy.model, name: legacy.model, enabled: true }] });
            if (raw.use === 'own') selection = { provider: id, model: legacy.model };
        }
        if (raw.runtime?.model) {
            providers.push({ ...runtimeProvider, models: [{ id: raw.runtime.model, name: raw.runtime.model, enabled: true }] });
            if (raw.use === 'runtime') selection = { provider: RUNTIME_PROVIDER, model: raw.runtime.model };
        }
        const settings = { providers, selection };
        try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* This page can still use the old settings. */ }
        return settings;
    } catch { /* Nothing chosen yet. */ }
    return defaults;
}
export function writeModelSettings(settings: ModelSettings) {
    localStorage.setItem(KEY, JSON.stringify(settings));
    window.dispatchEvent(new Event(MODEL_SETTINGS_CHANGED));
}

export function selectedProvider(settings: ModelSettings, selection: ModelSelection) {
    if (selection.provider === FREE_MODEL.provider && selection.model === FREE_MODEL.model) return freeProvider;
    return settings.providers.find(provider => provider.id === selection.provider && provider.enabled && provider.models.some(model => model.id === selection.model && model.enabled));
}

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
export async function fetchModels(base: string, key: string, signal?: AbortSignal): Promise<string[]> {
    if (addressError(base)) throw new Error('接口地址格式不对');
    if (!key.trim()) throw new Error('请先填写 API Key');
    for (const url of modelsEndpoints(base)) {
        const res = await fetch(url, { credentials: 'omit', redirect: 'error', headers: { Authorization: `Bearer ${key.trim()}` }, signal });
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
