import { useEffect, useState } from 'react';
import { Sheet } from '@/world/ui';
import { PROJECT_LIMIT } from './instructions';
import { folderAvailable, listSkills, saveSkill, savedFolder, skillText, type Folder, type Project } from './projects';
import ProjectFiles from './ProjectFiles';

interface Props {
    project: Project;
    folder?: Folder;
    instructions: string;
    activeSkill?: string;
    save(value: string): Promise<void>;
    bind(child: boolean): Promise<void>;
    attach(): Promise<void>;
    detach(id: string): Promise<void>;
    useSkill(name: string, text: string): void;
    onClose(): void;
}

export default function ProjectSettings({ project, folder, instructions, activeSkill, save, bind, attach, detach, useSkill, onClose }: Props) {
    const [draft, setDraft] = useState<string>();
    const [status, setStatus] = useState('');
    const [running, setRunning] = useState(false);
    const [skills, setSkills] = useState<string[]>([]);
    const [skill, setSkill] = useState<{ name: string; text: string; previous?: string }>();
    const [browser, setBrowser] = useState<{ folder: Folder; writable: boolean; pending?: boolean }>();
    const supported = folderAvailable();
    const value = draft ?? instructions;
    useEffect(() => {
        let alive = true;
        if (folder) void listSkills(folder).then(found => { if (alive) setSkills(found); }, () => { if (alive) setStatus('暂时无法读取项目技能。'); });
        return () => { alive = false; };
    }, [folder]);
    async function run(action: () => Promise<void>) {
        setRunning(true); setStatus('');
        try { await action(); }
        catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus(error instanceof Error ? error.message : '项目设置暂时无法保存。'); }
        finally { setRunning(false); }
    }
    return <Sheet title="项目设置" onClose={onClose}>
        <div className="ai-project-settings">
            <h3>{project.name}</h3>
            <p className="fine">{folder ? `本地主目录 · ${folder.name}` : project.folder ? `等待重新定位 · ${project.folder}` : '尚未绑定主目录'}</p>
            {supported && <div className="ai-project-actions">
                <button className="btn" disabled={running} onClick={() => void run(() => bind(false))}>{project.folder ? '重新定位' : '绑定主目录'}</button>
                {!project.folder && !folder && <button className="btn" disabled={running} onClick={() => void run(() => bind(true))}>新建本地文件夹</button>}
                {folder && <button className="btn" disabled={running} onClick={() => setBrowser({ folder, writable: true })}>查看项目文件</button>}
                <button className="btn" disabled={running} onClick={() => void run(attach)}>添加资料目录</button>
            </div>}
            {project.references?.map(reference => <div className="kv" key={reference.id}><span className="v">{reference.name}</span>
                <button className="btn" disabled={running} onClick={() => void run(async () => {
                    const handle = await savedFolder(reference.id);
                    if (!handle) throw new Error('无法找到此目录，请重新添加。');
                    setBrowser({ folder: handle, writable: false, pending: await handle.queryPermission({ mode: 'read' }) !== 'granted' });
                })}>查看</button><button className="btn" disabled={running} onClick={() => void run(() => detach(reference.id))}>移除关联</button></div>)}
            {browser && <>
                {browser.pending ? <button className="btn" disabled={running} onClick={() => void run(async () => {
                    if (await browser.folder.requestPermission({ mode: 'read' }) !== 'granted') throw new Error('需要允许访问才能查看这个目录。');
                    setBrowser({ ...browser, pending: false });
                })}>允许读取 {browser.folder.name}</button> : <ProjectFiles key={browser.folder.name + browser.writable} root={browser.folder} writable={browser.writable} />}
                <button className="btn" onClick={() => setBrowser(undefined)}>收起文件</button>
            </>}
            <label>项目指令{folder && <small>AGENTS.md</small>}<textarea className="tf" rows={7} maxLength={PROJECT_LIMIT} value={value} disabled={running || Boolean(project.folder && !folder)} onChange={event => setDraft(event.target.value)} /></label>
            <div className="ai-project-actions"><button className="btn go" disabled={running || draft === undefined || Boolean(project.folder && !folder)} onClick={() => void run(async () => { await save(value); setDraft(undefined); setStatus('项目指令已保存。'); })}>保存指令</button></div>
            {folder && <section className="ai-project-skills">
                <div className="ai-project-heading"><h3>Skills</h3><button className="btn" disabled={running} onClick={() => setSkill({ name: '', text: '' })}>新增</button></div>
                {skills.map(name => <div className="kv" key={name}><button className="ai-skill-name" disabled={running} onClick={() => void run(async () => { const text = await skillText(folder, name); setSkill({ name, text, previous: text }); })}>{name}</button>
                    <button className="btn" disabled={running} onClick={() => void run(async () => { useSkill(activeSkill === name ? '' : name, activeSkill === name ? '' : await skillText(folder, name)); setStatus(activeSkill === name ? '已停用本次技能。' : '技能会用于这个项目的下一次发送。'); })}>{activeSkill === name ? '已选用' : '用于下一问'}</button></div>)}
                {skill && <>
                    <label>名称<input className="tf" value={skill.name} maxLength={60} disabled={skill.previous !== undefined || running} onChange={event => setSkill({ ...skill, name: event.target.value })} /></label>
                    <label>步骤<textarea className="tf" rows={6} value={skill.text} maxLength={PROJECT_LIMIT} disabled={running} onChange={event => setSkill({ ...skill, text: event.target.value })} /></label>
                    <div className="ai-project-actions"><button className="btn" disabled={running} onClick={() => setSkill(undefined)}>取消</button><button className="btn go" disabled={running || !skill.name.trim() || !skill.text.trim()} onClick={() => void run(async () => {
                        await saveSkill(folder, skill.name.trim(), skill.text, skill.previous);
                        setSkills(await listSkills(folder)); setSkill(undefined); setStatus('技能已保存。');
                    })}>保存技能</button></div>
                </>}
            </section>}
            {status && <p className="fine" role="status">{status}</p>}
        </div>
    </Sheet>;
}
