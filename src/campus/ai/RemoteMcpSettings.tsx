import { useEffect, useRef, useState } from 'react';
import { Toggle } from '@/world/ui';
import { discoverRemoteTools, readRemoteConnections, remoteUrl, saveRemoteConnections, type RemoteConnection } from './remoteMcp';

export default function RemoteMcpSettings() {
    const [connections, setConnections] = useState(readRemoteConnections);
    const [draft, setDraft] = useState<RemoteConnection>();
    const [confirm, setConfirm] = useState(false);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState('');
    const active = useRef<AbortController | undefined>(undefined);
    useEffect(() => () => active.current?.abort(), []);
    const patch = (value: Partial<RemoteConnection>) => setDraft(item => item ? { ...item, ...value } : item);
    function save(items: RemoteConnection[]) {
        saveRemoteConnections(items); setConnections(items);
    }
    function edit(item?: RemoteConnection) {
        setStatus(''); setConfirm(false);
        setDraft(item ?? { id: crypto.randomUUID(), name: '', url: '', token: '', enabled: true });
    }
    async function connect() {
        if (!draft || !draft.name.trim() || busy) return;
        const controller = new AbortController(); active.current = controller;
        setBusy(true); setStatus('正在连接 MCP 服务…');
        try {
            const next = { ...draft, name: draft.name.trim().slice(0, 60), url: remoteUrl(draft.url), token: draft.token.trim() };
            const tools = await discoverRemoteTools(next, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), true);
            if (controller.signal.aborted) return;
            save([...readRemoteConnections().filter(item => item.id !== next.id), next]);
            setDraft(undefined); setStatus(`已连接 ${next.name}，发现 ${tools.length} 项只读工具。`);
        } catch (error) {
            if (!controller.signal.aborted) setStatus(error instanceof Error && error.name !== 'TimeoutError' ? error.message : '连接超时，请稍后重试。');
        } finally { if (!controller.signal.aborted) setBusy(false); }
    }
    function enable(connection: RemoteConnection) {
        try { save(readRemoteConnections().map(item => item.id === connection.id ? { ...item, enabled: !item.enabled } : item)); setStatus(''); }
        catch { setStatus('无法保存 MCP 设置。'); }
    }
    return <section className="remote-mcp-settings" aria-label="外部 MCP">
        <h3 className="sh gap">外部 MCP</h3>
        <p className="fine">连接你信任的 HTTPS MCP 服务。启用后，模型可调用其只读工具，工具参数会发送给该服务。</p>
        {!draft && connections.map(connection => <div className="kv" key={connection.id}>
            <button className="v remote-mcp-name" type="button" onClick={() => edit(connection)}>{connection.name}</button>
            <button type="button" className="remote-mcp-switch" role="switch" aria-label={`启用 ${connection.name}`} aria-checked={connection.enabled} onClick={() => enable(connection)}><Toggle on={connection.enabled} /></button>
        </div>)}
        {!draft && connections.length < 8 && <div className="ai-project-actions"><button className="btn" type="button" onClick={() => edit()}>添加 MCP 服务</button></div>}
        {draft && <form className="ai-project-settings" onSubmit={event => { event.preventDefault(); void connect(); }}>
            <label>名称<input className="tf" type="text" maxLength={60} required value={draft.name} onChange={event => patch({ name: event.target.value })} disabled={busy} /></label>
            <label>MCP 地址<input className="tf" type="url" maxLength={2048} required value={draft.url} placeholder="https://mcp.context7.com/mcp" onChange={event => patch({ url: event.target.value })} disabled={busy} /></label>
            <label>密钥（可选）<input className="tf" type="password" maxLength={4096} autoComplete="off" value={draft.token} onChange={event => patch({ token: event.target.value })} disabled={busy} /></label>
            <div className="ai-project-actions">
                {connections.some(item => item.id === draft.id) && <button className="btn danger" type="button" disabled={busy} onClick={() => {
                    if (!confirm) { setConfirm(true); return; }
                    try { save(readRemoteConnections().filter(item => item.id !== draft.id)); setDraft(undefined); setStatus('已移除连接。'); }
                    catch { setStatus('无法移除连接。'); }
                }}>{confirm ? '确认移除' : '移除连接'}</button>}
                <button className="btn" type="button" disabled={busy} onClick={() => setDraft(undefined)}>取消</button>
                <button className="btn go" disabled={busy || !draft.name.trim() || !draft.url.trim()}>{busy ? '正在验证…' : '连接并保存'}</button>
            </div>
        </form>}
        {status && <p className="fine" role="status">{status}</p>}
    </section>;
}
