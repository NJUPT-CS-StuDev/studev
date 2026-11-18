import { useRef, useState } from 'react';
import { DEFAULT_INSTRUCTIONS, PERSONAL_LIMIT, useInstructionOwner, usePersonalInstructions, writePersonalInstructions } from './instructions';

export default function InstructionSettings() {
    const owner = useInstructionOwner();
    const saved = usePersonalInstructions();
    return owner ? <InstructionEditor key={owner} owner={owner} saved={saved} /> : <p className="fine">正在读取此设备上的个人设置。</p>;
}

function InstructionEditor({ owner, saved }: { owner: string; saved: string }) {
    const [draft, setDraft] = useState<string>();
    const [status, setStatus] = useState('');
    const file = useRef<HTMLInputElement>(null);
    const value = draft ?? saved;
    async function importMarkdown(selected: File) {
        try {
            if (selected.size > PERSONAL_LIMIT * 4) throw new Error('指令最多 4000 字。');
            const text = (await selected.text()).trim();
            if (text.length > PERSONAL_LIMIT || text.includes('\0')) throw new Error('请选择不超过 4000 字的 Markdown 文本。');
            setDraft(text);
            setStatus('已读取，保存后生效。');
        } catch (error) { setStatus(error instanceof Error ? error.message : '无法读取此文件。'); }
    }
    function download() {
        const url = URL.createObjectURL(new Blob([value], { type: 'text/markdown;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url; link.download = 'AGENTS.md'; link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return <div className="ai-instructions">
        <p className="fine">保存在这个浏览器。聊天时，生效的指令会随问题发给当前模型。</p>
        <label>个人指令<textarea className="tf" rows={8} maxLength={PERSONAL_LIMIT} value={value} onChange={event => setDraft(event.target.value)} /></label>
        <input ref={file} hidden type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" onChange={event => {
            const selected = event.currentTarget.files?.[0]; event.currentTarget.value = '';
            if (selected) void importMarkdown(selected);
        }} />
        <div className="ai-project-actions">
            <button className="btn" onClick={() => file.current?.click()}>导入</button>
            <button className="btn" onClick={download}>导出</button>
            <button className="btn" onClick={() => void navigator.clipboard.writeText(value).then(() => setStatus('已复制。'), () => setStatus('无法复制，请选中文本复制。'))}>复制</button>
            <button className="btn" onClick={() => { setDraft(DEFAULT_INSTRUCTIONS); setStatus('保存后恢复默认。'); }}>恢复默认</button>
            <button className="btn go" disabled={draft === undefined || draft.trim() === saved} onClick={() => {
                try { writePersonalInstructions(owner, value); setDraft(undefined); setStatus('已保存。'); }
                catch (error) { setStatus(error instanceof Error ? error.message : '无法保存指令。'); }
            }}>保存</button>
        </div>
        {status && <p className="fine" role="status">{status}</p>}
    </div>;
}
