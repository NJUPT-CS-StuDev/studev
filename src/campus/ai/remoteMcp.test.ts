import { afterEach, expect, test, vi } from 'vitest';
import { discoverRemoteTools, invokeRemoteTool, remoteAlias, remoteUrl, type RemoteConnection } from './remoteMcp';
import { toolHistory } from './toolCatalog';

const server: RemoteConnection = { id: 'edade626-1494-48d8-ad2b-483f8084bf9a', name: '文档', url: 'https://docs.example/mcp', token: 'fixture', enabled: true };
afterEach(() => vi.unstubAllGlobals());

test('Remote MCP negotiates a session, offers only bounded readonly tools, and rechecks the enabled connection before calling', async () => {
    let connections = [server];
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(connections) });
    const names: string[] = [];
    const fetch = vi.fn(async (url: string, options: RequestInit) => {
        const { method, id, params } = JSON.parse(String(options.body));
        const headers = new Headers(options.headers);
        names.push(method);
        expect(url).toBe(server.url); expect(options.redirect).toBe('error');
        expect(headers.get('Authorization')).toBe('Bearer fixture');
        if (method !== 'initialize') expect(headers.get('Mcp-Session-Id')).toBe('fixture-session');
        if (method === 'notifications/initialized') return new Response(null, { status: 202 });
        if (method === 'initialize') return Response.json({ jsonrpc: '2.0', id, result: { protocolVersion: '2025-11-25' } }, { headers: { 'Mcp-Session-Id': 'fixture-session' } });
        if (method === 'tools/list') {
            const tools = [
                { name: 'read-doc', title: '读文档', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
                { name: 'write-doc', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true, destructiveHint: true } },
                { name: 'invalid-ref', inputSchema: { type: 'object', $ref: 'https://elsewhere/schema' }, annotations: { readOnlyHint: true } },
            ];
            return new Response(`event: message\r\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result: { tools } })}\r\n\r\n`, { headers: { 'Content-Type': 'text/event-stream' } });
        }
        expect(params).toEqual({ name: 'read-doc', arguments: { query: '例子' } });
        return Response.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: '真实工具结果的夹具' }] } });
    });
    vi.stubGlobal('fetch', fetch);
    const tools = await discoverRemoteTools(server, undefined, true);
    expect(tools.map(tool => tool.label)).toEqual(['读文档']);
    const signal = new AbortController().signal;
    expect(await invokeRemoteTool(tools[0]!, { query: '例子' }, signal)).toEqual({ tool: '读文档', via: '文档', text: '真实工具结果的夹具' });
    connections = [{ ...server, enabled: false }];
    await expect(invokeRemoteTool(tools[0]!, {}, signal)).rejects.toThrow('已变更或停用');
    expect(names).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
});

test('External aliases and history preserve distinct names and carry paired results only for active connections', () => {
    const name = remoteAlias(server.id, 'docs.lookup')!;
    expect(name).not.toBe(remoteAlias(server.id, 'docs_dlookup'));
    expect(() => remoteUrl('http://docs.example/mcp')).toThrow();
    expect(() => remoteUrl('https://secret@docs.example/mcp')).toThrow();
    const history = [
        { role: 'user', content: '文档' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'doc', type: 'function', function: { name, arguments: '{}' } }] },
        { role: 'tool', content: '示例', tool_call_id: 'doc' },
    ] as const;
    const messages = history.map(message => ({ ...message, ...('tool_calls' in message ? { tool_calls: [...message.tool_calls] } : {}) }));
    expect(toolHistory(messages, new Set([name]), true)).toHaveLength(3);
    expect(toolHistory(messages, new Set(), true)).toEqual([history[0]]);
});
