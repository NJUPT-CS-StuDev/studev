import { useEffect, useState } from 'react';
import { type Folder } from './projects';

const limit = 262_144;

export default function ProjectFiles({ root, writable }: { root: Folder; writable: boolean }) {
    const [path, setPath] = useState<FileSystemDirectoryHandle[]>([root]);
    const [entries, setEntries] = useState<FileSystemHandle[]>([]);
    const [opened, setOpened] = useState<{ file: FileSystemFileHandle; original: string; draft: string }>();
    const [status, setStatus] = useState('');
    const [saving, setSaving] = useState(false);
    const current = path.at(-1)!;
    useEffect(() => {
        let active = true;
        void (async () => {
            const files: FileSystemHandle[] = [];
            for await (const entry of current.values()) { if (!entry.name.startsWith('.')) files.push(entry); }
            files.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1);
            if (active) setEntries(files);
        })().catch(() => { if (active) { setEntries([]); setStatus('无法读取此目录。'); } });
        return () => { active = false; };
    }, [current]);
    async function open(entry: FileSystemHandle) {
        setStatus('');
        if (entry.kind === 'directory') { setOpened(undefined); setEntries([]); setPath([...path, entry as FileSystemDirectoryHandle]); return; }
        try {
            const handle = entry as FileSystemFileHandle;
            const file = await handle.getFile();
            if (file.size > limit) throw new Error('此文件太大，请用本机编辑器打开。');
            const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
            if (text.includes('\0')) throw new Error('此文件不是可编辑的文本。');
            setOpened({ file: handle, original: text, draft: text });
        } catch (failure) { setStatus(failure instanceof Error ? failure.message : '暂时无法打开文件。'); }
    }
    async function save() {
        if (!opened || !writable || saving) return;
        setSaving(true);
        let writer: FileSystemWritableFileStream | undefined;
        try {
            if ((await (await opened.file.getFile()).text()) !== opened.original) throw new Error('文件刚刚被另一个程序修改，请重新打开。');
            if (new Blob([opened.draft]).size > limit) throw new Error('文件超过可保存的大小。');
            writer = await opened.file.createWritable({ mode: 'exclusive' } as FileSystemCreateWritableOptions);
            await writer.write(opened.draft);
            if ((await (await opened.file.getFile()).text()) !== opened.original) throw new Error('文件刚刚被另一个程序修改，请重新打开。');
            await writer.close();
            setOpened({ ...opened, original: opened.draft }); setStatus('已保存。');
        } catch (failure) {
            await writer?.abort().catch(() => {});
            setStatus(failure instanceof Error ? failure.message : '无法保存文件。');
        } finally { setSaving(false); }
    }
    return <section className="ai-project-files">
        <div className="ai-project-heading"><h3>{current.name || root.name}</h3>{path.length > 1 && <button className="btn" disabled={saving} onClick={() => { setPath(path.slice(0, -1)); setOpened(undefined); setEntries([]); setStatus(''); }}>上一级</button>}</div>
        <div className="ai-project-files-list">{entries.map(entry => <button className="kv" key={entry.name} disabled={saving} onClick={() => void open(entry)}><span className="v">{entry.name}</span>{entry.kind === 'directory' && <small>目录</small>}</button>)}</div>
        {opened && <>
            <label>{opened.file.name}<textarea className="tf" rows={8} readOnly={!writable || saving} value={opened.draft} onChange={event => setOpened({ ...opened, draft: event.target.value })} /></label>
            {writable && <div className="ai-project-actions"><button className="btn go" disabled={saving || opened.draft === opened.original} onClick={() => void save()}>保存文件</button></div>}
        </>}
        {status && <p className="fine" role="status">{status}</p>}
    </section>;
}
