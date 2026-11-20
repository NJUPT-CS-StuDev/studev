import { createLRMCPClient } from '@local-runtime-mcp/browser-extension/sdk';
import { toolsFor, type ModelTool, type Reach, type Situation } from '@/world/assistant.mjs';
import groups from '@/world/tool-menu.json';
import permissionModes from '@/world/permission-modes.json';
import type { Message } from './stream';
import type { RemoteTool } from './remoteMcp';

export type BrowserTool = { capability: string; label: string; definition: ModelTool };
export type ToolItem = { label: string; group: string; definition: ModelTool; browser?: BrowserTool; remote?: RemoteTool };
export type LocalRuntimeSnapshot = { state: 'unknown' | 'ready' | 'offline'; models: string[]; granted: BrowserTool[] };
export type PermissionMode = 'review' | 'read' | 'approved';
export type ToolPreferences = { disabledCampus: string[]; enabledBrowser: string[]; mode?: PermissionMode };
const STORAGE = 'studev_ai_tools';
export const TOOL_SETTINGS_CHANGED = 'studev:tool-settings';
export const BROWSER_GROUP = '网页工具';
export const campusToolGroups = groups;
export const toolPermissionModes = permissionModes as { id: PermissionMode; label: string; description: string }[];
export const campusToolLabels = Object.fromEntries(groups.flatMap(group => Object.entries(group.tools)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));

export function readToolPreferences(): ToolPreferences {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE) ?? 'null');
        const names = (value: unknown) => Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : [];
        const mode = toolPermissionModes.find(item => item.id === saved?.mode)?.id ?? 'read';
        return { disabledCampus: names(saved?.disabledCampus), enabledBrowser: names(saved?.enabledBrowser), mode };
    } catch { return { disabledCampus: [], enabledBrowser: [] }; }
}
export function needsToolConfirmation(mode: PermissionMode, item: ToolItem): boolean {
    return item.definition.function.name === 'remember' && mode !== 'approved' || Boolean((item.browser || item.remote) && mode === 'review');
}

export function writeToolPreferences(preferences: ToolPreferences) {
    localStorage.setItem(STORAGE, JSON.stringify(preferences));
    window.dispatchEvent(new Event(TOOL_SETTINGS_CHANGED));
}

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export function browserToolId(capability: string): string {
    return `web_${capability.replaceAll('_', '__').replaceAll('.', '_d')}`;
}

/** The bridge returns only this origin's grants. The AI deliberately advertises their read-only subset. */
export function browserToolCatalog(value: unknown): BrowserTool[] {
    if (!Array.isArray(value)) throw new Error('浏览器工具列表无效。');
    const entries = new Map<string, BrowserTool>();
    for (const item of value) {
        if (!object(item) || typeof item.name !== 'string' || !/^[a-z][a-z0-9_.-]*$/.test(item.name) ||
            !object(item.annotations) || item.annotations.readOnlyHint !== true || item.annotations.destructiveHint === true ||
            !object(item.inputSchema) || item.inputSchema.type !== 'object' || typeof item.description !== 'string' || !item.description.trim()) continue;
        const name = browserToolId(item.name);
        if (name.length > 64 || entries.has(name)) continue;
        const label = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : item.name === 'icourse.outline' ? '查看 MOOC 课程目录' : item.name;
        entries.set(name, { capability: item.name, label, definition: { type: 'function', function: { name, description: `${label}。${item.description}`, parameters: item.inputSchema } } });
    }
    return [...entries.values()];
}

export async function listBrowserTools(signal?: AbortSignal): Promise<BrowserTool[]> {
    return browserToolCatalog(await createLRMCPClient().listCapabilities({ signal, timeoutMs: 3500 }));
}

export async function invokeBrowserTool(tool: BrowserTool, input: unknown, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw signal.reason;
    if (!readToolPreferences().enabledBrowser.includes(tool.capability)) throw new Error('这个网页工具已停用。');
    if (!object(input)) throw new Error('模型提供的工具参数无效。');
    try {
        const value = await createLRMCPClient().invoke(tool.capability, input, { signal, timeoutMs: 15000 });
        if (JSON.stringify(value)?.length > 35000) throw new Error('工具返回内容过长。');
        return value;
    } catch (error) {
        if (signal.aborted) throw error;
        const source = error instanceof Error ? error.message : '';
        if (/owner-configured target page/.test(source)) throw new Error('请打开此工具在 Local Runtime 中绑定的页面。');
        if (/several target tabs/.test(source)) throw new Error('这项工具匹配到多个标签页，请保留一个。');
        if (/not granted|no local runtime grant/.test(source)) throw new Error('本网站的工具授权已失效。');
        if (source === '工具返回内容过长。') throw error;
        throw new Error('网页工具暂时无法访问，请检查 Local Runtime 和对应页面。');
    }
}

export function toolCatalog(situation: Situation, preferences: ToolPreferences, browser: readonly BrowserTool[], remote: readonly RemoteTool[] = []): ToolItem[] {
    const available = new Map((toolsFor(situation) as ModelTool[]).map(tool => [tool.function.name, tool]));
    const campus = groups.flatMap(group => Object.entries(group.tools).flatMap(([name, label]) => {
        const definition = available.get(name);
        return definition && label && !preferences.disabledCampus.includes(name) ? [{ label, group: group.label, definition }] : [];
    }));
    return [...campus, ...browser.filter(tool => preferences.enabledBrowser.includes(tool.capability))
        .map(tool => ({ label: tool.label, group: BROWSER_GROUP, definition: tool.definition, browser: tool })),
        ...remote.map(tool => ({ label: tool.label, group: tool.connection.name, definition: tool.definition, remote: tool }))];
}

/** What this tab can reach besides the campus tools, as facts for the assistant (assistant.mjs phrases them). */
export function reachOf(runtime: LocalRuntimeSnapshot, preferences: ToolPreferences, canUseBrowser: boolean, remote: readonly RemoteTool[]): Reach {
    const on = runtime.granted.filter(tool => preferences.enabledBrowser.includes(tool.capability));
    return { runtime: runtime.state, models: runtime.models.slice(0, 24), on: on.map(tool => tool.label).slice(0, 24),
        off: runtime.granted.filter(tool => !on.includes(tool)).map(tool => tool.label).slice(0, 24), free: !canUseBrowser,
        remote: [...new Set(remote.map(tool => tool.connection.name))].slice(0, 24) };
}

/** Strip earlier calls and their results together when this model will not have the corresponding capability. */
export function toolHistory(messages: Message[], available: ReadonlySet<string>, hosted: boolean): Message[] {
    const removed = new Set<string>();
    return messages.flatMap(message => {
        if (message.role === 'tool' && message.tool_call_id && removed.has(message.tool_call_id)) return [];
        if (!message.tool_calls) return [message];
        const tool_calls = message.tool_calls.filter(call => {
            const name = call.function.name;
            if (!(name.startsWith('mcp_') || name.startsWith('web_')) || available.has(name) && !(hosted && name.startsWith('web_'))) return true;
            removed.add(call.id);
            return false;
        });
        if (tool_calls.length === message.tool_calls.length) return [message];
        const { tool_calls: _, ...text } = message;
        return tool_calls.length ? [{ ...message, tool_calls }] : text.content ? [text] : [];
    });
}
