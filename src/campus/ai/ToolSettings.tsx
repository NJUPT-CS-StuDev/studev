import { useEffect, useState } from 'react';
import { Toggle, TextAction } from '@/world/ui';
import { campusToolGroups, listBrowserTools, readToolPreferences, writeToolPreferences, type BrowserTool, type ToolPreferences } from './toolCatalog';
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
    function save(next: ToolPreferences) {
        try { writeToolPreferences(next); setPreferences(next); setError(''); }
        catch { setError('工具设置暂时无法保存。'); }
    }
    function toggleCampus(name: string) {
        const current = readToolPreferences();
        const values = new Set(current.disabledCampus);
        if (values.has(name)) values.delete(name); else values.add(name);
        save({ ...current, disabledCampus: [...values] });
    }
    const host = typeof location === 'undefined' ? '本网站' : location.host;
    // What is lent is the extension's to decide; here each item is only listed, with what it does.
    const lent = (title: string, tools: BrowserTool[]) => tools.length > 0 && <div className="tool-lent">
        <h4>{title}</h4>
        {tools.map(tool => <div className="kv" key={tool.capability} title={tool.definition.function.description}>
            <span className="v">{tool.label}</span><small className={tool.readOnly ? 'tool-effect' : 'tool-effect writes'}>{tool.readOnly ? '只读' : '会改动'}</small>
        </div>)}
    </div>;
    return <>
        <h3 className="sh">StuDev 内建</h3>
        {campusToolGroups.map(group => <details className="tool-settings-group" key={group.label}>
            <summary className="kv"><span className="v">{group.label}</span><small>{Object.keys(group.tools).filter(name => !preferences.disabledCampus.includes(name)).length} 项已启用</small></summary>
            {Object.entries(group.tools).map(([name, label]) => <button type="button" className="kv" key={name} role="switch" aria-checked={!preferences.disabledCampus.includes(name)} onClick={() => toggleCampus(name)}>
                <span className="v">{label}</span><Toggle on={!preferences.disabledCampus.includes(name)} />
            </button>)}
        </details>)}
        <h3 className="sh gap">Local Runtime</h3>
        <button type="button" className="kv" role="switch" aria-checked={preferences.runtime} onClick={() => save({ ...readToolPreferences(), runtime: !preferences.runtime })}>
            <span className="v">使用 Local Runtime</span><Toggle on={preferences.runtime} />
        </button>
        <p className="fine">借哪些能力给 {host}，在浏览器工具栏点 L 勾选；这里只决定用不用。会改动的项目，除非权限是「自动」，每次调用都会先问你。</p>
        {status === 'loading' && <p className="fine" role="status">正在连接 Local Runtime…</p>}
        {status === 'offline' && <p className="fine">没有连上 Local Runtime：请确认已安装并打开它和浏览器扩展。<TextAction onClick={() => setAttempt(value => value + 1)}>重试</TextAction></p>}
        {status === 'ready' && !browser.length && <p className="fine">已连接，但还没有借给 {host} 的能力。<TextAction onClick={() => setAttempt(value => value + 1)}>刷新</TextAction></p>}
        {preferences.runtime && <>
            {lent('本机能力', browser.filter(tool => tool.machine))}
            {lent('网页工具', browser.filter(tool => !tool.machine))}
        </>}
        <RemoteMcpSettings />
        {error && <p role="alert" className="fine">{error}</p>}
    </>;
}
