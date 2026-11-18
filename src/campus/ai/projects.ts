import type { Saved } from './chats';

const KEY = 'studev_ai_projects';
const UUID = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const idPattern = new RegExp(`^${UUID}$`, 'i');
const filePattern = new RegExp(`^(${UUID})(?:\\.${UUID})?\\.json$`, 'i');
const MAX_CHAT_FILE = 32 * 1024 * 1024;

export interface Project {
    id: string;
    name: string;
    course?: string;
    instructions?: string;
    memory?: string;
    folder?: string;
    references?: { id: string; name: string }[];
}

export interface Folder extends FileSystemDirectoryHandle {
    queryPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}
export interface ChatRevision<P> { name: string; chat: Saved<P>; previous?: string }
export interface Workspace<P> { folder: Folder; project: Project; instructions: string; memory: string; revisions: ChatRevision<P>[] }

const picker = () => (window as Window & { showDirectoryPicker?: (options: { mode: 'read' | 'readwrite'; id: string }) => Promise<Folder> }).showDirectoryPicker;
export const folderAvailable = () => typeof window !== 'undefined' && Boolean(picker());
export function pickFolder(writable = true): Promise<Folder> {
    const pick = picker();
    if (!pick) throw new Error('此浏览器不能打开本地项目目录。');
    return pick.call(window, { mode: writable ? 'readwrite' : 'read', id: writable ? 'studev-projects' : 'studev-references' });
}

export function readProjects(): Project[] {
    try {
        const data = JSON.parse(localStorage.getItem(KEY) ?? '[]');
        return Array.isArray(data) ? data.filter(project => typeof project?.id === 'string' && typeof project.name === 'string') : [];
    } catch { return []; }
}

export function saveProjects(projects: Project[]) {
    localStorage.setItem(KEY, JSON.stringify(projects));
}

function directoryDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('studev-ai-projects', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('folders');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function savedFolder(id: string): Promise<Folder | undefined> {
    const db = await directoryDatabase();
    try {
        return await new Promise((resolve, reject) => {
            const request = db.transaction('folders').objectStore('folders').get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } finally { db.close(); }
}

export async function saveFolder(id: string, folder: Folder) {
    const db = await directoryDatabase();
    try {
        await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction('folders', 'readwrite');
            transaction.objectStore('folders').put(folder, id);
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(transaction.error);
        });
    } finally { db.close(); }
}

export async function dropFolder(id: string) {
    const db = await directoryDatabase();
    try {
        await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction('folders', 'readwrite');
            transaction.objectStore('folders').delete(id);
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(transaction.error);
        });
    } finally { db.close(); }
}

const missing = (error: unknown) => error instanceof DOMException && error.name === 'NotFoundError';

function validThread(thread: Saved<unknown>['thread'] | undefined): boolean {
    if (!thread || !Array.isArray(thread.nodes) || !thread.chosen || typeof thread.chosen !== 'object' || Array.isArray(thread.chosen)) return false;
    const ids = new Set(['']);
    for (const node of thread.nodes) {
        if (typeof node?.id !== 'string' || ids.has(node.id) || !ids.has(node.parent) || !node.message || !['user', 'assistant', 'tool'].includes(node.message.role)
            || !(node.message.content === null || typeof node.message.content === 'string') || node.message.tool_calls !== undefined && !Array.isArray(node.message.tool_calls)) return false;
        ids.add(node.id);
    }
    return true;
}

async function readFile(folder: FileSystemDirectoryHandle, name: string, limit: number): Promise<string | undefined> {
    try {
        const file = await (await folder.getFileHandle(name)).getFile();
        if (file.size > limit) throw new Error(`文件 ${name} 超出可读取大小。`);
        return await file.text();
    } catch (error) { if (missing(error)) return undefined; throw error; }
}

async function writeFile(folder: FileSystemDirectoryHandle, name: string, text: string): Promise<void> {
    const file = await folder.getFileHandle(name, { create: true });
    const output = await file.createWritable({ mode: 'exclusive' } as FileSystemCreateWritableOptions);
    try { await output.write(text); await output.close(); }
    catch (error) { await output.abort().catch(() => {}); throw error; }
    if (await (await file.getFile()).text() !== text) throw new Error('写入后的内容无法校验。');
}

async function readProject(state: FileSystemDirectoryHandle): Promise<Project | undefined> {
    const raw = await readFile(state, 'project.json', 16_384);
    if (raw === undefined) return;
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !idPattern.test(value.id) || typeof value.name !== 'string' || (value.course !== undefined && typeof value.course !== 'string')) {
        throw new Error('此目录的 StuDev 项目格式无法读取。');
    }
    return { id: value.id, name: value.name, course: value.course };
}

export async function openWorkspace<P>(folder: Folder, project?: Project): Promise<Workspace<P>> {
    const state = await folder.getDirectoryHandle('.studev', { create: Boolean(project) });
    const saved = await readProject(state);
    if (saved && project && saved.id !== project.id) throw new Error('该目录已属于另一个项目，请通过“打开本地项目”打开。');
    if (!saved && !project) throw new Error('这个目录还没有 StuDev 项目。');
    const selected = saved ?? project!;
    if (!saved) await writeFile(state, 'project.json', JSON.stringify({ version: 1, id: selected.id, name: selected.name, course: selected.course }));
    let instructions = await readFile(folder, 'AGENTS.md', 262_144);
    if (instructions === undefined && project?.instructions?.trim()) {
        await writeFile(folder, 'AGENTS.md', project.instructions);
        instructions = project.instructions;
    }
    let memory = await readFile(state, 'memory.md', 16_384);
    if (memory === undefined && project?.memory?.trim()) {
        await writeFile(state, 'memory.md', project.memory);
        memory = project.memory;
    }
    return { folder, project: { id: selected.id, name: selected.name, course: selected.course, folder: folder.name }, instructions: instructions ?? '', memory: memory ?? '', revisions: await workspaceRevisions<P>(folder) };
}

export async function workspaceRevisions<P>(folder: Folder, only?: string): Promise<ChatRevision<P>[]> {
    const state = await folder.getDirectoryHandle('.studev');
    const chats = await state.getDirectoryHandle('chats', { create: true });
    const revisions: ChatRevision<P>[] = [];
    for await (const file of chats.values()) {
        const match = filePattern.exec(file.name);
        if (!match || file.kind !== 'file' || only && match[1] !== only) continue;
        const text = await readFile(chats, file.name, MAX_CHAT_FILE);
        if (text === undefined) continue;
        // A different client may be creating an empty file before committing its writable stream.
        if (!text) continue;
        const { version, previous, ...chat } = JSON.parse(text);
        if (version !== 1 || chat.id !== match[1] || !validThread(chat.thread) || !Array.isArray(chat.proposals) || typeof chat.title !== 'string' || !Number.isFinite(chat.updated)) {
            throw new Error(`对话文件 ${file.name} 无法读取。`);
        }
        revisions.push({ name: file.name.slice(0, -5), chat, previous: typeof previous === 'string' && filePattern.exec(`${previous}.json`)?.[1] === chat.id ? previous : undefined });
    }
    const superseded = new Set(revisions.flatMap(revision => revision.previous ? [revision.previous] : []));
    return revisions.filter(revision => !superseded.has(revision.name));
}

export async function saveProjectChat<P>(folder: Folder, chat: Saved<P>, previous?: string): Promise<string> {
    if (!idPattern.test(chat.id)) throw new Error('会话标识无效。');
    const heads = await workspaceRevisions<P>(folder, chat.id);
    const { project: _project, ...saved } = chat;
    if (!previous && heads.length === 1 && equivalent(heads[0]!.chat, saved)) return heads[0]!.name;
    if (heads.length !== (previous ? 1 : 0) || previous && heads[0]?.name !== previous) throw new Error('此对话已在另一端更新。重新打开即可查看已保存的版本。');
    const state = await folder.getDirectoryHandle('.studev');
    const chats = await state.getDirectoryHandle('chats');
    const name = `${chat.id}.${crypto.randomUUID()}`;
    const text = JSON.stringify({ version: 1, ...saved, previous });
    if (new Blob([text]).size > MAX_CHAT_FILE) throw new Error('这个对话已超过本地项目的单个会话大小。');
    await writeFile(chats, `${name}.json`, text);
    if (previous) await chats.removeEntry(`${previous}.json`).catch(() => {});
    return name;
}

function equivalent(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const left = Object.entries(a).filter(([, value]) => value !== undefined);
    const right = b as Record<string, unknown>;
    return left.length === Object.values(right).filter(value => value !== undefined).length && left.every(([name, value]) => equivalent(value, right[name]));
}

export async function writeProjectInstructions(folder: Folder, previous: string, next: string) {
    if ((await readFile(folder, 'AGENTS.md', 262_144) ?? '') !== previous) throw new Error('AGENTS.md 已在其他程序中编辑，请重新打开项目。');
    await writeFile(folder, 'AGENTS.md', next);
}

export async function writeProjectMemory(folder: Folder, previous: string, next: string) {
    const state = await folder.getDirectoryHandle('.studev');
    if ((await readFile(state, 'memory.md', 16_384) ?? '') !== previous) throw new Error('项目记忆刚刚在另一端更新，请重新打开项目。');
    await writeFile(state, 'memory.md', next);
}

export async function newProjectFolder(parent: Folder, name: string): Promise<Folder> {
    const base = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/[. ]+$/, '').trim().slice(0, 70) || 'StuDev 项目';
    const taken = new Set<string>();
    for await (const entry of parent.values()) taken.add(entry.name.toLocaleLowerCase());
    let label = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(base) ? `项目 ${base}` : base;
    for (let number = 2; taken.has(label.toLocaleLowerCase()); number++) label = `${base} ${number}`;
    return await parent.getDirectoryHandle(label, { create: true }) as Folder;
}

export async function skillText(folder: Folder, name: string): Promise<string> {
    if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) throw new Error('技能名称无效。');
    const directory = await (await folder.getDirectoryHandle('skills')).getDirectoryHandle(name);
    return (await readFile(directory, 'SKILL.md', 32768))?.trim() ?? '';
}

export async function saveSkill(folder: Folder, name: string, text: string, previous?: string): Promise<void> {
    if (!/^[\p{Letter}\p{Number}_-]{1,60}$/u.test(name)) throw new Error('技能名称只使用文字、数字、连字符或下划线。');
    const skills = await folder.getDirectoryHandle('skills', { create: true });
    const directory = await skills.getDirectoryHandle(name, { create: true });
    const before = (await readFile(directory, 'SKILL.md', 32768))?.trim();
    if (before !== previous) throw new Error('此技能已存在或刚刚被修改，请先打开它。');
    await writeFile(directory, 'SKILL.md', text.trim());
}

export async function listSkills(folder: Folder): Promise<string[]> {
    try {
        const directory = await folder.getDirectoryHandle('skills');
        const names: string[] = [];
        for await (const child of directory.values()) if (child.kind === 'directory' && await readFile(child as FileSystemDirectoryHandle, 'SKILL.md', 32768)) names.push(child.name);
        return names.sort((a, b) => a.localeCompare(b));
    } catch (error) { if (missing(error)) return []; throw error; }
}
