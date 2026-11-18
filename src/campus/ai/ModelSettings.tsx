import { useEffect, useRef, useState } from 'react';
import { addressError, fetchModels, freeService, readModelSettings, runtimeProvider, writeModelSettings, type ModelOption, type ModelProvider } from './model';
import { FreeServiceAvatar } from './FreeServiceAvatar';
import { runtimeModels } from './runtime';
import { Chevron } from '@/world/ui';

const newProvider = (): ModelProvider => ({ id: crypto.randomUUID(), kind: 'api', name: '', base: '', key: '', enabled: true, models: [] });

/** Devices own their model credentials. Settings edit one provider at a time. */
export default function ModelSettings() {
    const [settings, setSettings] = useState(readModelSettings);
    const [editing, setEditing] = useState<ModelProvider | null>(null);
    const [error, setError] = useState('');
    function update(id: string, provider?: ModelProvider) {
        const current = readModelSettings();
        const providers = current.providers.some(item => item.id === id)
            ? current.providers.flatMap(item => item.id === id ? provider ? [provider] : [] : [item])
            : provider ? [...current.providers, provider] : current.providers;
        const next = { ...current, providers };
        try { writeModelSettings(next); setSettings(next); setEditing(null); setError(''); }
        catch { setError('无法保存模型设置，请检查浏览器存储权限。'); }
    }
    return <div className="model-settings">
        {editing ? <ProviderEditor initial={editing} saved={settings.providers.some(item => item.id === editing.id)} onBack={() => { setEditing(null); setError(''); }} save={value => update(value.id, value)} remove={() => update(editing.id)} /> : <>
            <div className="kv"><span className="model-service-identity v"><FreeServiceAvatar /><span>{freeService.modelName}<small>{freeService.description}</small></span></span></div>
            {settings.providers.map(provider => <button key={provider.id} type="button" className="kv" onClick={() => setEditing(provider)}>
                <span className="v">{provider.name}<small>{provider.enabled ? `${provider.models.filter(item => item.enabled).length} 个模型已启用` : '已停用'}</small></span><Chevron />
            </button>)}
            <div className="model-actions">
                <button type="button" className="btn" onClick={() => setEditing(newProvider())}>添加服务商</button>
                {!settings.providers.some(item => item.kind === 'runtime') && <button type="button" className="btn" onClick={() => setEditing(runtimeProvider)}>连接 Local Runtime MCP</button>}
            </div>
        </>}
        {error && <p role="alert" className="fine">{error}</p>}
    </div>;
}

function ProviderEditor({ initial, saved, onBack, save, remove }: { initial: ModelProvider; saved: boolean; onBack: () => void; save: (provider: ModelProvider) => void; remove: () => void }) {
    const [draft, setDraft] = useState(initial);
    const [manual, setManual] = useState('');
    const [waiting, setWaiting] = useState(false);
    const [note, setNote] = useState('');
    const [confirmRemove, setConfirmRemove] = useState(false);
    const request = useRef<AbortController | null>(null);
    const runtime = draft.kind === 'runtime';
    useEffect(() => () => request.current?.abort(), []);
    const edit = (part: Partial<ModelProvider>) => setDraft(current => ({ ...current, ...part }));
    const canFetch = runtime || !addressError(draft.base) && Boolean(draft.key.trim());
    const canSave = Boolean(draft.name.trim()) && canFetch;
    const add = () => {
        const id = manual.trim();
        if (!id || draft.models.some(model => model.id === id)) return;
        edit({ models: [...draft.models, { id, name: id, enabled: true }] });
        setManual('');
    };
    async function pull() {
        if (!canFetch || waiting) return;
        const controller = new AbortController(); request.current = controller;
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
        setWaiting(true); setNote('');
        try {
            const available = runtime ? await runtimeModels(signal) : (await fetchModels(draft.base, draft.key, signal)).map(id => ({ id, name: id }));
            if (controller.signal.aborted) return;
            const existing = new Map(draft.models.map(item => [item.id, item]));
            const models: ModelOption[] = available.map(item => ({ ...item, enabled: existing.get(item.id)?.enabled ?? false }));
            if (!runtime) models.push(...draft.models.filter(item => !available.some(found => found.id === item.id)));
            edit({ models });
            setNote(`已获取 ${available.length} 个模型`);
        } catch (failure) {
            if (!controller.signal.aborted) setNote(failure instanceof Error ? failure.message : '暂时无法获取模型列表');
        } finally { if (!controller.signal.aborted) setWaiting(false); }
    }
    return <form className="model-editor" onSubmit={event => {
        event.preventDefault();
        if (canSave && !waiting) save({ ...draft, name: draft.name.trim(), base: draft.base.trim(), key: draft.key.trim() });
    }}>
        {runtime ? <p className="fine">连接这台电脑上已授权给 StuDev 的 Local Runtime MCP。</p> : <>
            <label>服务商名称<input className="tf" required maxLength={60} value={draft.name} onChange={event => edit({ name: event.target.value })} disabled={waiting} /></label>
            <label>接口地址<input className="tf" type="url" required maxLength={2048} value={draft.base} onChange={event => edit({ base: event.target.value })} disabled={waiting} placeholder="https://api.deepseek.com" /></label>
            <label>API Key<input className="tf" type="password" autoComplete="off" required value={draft.key} onChange={event => edit({ key: event.target.value })} disabled={waiting} /></label>
        </>}
        <label className="model-toggle"><input type="checkbox" checked={draft.enabled} onChange={event => edit({ enabled: event.target.checked })} /> 启用服务商</label>
        <div className="model-actions"><h3>模型</h3><button type="button" className="btn" disabled={!canFetch || waiting} onClick={() => void pull()}>{waiting ? '正在获取…' : '获取模型列表'}</button></div>
        {note && <p role="status" className="fine">{note}</p>}
        {draft.models.map(model => <label className="model-toggle" key={model.id}><input type="checkbox" checked={model.enabled} disabled={waiting}
            onChange={event => edit({ models: draft.models.map(item => item.id === model.id ? { ...item, enabled: event.target.checked } : item) })} /> {model.name}</label>)}
        {!runtime && <div className="model-actions"><input className="tf" value={manual} onChange={event => setManual(event.target.value)} maxLength={200} placeholder="手动填写模型 ID" aria-label="手动填写模型 ID" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} /><button type="button" className="btn" disabled={waiting || !manual.trim()} onClick={add}>添加模型</button></div>}
        <div className="model-actions model-save">
            {saved && <button type="button" className="btn danger" onClick={() => confirmRemove ? remove() : setConfirmRemove(true)}>{confirmRemove ? '确认移除' : '移除服务商'}</button>}
            <button type="button" className="btn" onClick={onBack}>取消</button>
            <button className="btn go" disabled={!canSave || waiting}>保存</button>
        </div>
    </form>;
}
