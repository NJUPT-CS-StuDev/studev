import { useEffect, useState } from 'react';
import { Toggle, TextAction } from '@/world/ui';
import { campusToolGroups, listBrowserTools, readToolPreferences, writeToolPreferences, type BrowserTool } from './toolCatalog';
import RemoteMcpSettings from './RemoteMcpSettings';

export default function ToolSettings() {
    const [preferences, setPreferences] = useState(readToolPreferences);
    const [browser, setBrowser] = useState<BrowserTool[]>([]);
    const [attempt, setAttempt] = useState(0);
    const [status, setStatus] = useState<'loading' | 'ready' | 'offline'>('loading');
    const [error, setError] = useState('');
    useEffect(() => {
        const controller = new AbortController();
        setStatus('loading');
        void listBrowserTools(controller.signal).then(tools => {
            if (!controller.signal.aborted) { setBrowser(tools); setStatus('ready'); }
        }, () => { if (!controller.signal.aborted) { setBrowser([]); setStatus('offline'); } });
        return () => controller.abort();
    }, [attempt]);
    function toggle(field: 'disabledCampus' | 'enabledBrowser', name: string) {
        const current = readToolPreferences();
        const values = new Set(current[field]);
        if (values.has(name)) values.delete(name); else values.add(name);
        const next = { ...current, [field]: [...values] };
        try { writeToolPreferences(next); setPreferences(next); setError(''); }
        catch { setError('工具设置暂时无法保存。'); }
    }
    return <>
        <h3 className="sh">StuDev MCP</h3>
        {campusToolGroups.map(group => <details className="tool-settings-group" key={group.label}>
            <summary className="kv"><span className="v">{group.label}</span><small>{Object.keys(group.tools).filter(name => !preferences.disabledCampus.includes(name)).length} 项已启用</small></summary>
            {Object.entries(group.tools).map(([name, label]) => <button type="button" className="kv" key={name} role="switch" aria-checked={!preferences.disabledCampus.includes(name)} onClick={() => toggle('disabledCampus', name)}>
                <span className="v">{label}</span><Toggle on={!preferences.disabledCampus.includes(name)} />
            </button>)}
        </details>)}
        <h3 className="sh gap">本机工具（Local Runtime）</h3>
        <p className="fine">这台电脑上的 Local Runtime 借给本网站的网页工具。启用的由 AI 调用，结果交给当前模型。浏览器模型在「模型」里开启。</p>
        {status === 'loading' && <p className="fine" role="status">正在连接 Local Runtime…</p>}
        {status === 'offline' && <p className="fine">没有连上 Local Runtime：请确认已安装并打开它和浏览器扩展。<TextAction onClick={() => setAttempt(value => value + 1)}>重试</TextAction></p>}
        {status === 'ready' && <p className="fine">已连接</p>}
        {status === 'ready' && !browser.length && <p className="fine">还没有网页工具授权给本网站：在 Local Runtime 里为 {typeof location === 'undefined' ? '本网站' : location.host} 授权后，这里会列出来。<TextAction onClick={() => setAttempt(value => value + 1)}>刷新</TextAction></p>}
        {browser.map(tool => <button type="button" className="kv" key={tool.capability} role="switch" aria-checked={preferences.enabledBrowser.includes(tool.capability)} onClick={() => toggle('enabledBrowser', tool.capability)}>
            <span className="v">{tool.label}</span><Toggle on={preferences.enabledBrowser.includes(tool.capability)} />
        </button>)}
        <RemoteMcpSettings />
        {error && <p role="alert" className="fine">{error}</p>}
    </>;
}
