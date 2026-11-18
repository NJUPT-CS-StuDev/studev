import type { ModelTool } from '@/world/assistant.mjs';
import { externalAlias, externalDescription, externalParameters, externalSchemaBudget, externalToolLimit } from '@/world/external-tools.mjs';
import product from '../../../product.json';

const STORAGE = 'studev_ai_remote_mcp';
export const REMOTE_MCP_CHANGED = 'studev:remote-mcp';
const versions = ['2025-11-25', '2025-06-18', '2025-03-26'];
const wireLimit = 524288;

export interface RemoteConnection { id: string; name: string; url: string; token: string; enabled: boolean }
interface Session { connection: RemoteConnection; version: string; token?: string }
export interface RemoteTool { connection: RemoteConnection; name: string; label: string; definition: ModelTool; session: Session; schemaBytes: number }

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

export function remoteUrl(text: string): string {
    try {
        const url = new URL(text.trim());
        if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error();
        if (url.href.length > 2048) throw new Error();
        return url.href;
    } catch { throw new Error('请输入完整的 HTTPS MCP 地址。'); }
}

export function readRemoteConnections(): RemoteConnection[] {
    try {
        const value: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? '[]');
        if (!Array.isArray(value)) return [];
        return value.filter(item => object(item) && typeof item.id === 'string' && /^[a-f0-9-]{36}$/.test(item.id) && typeof item.name === 'string' && typeof item.url === 'string' && typeof item.token === 'string' && typeof item.enabled === 'boolean');
    } catch { return []; }
}

export function saveRemoteConnections(items: RemoteConnection[]) {
    localStorage.setItem(STORAGE, JSON.stringify(items));
    for (const [id, cached] of existing) if (!items.some(item => item.id === id && item.enabled && same(item, cached.connection))) existing.delete(id);
    window.dispatchEvent(new Event(REMOTE_MCP_CHANGED));
}

export function remoteAlias(id: string, name: string): string | undefined {
    const prefix = id.replaceAll('-', '').slice(0, 12);
    if (!/^[a-f0-9]{12}$/.test(prefix) || !/^[A-Za-z0-9_.-]{1,47}$/.test(name)) return;
    const alias = `mcp_${prefix}_${name.replaceAll('_', '__').replaceAll('.', '_d')}`;
    return externalAlias.test(alias) ? alias : undefined;
}

function replyText(packet: unknown, id: string): Record<string, unknown> | undefined {
    if (!object(packet) || packet.jsonrpc !== '2.0' || packet.id !== id) return undefined;
    if (packet.error || !object(packet.result)) throw new Error('MCP 服务未完成此请求。');
    return packet.result;
}

async function readReply(response: Response, id: string) {
    const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
    if (!reader) throw new Error('MCP 服务没有返回数据。');
    const mime = response.headers.get('content-type')?.split(';')[0];
    if (mime !== 'application/json' && mime !== 'text/event-stream') throw new Error('MCP 服务响应格式不受支持。');
    let buffer = '', received = 0;
    try {
        for (let part = await reader.read(); !part.done; part = await reader.read()) {
            received += part.value.length;
            if (received > wireLimit) throw new Error('MCP 服务返回的数据过多。');
            buffer += part.value;
            if (mime !== 'text/event-stream') continue;
            let boundary = /\r?\n\r?\n/.exec(buffer);
            while (boundary) {
                const frame = buffer.slice(0, boundary.index);
                buffer = buffer.slice(boundary.index + boundary[0].length);
                const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
                if (data) {
                    const reply = replyText(JSON.parse(data), id);
                    if (reply) return reply;
                }
                boundary = /\r?\n\r?\n/.exec(buffer);
            }
        }
        if (mime === 'application/json') {
            const reply = replyText(JSON.parse(buffer), id);
            if (reply) return reply;
        }
        throw new Error('MCP 服务没有返回完整结果。');
    } finally { void reader.cancel().catch(() => {}); }
}

async function rpc(session: Session, method: string, params: object, signal?: AbortSignal) {
    const { connection } = session;
    const id = method === 'notifications/initialized' ? undefined : crypto.randomUUID();
    const headers: Record<string, string> = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' };
    if (session.version) headers['MCP-Protocol-Version'] = session.version;
    if (session.token) headers['Mcp-Session-Id'] = session.token;
    if (connection.token) headers.Authorization = `Bearer ${connection.token}`;
    let response: Response;
    try {
        response = await fetch(remoteUrl(connection.url), { method: 'POST', headers, redirect: 'error', credentials: 'omit', cache: 'no-store',
            body: JSON.stringify({ jsonrpc: '2.0', method, params, ...(id ? { id } : {}) }), signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15000)]) });
    } catch (error) {
        if (signal?.aborted) throw error;
        throw new Error('连不上 MCP 服务。请检查地址、网络和浏览器访问设置。');
    }
    if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new Error(response.status === 401 || response.status === 403 ? 'MCP 服务拒绝认证，请检查密钥。' : `MCP 服务暂时无法响应（${response.status}）。`);
    }
    const token = response.headers.get('mcp-session-id');
    if (token && /^[\x21-\x7e]{1,250}$/.test(token)) session.token = token;
    if (id) return await readReply(response, id);
    void response.body?.cancel().catch(() => {});
    return {};
}

const existing = new Map<string, { connection: RemoteConnection; until: number; tools: RemoteTool[] }>();
const same = (a: RemoteConnection, b: RemoteConnection) => a.url === b.url && a.token === b.token && a.name === b.name;

export async function discoverRemoteTools(connection: RemoteConnection, signal?: AbortSignal, refresh = false): Promise<RemoteTool[]> {
    const old = existing.get(connection.id);
    if (!refresh && old && old.until > Date.now() && same(old.connection, connection)) return old.tools;
    const session = { connection, version: '' } as Session;
    const init = await rpc(session, 'initialize', { protocolVersion: versions[0], capabilities: {}, clientInfo: { name: 'StuDev', version: product.android.versionName } }, signal);
    if (typeof init.protocolVersion !== 'string' || !versions.includes(init.protocolVersion)) throw new Error('MCP 服务使用了当前客户端不支持的协议版本。');
    session.version = init.protocolVersion;
    await rpc(session, 'notifications/initialized', {}, signal);
    const found = new Map<string, RemoteTool>();
    let cursor: string | undefined;
    for (let page = 0; page < 4 && found.size < externalToolLimit; page++) {
        const result = await rpc(session, 'tools/list', cursor ? { cursor } : {}, signal);
        if (!Array.isArray(result.tools)) throw new Error('MCP 工具列表无效。');
        for (const tool of result.tools) {
            if (found.size === externalToolLimit) break;
            if (!object(tool) || typeof tool.name !== 'string' || !object(tool.annotations) || tool.annotations.readOnlyHint !== true || tool.annotations.destructiveHint === true) continue;
            const name = remoteAlias(connection.id, tool.name);
            const schema = externalParameters(tool.inputSchema);
            if (!name || found.has(name) || !schema) continue;
            const label = (typeof tool.title === 'string' && tool.title.trim() || typeof tool.annotations.title === 'string' && tool.annotations.title.trim() || tool.name).slice(0, 80);
            const description = externalDescription(`${connection.name} · ${label}。${typeof tool.description === 'string' ? tool.description.trim() : ''}`);
            found.set(name, { connection, name: tool.name, label, session, schemaBytes: schema.bytes, definition: { type: 'function', function: { name, description, parameters: schema.parameters } } });
        }
        if (typeof result.nextCursor !== 'string' || !result.nextCursor || result.nextCursor === cursor || result.nextCursor.length > 1024) break;
        cursor = result.nextCursor;
    }
    const tools = [...found.values()];
    existing.set(connection.id, { connection, until: Date.now() + 5 * 60_000, tools });
    return tools;
}

export async function activeRemoteTools(signal: AbortSignal): Promise<RemoteTool[]> {
    const active = readRemoteConnections().filter(connection => connection.enabled);
    const results = await Promise.allSettled(active.map(connection => discoverRemoteTools(connection, signal)));
    const tools: RemoteTool[] = [];
    let remaining = externalSchemaBudget;
    for (const result of results) if (result.status === 'fulfilled') for (const tool of result.value) {
        if (tools.length < externalToolLimit && tool.schemaBytes <= remaining) { tools.push(tool); remaining -= tool.schemaBytes; }
    }
    return tools;
}

export async function invokeRemoteTool(tool: RemoteTool, args: unknown, signal: AbortSignal) {
    const current = readRemoteConnections().find(connection => connection.id === tool.connection.id);
    if (!current?.enabled || !same(current, tool.connection)) throw new Error('外部 MCP 连接已变更或停用。');
    if (!object(args) || size(args) > 4096) throw new Error('模型提供的参数无法使用。');
    const response = await rpc(tool.session, 'tools/call', { name: tool.name, arguments: args }, signal);
    if (response.isError) throw new Error('外部 MCP 工具未返回结果。');
    let text = '';
    if (Array.isArray(response.content)) for (const part of response.content) {
        if (object(part) && part.type === 'text' && typeof part.text === 'string') text += `${text ? '\n\n' : ''}${part.text.slice(0, 24000 - text.length)}`;
        if (text.length >= 24000) break;
    }
    if (!text && object(response.structuredContent)) text = JSON.stringify(response.structuredContent).slice(0, 24000);
    return { tool: tool.label, via: current.name, text: text.slice(0, 24000) };
}
