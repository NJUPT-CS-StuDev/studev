import { useEffect, useState } from 'react';
import { Toggle, TextAction } from '@/world/ui';
import { campusToolGroups, listBrowserTools, readToolPreferences, writeToolPreferences, type BrowserTool } from './toolCatalog';

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
        <h3 className="sh gap">Local Runtime MCP</h3>
        <p className="fine">暂无可用于此聊天的本机工具。</p>
        <h3 className="sh gap">Web MCP</h3>
        <p className="fine">启用后，AI 可以调用已授权的网页工具，读取结果会交给当前模型。支持自填 API 和本机浏览器模型。</p>
        {status === 'loading' && <p className="fine" role="status">正在查找已授权的网页工具…</p>}
        {status === 'offline' && <p className="fine">暂时连不上 Local Runtime MCP。<TextAction onClick={() => setAttempt(value => value + 1)}>重试</TextAction></p>}
        {status === 'ready' && !browser.length && <p className="fine">在 Local Runtime MCP 中授权本网站后，这里会显示可启用的网页工具。<TextAction onClick={() => setAttempt(value => value + 1)}>刷新</TextAction></p>}
        {browser.map(tool => <button type="button" className="kv" key={tool.capability} role="switch" aria-checked={preferences.enabledBrowser.includes(tool.capability)} onClick={() => toggle('enabledBrowser', tool.capability)}>
            <span className="v">{tool.label}</span><Toggle on={preferences.enabledBrowser.includes(tool.capability)} />
        </button>)}
        {error && <p role="alert" className="fine">{error}</p>}
    </>;
}
