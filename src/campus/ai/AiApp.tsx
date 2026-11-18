// AI, the fourth entry beside the timetable, the map and search: one conversation over the same tools as the other
// three, run on this device. The answer is shown as it comes; what was looked up is shown as steps one can open;
// rooms and routes it finds are things to tap; a task it drafts is saved only when confirmed. A question can be
// changed where it stands and an answer asked again: each grows a branch beside the old one (thread.ts), and one goes
// back and forth between them. Conversations are kept on this device and listed at the side (chats.ts), and so is what it
// keeps in mind about the person (memory.ts). It is told the moment and campus context (assistant.mjs). The model is the
// free quota, one's own key, or an owner-authorized Local Runtime model source (model.ts).
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { session } from '../../platform/client/api';
import { usePreferences } from '@/world/usePreferences';
import { useTasks } from '@/world/useTasks';
import { newTaskId, readTasks, saveTask } from '@/world/tasks';
import { dayWord, hm, momentNow } from '@/world/time';
import { weekOfDate } from '@/world/events';
import { ROUNDS, type Situation } from '@/world/assistant.mjs';
import { useTimeline } from '@/timetable/useTimeline';
import { PRODUCT_CONFIG } from '@/world/product';
import { CampusTools } from '@/world/campusTools';
import { UnknownReference } from '@/world/answers';
import { courseName, roomLabel } from '@/world/names';
import { Again, Back, Bars, Chevron, Compose, Copy, Down, Dots, Magnifier, Pencil, Sheet, Square, Tick, Up, TextAction, CampusHeader } from '@/world/ui';
import { readExams, readTimeline, schedulingTool, taskProposal, toolArguments, type TaskProposal } from '@/world/tools';
import { ask, askOwn, type Message } from './stream';
import { askRuntime, closeRuntimeChat, runtimeRequest, type RuntimeRequest } from './runtime';
import { FREE_MODEL, MODEL_SETTINGS_CHANGED, RUNTIME_DISABLED, RUNTIME_PROVIDER, freeProvider, freeService, readModelSettings, selectedProvider, visibleModelProviders, writeModelSettings, type ModelSelection, type ModelSettings } from './model';
import { FreeServiceAvatar } from './FreeServiceAvatar';
import { append, chain, choose, conversationId, emptyThread, lineage, path, siblings, tip, type Node, type Thread } from './thread';
import { chatGroups, titleOf, type Saved } from './chats';
import { stepsLine, stepsOf } from './steps';
import { campusHistory, invokeBrowserTool, listBrowserTools, needsToolConfirmation, readToolPreferences, toolCatalog, toolPermissionModes, TOOL_SETTINGS_CHANGED, writeToolPreferences, type BrowserTool, type PermissionMode, type ToolItem } from './toolCatalog';
import ToolSettings from './ToolSettings';
import ProjectSettings from './ProjectSettings';
import { combinedInstructions, usePersonalInstructions } from './instructions';
import { dropFolder, folderAvailable, newProjectFolder, openWorkspace, pickFolder, readProjects, saveFolder, saveProjectChat, saveProjects, savedFolder, workspaceRevisions, writeProjectInstructions, writeProjectMemory, type ChatRevision, type Folder, type Project, type Workspace } from './projects';
import { routeDuration } from '@/world/routes';
import { MEMORY_LIMIT, readMemory, remembered, writeMemory, type Memory } from './memory';
import { Doc, DocStream, docReady, DocText, type Update } from '@/world/doc';
import '../campus.css';

/** What one can ask, offered while the conversation is empty. */
const AI_EXAMPLES = ['这周有哪些截止和考试？', '今天下午哪里有空教室？', '计网里 TCP 拥塞控制有哪些真题考过？', '按培养方案看大二有哪些核心课？'];
const KEY = 'studev_ai_chats';
const OPEN_PROJECT = 'studev_ai_open_project';

type Proposal = TaskProposal & { key: string; call: string; saved?: boolean };
interface Chat { id: string; thread: Thread; proposals: Proposal[]; forks: string[]; runtimeModels: string[]; model?: ModelSelection; resetRuntime?: boolean }
/** Every conversation kept, and the one open (none: a new one, kept once something is asked in it). */
interface Kept { chats: Saved<Proposal>[]; current: string | null }
interface ProjectView { id: string; chat?: string; revision?: string }
function rememberedProject(): ProjectView | undefined {
    try {
        const view = JSON.parse(localStorage.getItem(OPEN_PROJECT) ?? 'null');
        return typeof view?.id === 'string' ? view : undefined;
    } catch { return undefined; }
}
function rememberProject(id: string | undefined, chat?: string, revision?: string) {
    try {
        if (id) localStorage.setItem(OPEN_PROJECT, JSON.stringify({ id, chat, revision }));
        else localStorage.removeItem(OPEN_PROJECT);
    } catch { /* Directory access stays available during this page visit. */ }
}
const newId = () => crypto.randomUUID();
const empty = (): Chat => ({ id: newId(), thread: emptyThread(), proposals: [], forks: [], runtimeModels: [] });
const opened = (saved: Saved<Proposal>): Chat => ({ id: saved.id, thread: saved.thread, proposals: saved.proposals, forks: saved.forks ?? [], runtimeModels: saved.runtimeModels ?? [], model: saved.model, resetRuntime: saved.resetRuntime });
function readKept(): Kept {
    try {
        const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Kept | null;
        if (raw && Array.isArray(raw.chats)) return raw;
        // One conversation kept before there could be many, or before it could branch, becomes the first of them.
        const single = JSON.parse(localStorage.getItem('studev_ai_thread') ?? 'null') as Chat | null;
        const old = JSON.parse(localStorage.getItem('studev_ai_chat') ?? 'null') as { messages?: Message[]; proposals?: Proposal[] } | null;
        const thread = single?.thread?.nodes ? single.thread : old?.messages ? chain(old.messages, old.messages.map(newId)) : null;
        const id = newId();
        const kept: Kept = thread?.nodes.length ? { chats: [{ id, title: '', updated: Date.now(), thread, proposals: single?.proposals ?? old?.proposals ?? [] }], current: id } : { chats: [], current: null };
        // Written at once, before the old keys go, so that a page opened twice does not lose it.
        localStorage.setItem(KEY, JSON.stringify(kept)); localStorage.removeItem('studev_ai_thread'); localStorage.removeItem('studev_ai_chat');
        return kept;
    } catch { /* Nothing kept, or kept unreadably: no conversations yet. */ }
    return { chats: [], current: null };
}
const parse = (text: string | null) => { try { return JSON.parse(text ?? 'null') as unknown; } catch { return null; } };
const showArguments = (text: string) => { try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; } };
/** At most this many messages go to the model, whole turns kept: a tool result never stays without its call. */
function recent(history: Message[]) {
    let out = history;
    while (out.length > 24) { const next = out.findIndex((item, i) => i > 0 && item.role === 'user'); if (next < 0) break; out = out.slice(next); }
    return out;
}

/** What a tool found, as things to tap: rooms on the map, a route to follow. */
function Found({ name, result }: { name: string; result: unknown }) {
    const value = result as Record<string, unknown> | null;
    if (!value || typeof value !== 'object') return null;
    if (name === 'free_rooms' && Array.isArray(value.rooms)) return <div className="ai-cards">{(value.rooms as { room: string; until: number; minutes: number }[]).slice(0, 6).map(room =>
        <a key={room.room} className="ai-card" href={`/map/?place=${encodeURIComponent(room.room)}`}><b>{roomLabel(room.room)}</b><small>空到 {hm(room.until)} · {Math.floor(room.minutes / 60)} 小时 {room.minutes % 60} 分</small></a>)}</div>;
    if (name === 'route' && typeof value.url === 'string') return <div className="ai-cards"><a className="ai-card" href={value.url}><b>{value.scope === 'within-building' ? '查看' : '导航到'}{String(value.to)}</b>
        <small>{value.scope === 'within-building' ? `同在${String(value.building)}${value.to_floor ? ` · ${String(value.to_floor)} 层` : ''}`
            : `${String(value.distance_m)} 米 · ${routeDuration(Number(value.duration_s))}${value.arrival ? `到${String(value.arrival)}` : ''}`}</small></a></div>;
    if (name === 'read' && typeof value.url === 'string') return <div className="ai-cards"><a className="ai-card" href={value.url} target="_blank" rel="noreferrer"><b>{String(value.title)}</b><small>{[value.source, value.date].filter(Boolean).join(' · ')}</small></a></div>;
    if (name === 'nearby' && Array.isArray(value.places)) return <div className="ai-cards">{(value.places as { id: string; name: string; metres: number; now?: string }[]).slice(0, 4).map(item =>
        <a key={item.id} className="ai-card" href={`/map/?place=${encodeURIComponent(item.id)}`}><b>{item.name}</b><small>{[`${item.metres} 米`, item.now].filter(Boolean).join(' · ')}</small></a>)}</div>;
    if (name === 'find_place' && Array.isArray(result)) return <div className="ai-cards">{(result as { id: string; name: string; where: string; now?: string }[]).slice(0, 3).map(item =>
        <a key={item.id} className="ai-card" href={`/map/?place=${encodeURIComponent(item.id)}`}><b>{item.name}</b><small>{[item.where, item.now].filter(Boolean).join(' · ')}</small></a>)}</div>;
    return null;
}

/** ‹ 2/3 ›: the branches beside one, to go back and forth. */
function Branches({ thread, id, onChoose, disabled }: { thread: Thread; id: string; onChoose: (id: string) => void; disabled: boolean }) {
    const at = siblings(thread, id);
    if (at.count < 2) return null;
    return <span className="ai-branches">
        <button className="ai-icon" aria-label="上一个版本" disabled={disabled || !at.previous} onClick={() => at.previous && onChoose(at.previous)}><Back /></button>
        <span>{at.index + 1}/{at.count}</span>
        <button className="ai-icon" aria-label="下一个版本" disabled={disabled || !at.next} onClick={() => at.next && onChoose(at.next)}><Chevron /></button>
    </span>;
}

function CopyButton({ text }: { text: string }) {
    const [done, setDone] = useState(false);
    return <button className="ai-icon" aria-label={done ? '已复制' : '复制'} title={done ? '已复制' : '复制'} onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}>{done ? <Tick /> : <Copy />}</button>;
}

function ToolPermission({ mode, disabled, change }: { mode: PermissionMode; disabled: boolean; change: (mode: PermissionMode) => void }) {
    const [open, setOpen] = useState(false);
    const current = toolPermissionModes.find(item => item.id === mode);
    return <div className="ai-tool-permission" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
        onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); event.currentTarget.querySelector('button')?.focus(); } }}>
        <button type="button" className="ai-tool-trigger" aria-label={`工具权限，${current?.label}`} aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>{current?.label} <Chevron /></button>
        {open && <div className="ai-menu ai-permission-menu" role="group" aria-label="工具权限">
            {toolPermissionModes.map(item => <button type="button" aria-pressed={item.id === mode} key={item.id} onClick={() => { change(item.id); setOpen(false); }}>
                <b>{item.label}</b><small>{item.description}</small>{item.id === mode && <Tick />}
            </button>)}
        </div>}
    </div>;
}

/** The box one writes in: grows with what is written, sends on Enter, stops while answering. */
function Composer({ value, onChange, onSend, onStop, busy, canSend, unavailable, picker, permission, tools }: { value: string; onChange: (text: string) => void; onSend: (text: string, preferred?: string) => void; onStop: () => void; busy: boolean; canSend: boolean; unavailable?: string; picker: ReactNode; permission: ReactNode; tools: ToolItem[] }) {
    const [open, setOpen] = useState(false), [active, setActive] = useState(0), [selected, setSelected] = useState('');
    const id = useId(), input = useRef<HTMLTextAreaElement>(null), menu = useRef<HTMLDivElement>(null);
    const query = /^\/([^\n]*)$/.exec(value)?.[1];
    const matching = tools.filter(tool => !query || `${tool.label} ${tool.group}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    const showing = !busy && (open || query !== undefined), at = Math.min(active, matching.length - 1);
    const chosen = tools.find(tool => tool.definition.function.name === selected);
    const canUseLabel = chosen && !((chosen.definition.function.parameters as { required?: unknown[] }).required?.length);
    const question = query === undefined ? value.trim() || (canUseLabel ? chosen.label : '') : '';
    useEffect(() => { if (showing) menu.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' }); }, [showing, at]);
    function detach() { setOpen(false); setActive(0); if (query !== undefined) onChange(''); }
    function select(tool: ToolItem) { detach(); setSelected(tool.definition.function.name); input.current?.focus(); }
    function submit() {
        if (showing) { if (at >= 0) select(matching[at]!); return; }
        if (canSend && !busy && question && (!selected || chosen)) { onSend(question, selected || undefined); setSelected(''); }
    }
    return <form className="ai-compose" onSubmit={event => { event.preventDefault(); submit(); }} onBlur={event => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) detach();
    }}>
        {unavailable && <p id={`${id}-status`} role="status" className="fine ai-model-status">{unavailable}</p>}
        <textarea ref={input} aria-label="问点什么" aria-describedby={unavailable ? `${id}-status` : undefined} aria-controls={showing ? id : undefined} aria-activedescendant={showing && at >= 0 ? `${id}-${at}` : undefined} value={value} maxLength={4000} rows={1} placeholder={chosen && canUseLabel ? '补充要求，或直接发送' : '问点什么'} onChange={event => { setActive(0); onChange(event.target.value); }}
            onKeyDown={event => {
                if (event.nativeEvent.isComposing) return;
                if (showing && event.key === 'Escape') { event.preventDefault(); detach(); }
                else if (showing && matching.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                    event.preventDefault(); setActive((at + (event.key === 'ArrowDown' ? 1 : matching.length - 1)) % matching.length);
                } else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
            }} />
        <div className="ai-tool-control">
            <button type="button" className="ai-tool-trigger" aria-label="选择工具" aria-expanded={showing} title="选择工具（/）" disabled={busy} onClick={() => { if (showing) detach(); else { setOpen(true); setActive(0); input.current?.focus(); } }}>/</button>
            {permission}
            {selected && <button type="button" className="ai-tool-selected" aria-label={`取消选择${chosen?.label ?? '工具'}`} onClick={() => setSelected('')}>{chosen?.label ?? '工具暂不可用'} <span aria-hidden="true">×</span></button>}
        </div>
        {showing && <div className="ai-menu ai-tool-menu" id={id} ref={menu} role="menu" aria-label="可用工具">
            {!matching.length && <p className="fine">没有匹配的工具</p>}
            {[...new Set(matching.map(tool => tool.group))].map(group => <div role="group" aria-label={group} key={group}>
                <p className="fine">{group}</p>
                {matching.map((tool, index) => tool.group === group && <button type="button" role="menuitem" id={`${id}-${index}`} aria-current={index === at ? 'true' : undefined} key={tool.definition.function.name} onClick={() => select(tool)}>{tool.label}</button>)}
            </div>)}
        </div>}
        {picker}
        {busy ? <button type="button" className="ai-send" aria-label="停止" onClick={onStop}><Square /></button>
            : <button className="ai-send" aria-label="发送" disabled={!canSend || !question || Boolean(selected && !chosen)}><Up /></button>}
    </form>;
}

function ModelPicker({ settings, choice, disabled, runtimeOff, select }: { settings: ModelSettings; choice: ModelSelection; disabled: boolean; runtimeOff: boolean; select: (model: ModelSelection) => void }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(-1);
    const [placement, setPlacement] = useState({ down: false, height: 330 });
    const id = useId();
    const anchor = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const menu = useRef<HTMLDivElement>(null);
    const search = useRef<HTMLInputElement>(null);
    const list = useRef<HTMLDivElement>(null);
    const wanted = query.trim().toLocaleLowerCase().split(/\s+/);
    const sources = [freeProvider, ...visibleModelProviders(settings).filter(source => source.enabled)]
        .map(source => ({ source, models: source.models.filter(model => model.enabled) }));
    let index = 0;
    const groups = sources.map(({ source, models }) => ({ source, options: models.filter(model => {
        const text = `${source.name} ${model.name} ${model.id}`.toLocaleLowerCase();
        return wanted.every(word => text.includes(word));
    }).map(model => ({ id: `${id}-${index++}`, name: model.name, selection: { provider: source.id, model: model.id } })) }))
        .filter(group => group.options.length > 0);
    const options = groups.flatMap(group => group.options);
    const at = Math.min(active, options.length - 1);
    const focused = options[at];
    const activeId = focused?.id;
    const chosen = selectedProvider(settings, choice);
    const name = chosen?.models.find(model => model.id === choice.model)?.name;
    const title = runtimeOff ? '本机浏览器模型已关闭' : name ?? '选择模型';
    const showing = open && !disabled;
    useLayoutEffect(() => {
        if (!showing) return;
        const viewport = window.visualViewport;
        const gap = 8;
        function position() {
            const by = anchor.current?.getBoundingClientRect();
            const panel = menu.current, rows = list.current;
            if (!by || !panel || !rows) return;
            const clip = anchor.current?.closest('.ai-scroll')?.getBoundingClientRect();
            const top = viewport?.offsetTop ?? 0;
            const bottom = top + (viewport?.height ?? window.innerHeight);
            const above = by.top - Math.max(top, clip?.top ?? top) - 2 * gap;
            const below = Math.min(bottom, clip?.bottom ?? bottom) - by.bottom - 2 * gap;
            const wantedHeight = Math.min(330, panel.offsetHeight + Math.max(0, rows.scrollHeight - rows.clientHeight));
            const down = above < wantedHeight && below > above;
            setPlacement({ down, height: Math.max(0, Math.floor(Math.min(330, down ? below : above))) });
        }
        const outside = (event: PointerEvent) => { if (event.target instanceof window.Node && !anchor.current?.contains(event.target)) setOpen(false); };
        position(); search.current?.focus({ preventScroll: true });
        window.addEventListener('resize', position); viewport?.addEventListener('resize', position); viewport?.addEventListener('scroll', position);
        document.addEventListener('pointerdown', outside);
        return () => {
            window.removeEventListener('resize', position); viewport?.removeEventListener('resize', position); viewport?.removeEventListener('scroll', position);
            document.removeEventListener('pointerdown', outside);
        };
    }, [showing]);
    useEffect(() => {
        const scroller = list.current;
        const row = activeId ? document.getElementById(activeId) : null;
        if (!showing || !scroller || !row) return;
        const frame = scroller.getBoundingClientRect(), target = row.getBoundingClientRect();
        if (target.top < frame.top) scroller.scrollTop -= frame.top - target.top;
        else if (target.bottom > frame.bottom) scroller.scrollTop += target.bottom - frame.bottom;
    }, [showing, activeId, placement.height]);
    function close(focus: boolean) { setOpen(false); if (focus) trigger.current?.focus({ preventScroll: true }); }
    function chooseModel(model: ModelSelection) { select(model); close(true); }
    return <div ref={anchor} className="ai-model" onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close(false); }}>
        <button ref={trigger} type="button" aria-label="选择模型" aria-haspopup="listbox" title={title} aria-expanded={showing} className={`ai-model-b ${showing ? 'on' : ''}`} disabled={disabled}
            onClick={() => { if (showing) close(false); else { setQuery(''); setActive(-1); setOpen(true); } }}>
            {chosen?.kind === 'free' && <FreeServiceAvatar />}<span>{title}</span><Chevron />
        </button>
        {showing && <div ref={menu} className={`ai-menu ai-model-menu${placement.down ? ' down' : ''}`} style={{ maxHeight: placement.height }}>
            <input ref={search} type="search" role="combobox" aria-label="搜索模型或服务商" aria-expanded="true" aria-autocomplete="list" aria-controls={id} aria-activedescendant={activeId}
                className="ai-model-search" placeholder="搜索模型或服务商" autoComplete="off" value={query} onChange={event => { setQuery(event.target.value); setActive(event.target.value.trim() ? 0 : -1); }}
                onKeyDown={event => {
                    if (event.nativeEvent.isComposing) return;
                    if (event.key === 'Escape') { event.preventDefault(); close(true); }
                    if (event.key === 'Enter') { event.preventDefault(); if (focused) chooseModel(focused.selection); }
                    if (options.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                        event.preventDefault();
                        const next = event.key === 'ArrowDown' ? at + 1 : (at < 0 ? 0 : at) - 1;
                        setActive((next + options.length) % options.length);
                    }
                }} />
            <div ref={list} id={id} className="ai-model-list" role="listbox" aria-label="可用模型">
                {groups.map(({ source, options }) => <div key={source.id} role="group" aria-label={source.name}>
                    <p className="ai-model-provider" aria-hidden="true">{source.name}</p>
                    {options.map(option => {
                        const selected = choice.provider === option.selection.provider && choice.model === option.selection.model;
                        return <button key={option.selection.model} id={option.id} type="button" role="option" tabIndex={-1} aria-selected={selected} data-active={activeId === option.id ? '' : undefined} onClick={() => chooseModel(option.selection)}>
                            {source.kind === 'free' ? <span className="model-service-identity"><FreeServiceAvatar /><span><b>{option.name}</b><small>{freeService.description}</small></span></span> : <b>{option.name}</b>}
                            {selected && <Tick />}
                        </button>;
                    })}
                </div>)}
            </div>
            {!options.length && <p className="fine ai-model-empty" role="status">没有匹配的模型</p>}
        </div>}
    </div>;
}

/** A question one has asked, changed where it stands. */
function Editing({ text, onCancel, onSend }: { text: string; onCancel: () => void; onSend: (text: string) => void }) {
    const [value, setValue] = useState(text);
    const box = useRef<HTMLTextAreaElement>(null);
    useEffect(() => { const el = box.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, []);
    return <div className="ai-edit">
        <textarea ref={box} value={value} maxLength={4000} onChange={event => setValue(event.target.value)}
            onKeyDown={event => { if (event.key === 'Escape') onCancel(); if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (value.trim()) onSend(value.trim()); } }} />
        <div className="ai-edit-btns"><button className="ai-pill" onClick={onCancel}>取消</button><button className="ai-pill go" disabled={!value.trim()} onClick={() => onSend(value.trim())}>发送</button></div>
    </div>;
}

export default function AiApp() {
    const { prefs, ready } = usePreferences(), tasks = useTasks();
    const who = useMemo(() => ({ type: 'me' as const }), []);
    const { loaded, term, error: loadError } = useTimeline(who, prefs, ready, null, tasks);
    const [kept, setKept] = useState<Kept>(readKept);
    const [chat, setChat] = useState<Chat>(() => { const saved = kept.chats.find(item => item.id === kept.current); return saved ? opened(saved) : empty(); });
    const [projects, setProjects] = useState(readProjects);
    const restore = useRef(rememberedProject());
    const [projectId, setProjectId] = useState(() => kept.chats.find(item => item.id === kept.current)?.project);
    const [workspace, setWorkspace] = useState<Workspace<Proposal>>();
    const [projectSettings, setProjectSettings] = useState(false);
    const [pendingProject, setPendingProject] = useState<{ project: Project; folder: Folder; view?: ProjectView }>();
    const [newProject, setNewProject] = useState<string | null>(null);
    const [moving, setMoving] = useState<string[]>([]);
    const [multi, setMulti] = useState<string[] | null>(null);
    const [search, setSearch] = useState('');
    const [archived, setArchived] = useState(false);
    const [projectError, setProjectError] = useState('');
    const [savingProject, setSavingProject] = useState(Boolean(restore.current));
    const [skill, setSkill] = useState<{ name: string; text: string }>();
    const personal = usePersonalInstructions();
    const activeChat = useRef(chat.id); activeChat.current = chat.id;
    const project = projects.find(item => item.id === projectId);
    const diskBase = useRef<ChatRevision<Proposal> | undefined>(undefined);
    const diskWrite = useRef<Promise<void>>(Promise.resolve());
    const diskDirty = useRef<Chat | null>(null);
    const courseProjects = useMemo(() => {
        const byCourse = new Map<string, string>();
        for (const { course } of loaded?.line.meetings ?? []) byCourse.set(course.code || courseName(course.name), courseName(course.name));
        return [...byCourse].map(([course, name]) => ({ course, name })).filter(course => !projects.some(saved => saved.course === course.course));
    }, [loaded, projects]);
    const [side, setSide] = useState(false), [menu, setMenu] = useState<string | null>(null), [renaming, setRenaming] = useState<string | null>(null);
    const [modelSettings, setModelSettings] = useState(readModelSettings);
    useEffect(() => {
        const update = () => setModelSettings(readModelSettings());
        window.addEventListener(MODEL_SETTINGS_CHANGED, update); window.addEventListener('storage', update);
        return () => { window.removeEventListener(MODEL_SETTINGS_CHANGED, update); window.removeEventListener('storage', update); };
    }, []);
    const [memory, setMemory] = useState<Memory>(readMemory), [minding, setMinding] = useState(false);
    useEffect(() => writeMemory(memory), [memory]);
    const memoryNow = useRef(memory); memoryNow.current = memory;
    const scopedMemory = useRef({ project, workspace, text: '' });
    scopedMemory.current = { project, workspace, text: project ? workspace?.memory ?? project.memory ?? '' : memory.text };
    const choice = chat.model ?? modelSettings.selection;
    const provider = selectedProvider(modelSettings, choice);
    const runtimeOff = choice.provider === RUNTIME_PROVIDER && !modelSettings.runtimeEnabled;
    const own = provider?.kind === 'api' ? { base: provider.base, key: provider.key, model: choice.model } : null;
    const runtime = provider?.kind === 'runtime';
    const free = choice.provider === FREE_MODEL.provider;
    const [toolPreferences, setTools] = useState(readToolPreferences);
    const [browserTools, setBrowserTools] = useState<BrowserTool[]>([]);
    const [mcpOpen, setMcpOpen] = useState(false);
    const [approval, setApproval] = useState<{ label: string; detail: string; finish: (allow: boolean) => void } | null>(null);
    const canUseBrowser = Boolean(own || runtime);
    useEffect(() => {
        const refresh = () => setTools(readToolPreferences());
        window.addEventListener(TOOL_SETTINGS_CHANGED, refresh); window.addEventListener('storage', refresh);
        return () => { window.removeEventListener(TOOL_SETTINGS_CHANGED, refresh); window.removeEventListener('storage', refresh); };
    }, []);
    useEffect(() => {
        setBrowserTools([]);
        if (!canUseBrowser || !toolPreferences.enabledBrowser.length) return;
        const controller = new AbortController();
        void listBrowserTools(controller.signal).then(tools => { if (!controller.signal.aborted) setBrowserTools(tools); }, () => {});
        return () => controller.abort();
    }, [canUseBrowser, toolPreferences]);
    // Opening a conversation shows it as it was; only what is said in it moves it to the top of the list.
    const opening = useRef(true);
    const [draft, setDraft] = useState(''), [streaming, setStreaming] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [modelStage, setModelStage] = useState('');
    const [waiting, setWaiting] = useState<{ text: string; preferred?: string } | null>(null), [editing, setEditing] = useState<string | null>(null), [below, setBelow] = useState(false);
    // While answering after a message, only what this answer says shows after it, not the answer it had before.
    const [from, setFrom] = useState<string | null>(null);
    const fresh = useRef(new Set<string>());
    // The document kernel, loaded once; nothing is shown as raw text while it loads, and an answer waits for it.
    const [drawn, setDrawn] = useState(false);
    const [live, setLive] = useState<Update | null>(null);
    useEffect(() => { void docReady().then(() => setDrawn(true)); }, []);
    const stop = useRef<AbortController | null>(null);
    useEffect(() => { if (runtimeOff) stop.current?.abort(); }, [runtimeOff]);
    // Only the failed request is kept in memory, so an explicit retry keeps its accepted dialogue and completed tools.
    const failedRuntime = useRef<{ request: RuntimeRequest; firstId?: string } | null>(null);
    useEffect(() => { failedRuntime.current = null; }, [choice.provider, choice.model]);
    const end = useRef<HTMLDivElement>(null), scroller = useRef<HTMLDivElement>(null), stuck = useRef(true);
    const services = useMemo(() => new CampusTools(), []);
    useEffect(() => () => services.dispose(), [services]);
    const latest = useRef(loaded?.line); latest.current = loaded?.line;
    const latestTerm = useRef(term); latestTerm.current = term;
    useEffect(() => {
        if (opening.current) { opening.current = false; return; }
        if (!chat.thread.nodes.length) return;
        if (workspace) {
            if (diskDirty.current === chat || busy) return;
            diskDirty.current = chat;
            const root = workspace.folder;
            const { id } = chat;
            setSavingProject(true);
            diskWrite.current = diskWrite.current.then(async () => {
                const base = diskBase.current?.chat.id === id ? diskBase.current : undefined;
                const saved = { ...base?.chat, ...chat, title: base?.chat.title ?? '', updated: Date.now() };
                const name = await saveProjectChat(root, saved, base?.name);
                diskBase.current = { name, chat: saved };
                rememberProject(projectId, id, name);
                setWorkspace(work => work?.folder === root ? { ...work, revisions: [{ name, chat: saved }, ...work.revisions.filter(revision => revision.chat.id !== id)] } : work);
            }).catch(failure => {
                setProjectError(failure instanceof Error ? failure.message : '无法保存这段项目对话。');
            }).finally(() => setSavingProject(false));
            return;
        }
        if (project?.folder) return;
        if (projectId) rememberProject(projectId, chat.id);
        setKept(all => {
            const id = chat.id, before = all.chats.find(item => item.id === id);
            const saved = { ...before, ...chat, project: projectId, title: before?.title ?? '', updated: Date.now() };
            return { chats: [saved, ...all.chats.filter(item => item.id !== id)], current: id };
        });
    }, [chat, workspace, project?.folder, projectId, busy]);
    useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(kept)); } catch { /* Kept for this page only. */ } }, [kept]);
    const open = (id: string | null, inProject = projectId, work: Workspace<Proposal> | null | undefined = workspace, revision?: ChatRevision<Proposal>) => {
        if (busy) return;
        const found = revision?.chat ?? kept.chats.find(item => item.id === id);
        diskBase.current = revision;
        opening.current = true;
        const next = found ? opened(found) : empty();
        diskDirty.current = next;
        setChat(next); failedRuntime.current = null;
        rememberProject(inProject, found?.id, revision?.name);
        setProjectId(inProject); setWorkspace(work ?? undefined); setMulti(null); setSkill(undefined);
        setKept(all => ({ ...all, current: found && !work ? found.id : null }));
        setError(''); setEditing(null); setDraft(''); setWaiting(null); setSide(false); setMenu(null); stuck.current = true;
    };
    const ordinary = () => { setProjectError(''); open(null, '', null); };
    function keepProject(next: Project) {
        setProjects(current => {
            const all = [next, ...current.filter(item => item.id !== next.id)];
            saveProjects(all);
            return all;
        });
    }
    function enter(next: Project, work?: Workspace<Proposal>) {
        setProjectError('');
        open(null, next.id, work ?? null);
        if (next.folder && !work) setProjectSettings(true);
    }
    async function openBound(next: Project, handle: Folder, view?: ProjectView) {
        try {
            const work = await openWorkspace<Proposal>(handle);
            if (work.project.id !== next.id) throw new Error('当前文件夹属于另一个项目，请重新定位。');
            const heads = work.revisions.filter(entry => entry.chat.id === view?.chat);
            const revision = heads.find(entry => entry.name === view?.revision) ?? (heads.length === 1 ? heads[0] : undefined);
            open(revision?.chat.id ?? null, next.id, work, revision);
        } catch (failure) {
            if (!(failure instanceof DOMException) || !['NotFoundError', 'NotAllowedError'].includes(failure.name)) throw failure;
            enter(next);
        }
    }
    async function chooseProject(next: Project) {
        setProjectError('');
        if (!next.folder) { enter(next); return; }
        const handle = await savedFolder(next.id);
        if (!handle) { enter(next); return; }
        if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') { setPendingProject({ project: next, folder: handle }); return; }
        await openBound(next, handle);
    }
    async function selectLocal() {
        const folder = await pickFolder();
        const work = await openWorkspace<Proposal>(folder);
        const saved = projects.find(item => item.id === work.project.id);
        const next = { ...work.project, references: saved?.references };
        await saveFolder(next.id, folder);
        keepProject(next); enter(next, work);
    }
    async function bindProject(child: boolean) {
        if (!project) return;
        const parent = await pickFolder();
        if (project.folder) {
            const work = await openWorkspace<Proposal>(parent);
            if (work.project.id !== project.id) throw new Error('请选择此项目移动后的目录。');
            await saveFolder(project.id, parent);
            const next = { ...work.project, references: project.references };
            keepProject(next);
            await openBound(next, parent, { id: project.id, chat: chat.id, revision: diskBase.current?.name });
            return;
        }
        const root = child ? await newProjectFolder(parent, project.name) : parent;
        const work = await openWorkspace<Proposal>(root, project);
        const leaving = kept.chats.filter(item => item.project === project.id);
        for (const item of leaving) await saveProjectChat(root, item);
        await saveFolder(project.id, root);
        work.revisions = await workspaceRevisions(root);
        const next = { ...work.project, references: project.references };
        keepProject(next);
        const updated = { chats: kept.chats.filter(item => item.project !== project.id), current: null };
        localStorage.setItem(KEY, JSON.stringify(updated));
        setKept(updated);
        enter(next, work);
    }
    async function saveProjectNote(value: string) {
        if (!project) return;
        if (workspace) {
            await writeProjectInstructions(workspace.folder, workspace.instructions, value.trim());
            setWorkspace({ ...workspace, instructions: value.trim() });
        } else if (!project.folder) keepProject({ ...project, instructions: value.trim() });
    }
    async function saveScopedMemory(next: Memory) {
        const scope = scopedMemory.current;
        if (scope.project) {
            if (scope.project.folder && !scope.workspace) throw new Error('打开主目录后才可保存该项目的记忆。');
            if (scope.workspace) {
                if (scope.text !== next.text) await writeProjectMemory(scope.workspace.folder, scope.text, next.text);
                const changed = { ...scope.workspace, memory: next.text };
                scopedMemory.current = { ...scope, workspace: changed, text: next.text };
                setWorkspace(current => current?.folder === changed.folder ? { ...current, memory: next.text } : current);
            } else if (scope.text !== next.text) {
                const changed = { ...scope.project, memory: next.text };
                scopedMemory.current = { ...scope, project: changed, text: next.text };
                keepProject(changed);
            }
            memoryNow.current = { ...memoryNow.current, on: next.on };
        } else memoryNow.current = next;
        setMemory(memoryNow.current);
    }
    async function addReference() {
        if (!project) return;
        const handle = await pickFolder(false);
        const id = newId();
        await saveFolder(id, handle);
        keepProject({ ...project, references: [...project.references ?? [], { id, name: handle.name }] });
    }
    async function removeReference(id: string) {
        if (!project) return;
        keepProject({ ...project, references: project.references?.filter(item => item.id !== id) });
        await dropFolder(id);
    }
    async function moveChats(target: Project) {
        const ids = new Set(moving);
        let next = { ...kept, chats: kept.chats.map(item => ids.has(item.id) ? { ...item, project: target.id } : item) };
        if (target.folder) {
            const root = await savedFolder(target.id);
            if (!root || await root.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('先打开目标项目并授权目录，然后重试。');
            const work = await openWorkspace<Proposal>(root);
            if (work.project.id !== target.id) throw new Error('当前文件夹属于另一个项目。');
            for (const item of next.chats.filter(item => ids.has(item.id))) await saveProjectChat(work.folder, item);
            next = { chats: next.chats.filter(item => !ids.has(item.id)), current: ids.has(kept.current ?? '') ? null : kept.current };
        }
        localStorage.setItem(KEY, JSON.stringify(next));
        if (ids.has(chat.id)) ordinary();
        setKept(next); setMoving([]); setMulti(null);
    }
    async function projectAction(action: () => Promise<void>) {
        setProjectError(''); setSavingProject(true);
        try { await action(); }
        catch (failure) { if (!(failure instanceof DOMException && failure.name === 'AbortError')) setProjectError(failure instanceof Error ? failure.message : '项目暂时无法打开。'); }
        finally { setSavingProject(false); }
    }
    useEffect(() => {
        const view = restore.current;
        if (!view) return;
        restore.current = undefined;
        const next = projects.find(item => item.id === view.id);
        if (!next) { rememberProject(undefined); setSavingProject(false); return; }
        void projectAction(async () => {
            if (!next.folder) { open(view.chat ?? null, next.id, null); return; }
            const handle = await savedFolder(next.id);
            if (!handle) { enter(next); return; }
            if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
                open(null, next.id, null);
                rememberProject(view.id, view.chat, view.revision);
                setPendingProject({ project: next, folder: handle, view });
                return;
            }
            await openBound(next, handle, view);
        });
    }, []);
    const activeConflict = Boolean(workspace && workspace.revisions.filter(revision => revision.chat.id === chat.id).length > 1);
    const unavailableProject = Boolean(project?.folder && !workspace);
    async function changeChat(item: Saved<Proposal>, update: Partial<Saved<Proposal>>, revision?: ChatRevision<Proposal>) {
        const next = { ...item, ...update };
        if (revision && workspace) {
            const work = workspace;
            const name = await saveProjectChat(work.folder, next, revision.name);
            if (diskBase.current?.name === revision.name) diskBase.current = { name, chat: next };
            setWorkspace({ ...work, revisions: [{ name, chat: next }, ...work.revisions.filter(existing => existing.name !== revision.name)] });
        } else setKept(all => ({ ...all, chats: all.chats.map(record => record.id === item.id ? next : record) }));
        setMenu(null);
    }
    const remove = (id: string) => {
        const removed = kept.chats.find(item => item.id === id);
        setKept(all => ({ chats: all.chats.filter(item => item.id !== id), current: all.current === id ? null : all.current }));
        if (kept.current === id) { opening.current = true; setChat(empty()); failedRuntime.current = null; }
        setMenu(null);
        if (removed?.runtimeModels?.length) void closeRuntimeChat(removed.id, removed.forks ?? [], removed.runtimeModels).catch(failure => setError(failure instanceof Error ? failure.message : '部分模型页面尚未关闭。'));
    };
    const rename = (item: Saved<Proposal>, title: string, revision?: ChatRevision<Proposal>) => {
        setRenaming(null);
        const next = title.trim().slice(0, 60);
        if (next !== item.title) void projectAction(() => changeChat(item, { title: next }, revision));
    };
    function setModel(next: ModelSelection) {
        if (next.provider === choice.provider && next.model === choice.model) return;
        const settings = { ...readModelSettings(), selection: next };
        try { writeModelSettings(settings); }
        catch { setError('无法保存模型设置，请检查浏览器存储权限。'); return; }
        setChat(current => ({ ...current, model: next, resetRuntime: next.provider === RUNTIME_PROVIDER && current.thread.nodes.length > 0 }));
        setError('');
    }
    // The view follows the answer down unless one has scrolled up to read; then a button brings it back.
    useEffect(() => {
        const box = scroller.current; if (!box) return;
        const onScroll = () => { stuck.current = box.scrollTop + box.clientHeight >= box.scrollHeight - 80; setBelow(!stuck.current); };
        box.addEventListener('scroll', onScroll, { passive: true });
        return () => box.removeEventListener('scroll', onScroll);
    }, []);
    useEffect(() => { if (stuck.current) end.current?.scrollIntoView({ block: 'end' }); }, [chat, streaming]);

    const execute = useMemo(() => async (name: string, raw: unknown, call = ''): Promise<unknown> => {
        const args = toolArguments(name, raw), line = latest.current;
        if (name === 'search') return services.query(String(args.query), args.in === undefined ? undefined : String(args.in));
        if (name === 'read') return services.read(String(args.id), args.offset as number | undefined);
        if (name === 'course') return services.course(String(args.course));
        if (name === 'schedule') return services.schedule(String(args.of));
        if (name === 'curriculum') return services.curriculum(String(args.major), args.grade === undefined ? undefined : String(args.grade));
        if (name === 'find_place') return services.findPlace(String(args.query));
        if (name === 'nearby') return services.nearby(String(args.near), String(args.what));
        if (name === 'free_rooms') return services.rooms(args);
        if (name === 'route') return services.route(args);
        if (name === 'remember') {
            if (!memoryNow.current.on) throw new Error('记忆已关闭。');
            const text = remembered(scopedMemory.current.text, String(args.fact));
            await saveScopedMemory({ on: true, text });
            return { remembered: true };
        }
        if (!line) throw new Error('请先在“我”里选择班级，等待课表读取完成。');
        if (name === 'timeline') return readTimeline(line, String(args.from), String(args.to));
        if (name === 'exams') return readExams(line);
        if (name === 'list_tasks') return readTasks().filter(task => !task.deleted);
        if (name === 'suggest_slots') return schedulingTool(line, args);
        if (name === 'propose_task') {
            const proposal = taskProposal(args, { ...line, tasks: readTasks().filter(task => !task.deleted) }); const key = newTaskId();
            setChat(current => ({ ...current, proposals: [...current.proposals, { ...proposal, key, call }] }));
            return { state: 'awaiting_user_confirmation', proposal: key, task: proposal.task };
        }
        throw new Error('未知工具。');
    }, [services]);

    // Only the shared quota waits for sign-in. Switching source never silently sends that pending question elsewhere.
    useEffect(() => {
        if (!free && waiting) { setDraft(current => current || waiting.text); setWaiting(null); }
    }, [free, waiting]);
    useEffect(() => {
        if (!waiting || !free) return;
        const back = async () => { if (document.visibilityState === 'visible' && await session()) { const question = waiting; setWaiting(null); void send(question.text, true, tip(chat.thread), question.preferred); } };
        window.addEventListener('focus', back); document.addEventListener('visibilitychange', back);
        return () => { window.removeEventListener('focus', back); document.removeEventListener('visibilitychange', back); };
    });
    /** The moment and campus context, as this device knows them now. */
    const situation = (): Situation => {
        const term = latestTerm.current, today = momentNow().date;
        const note = [project?.course ? `当前课程项目是「${project.name}」。` : '', workspace?.instructions ?? project?.instructions, skill ? `本轮使用技能「${skill.name}」\n${skill.text}` : ''].filter(Boolean).join('\n\n');
        return { week: term ? weekOfDate(term, today) ?? 0 : null, class: prefs.class ?? null, campus: prefs.campus ?? PRODUCT_CONFIG.CAMPUS.id,
            memory: memoryNow.current.on ? scopedMemory.current.text : null, instructions: combinedInstructions(personal, note) };
    };
    const availableTools = toolCatalog(situation(), toolPreferences, canUseBrowser ? browserTools : []);
    function approve(tool: ToolItem, args: unknown, signal: AbortSignal): Promise<boolean> {
        if (signal.aborted) return Promise.resolve(false);
        const fact = (args as { fact?: unknown } | null)?.fact;
        const detail = tool.browser ? '读取结果会交给当前模型。' : typeof fact === 'string' ? fact : '把一条信息写入你的记忆。';
        return new Promise(resolve => {
            const cancel = () => finish(false);
            const finish = (allow: boolean) => { signal.removeEventListener('abort', cancel); setApproval(null); resolve(allow); };
            signal.addEventListener('abort', cancel, { once: true });
            setApproval({ label: tool.label, detail, finish });
        });
    }
    /** Answering after `at` in `base`: each message said grows the branch from there, and is the one shown. */
    async function run(base: Thread, at: string, options: { fork?: boolean; retry?: boolean } = {}) {
        if (activeConflict || unavailableProject) return;
        if (!provider) { setError(runtimeOff ? RUNTIME_DISABLED : '所选模型已停用或移除，请重新选择。'); return; }
        if (skill) setSkill(undefined);
        let thread = base, tipId = at;
        const retried = runtime && options.retry ? failedRuntime.current : null;
        const pending = runtime && !options.fork ? failedRuntime.current : null;
        let firstId = options.fork ? newId() : pending?.firstId && !base.nodes.some(node => node.id === pending.firstId) ? pending.firstId : undefined;
        const reset = runtime && chat.resetRuntime && !options.fork && !retried;
        const cid = firstId ?? retried?.request.conversation_id ?? (reset ? at : conversationId(base, at, chat.id, chat.forks));
        if (options.fork || reset) setChat(current => ({ ...current, forks: [...current.forks, cid], resetRuntime: false }));
        if (!options.retry) failedRuntime.current = null;
        const grow = (message: Message) => { const id = message.role === 'assistant' && firstId ? firstId : newId(); if (message.role === 'assistant') firstId = undefined; fresh.current.add(id); thread = append(thread, tipId, id, message); tipId = id; setChat(current => ({ ...current, thread })); };
        fresh.current = new Set(); setFrom(at);
        const turn = lineage(thread, at);
        const preferred = turn.findLast(node => node.message.role === 'user')?.preferredTool;
        let history = turn.map(node => node.message);
        if (!runtime) history = recent(free ? campusHistory(history) : history);
        setChat(current => ({ ...current, thread, model: choice })); setBusy(true); setError(''); setEditing(null); stuck.current = true;
        const controller = new AbortController(); stop.current = controller;
        let said = '';
        try {
            await docReady();
            const preferences = readToolPreferences();
            const granted = canUseBrowser && preferences.enabledBrowser.length ? await listBrowserTools(controller.signal).catch(() => []) : [];
            if (controller.signal.aborted) return;
            const catalog = toolCatalog(situation(), preferences, granted);
            const modelTools = catalog.map(tool => tool.definition);
            const byName = new Map(catalog.map(tool => [tool.definition.function.name, tool]));
            const denied = new Set<string>();
            if (preferred && !byName.has(preferred)) throw new Error('所选工具暂不可用，请重新选择。');
            for (let round = 0; round < ROUNDS; round++) {
                const last = round === ROUNDS - 1;
                said = ''; setStreaming(''); setLive(null); setModelStage('');
                const doc = new DocStream();
                const onDelta = (piece: string) => { said += piece; setStreaming(said); setLive(doc.push(piece)); };
                const context = { tools: modelTools, preferred: round === 0 ? preferred : undefined };
                const request = runtime ? round === 0 && retried ? retried.request : runtimeRequest(choice.model, history, situation(), last, cid, context) : null;
                if (request) {
                    failedRuntime.current = { request, firstId };
                    setChat(current => current.runtimeModels.includes(request.model) ? current : { ...current, runtimeModels: [...current.runtimeModels, request.model] });
                }
                const answer = await (request ? askRuntime(request, onDelta, controller.signal, options.retry === true && round === 0, setModelStage)
                    : own ? askOwn(own, history, situation(), last, onDelta, controller.signal, context) : ask(history, situation(), last, onDelta, controller.signal, context)).finally(() => doc.free());
                failedRuntime.current = null;
                setStreaming(null); setLive(null);
                history = [...history, answer]; grow(answer);
                if (!answer.tool_calls?.length) return;
                for (const call of answer.tool_calls) {
                    const tool = byName.get(call.function.name);
                    let value: unknown;
                    try {
                        if (!tool || readToolPreferences().disabledCampus.includes(call.function.name)) throw new Error('这个工具已停用或不在本轮授权中。');
                        const args = JSON.parse(call.function.arguments);
                        if (denied.has(call.function.name)) throw new Error('本轮已跳过这项工具。');
                        if (needsToolConfirmation(readToolPreferences().mode ?? 'read', tool) && !await approve(tool, args, controller.signal)) {
                            denied.add(call.function.name); throw new Error('本轮已跳过这项工具。');
                        }
                        if (controller.signal.aborted) return;
                        if (readToolPreferences().disabledCampus.includes(call.function.name)) throw new Error('这个工具已停用。');
                        value = tool.browser ? { tool: tool.label, data: await invokeBrowserTool(tool.browser, args, controller.signal) } : await execute(call.function.name, args, call.id);
                    } catch (failure) { value = { error: failure instanceof Error ? failure.message : '工具执行失败。', ...(tool?.browser ? { tool: tool.label } : {}), ...(failure instanceof UnknownReference ? { code: failure.code } : {}) }; }
                    const result: Message = { role: 'tool', tool_call_id: call.id, content: JSON.stringify(value) };
                    history = [...history, result]; grow(result);
                }
            }
        } catch (failure) {
            // Stopped: what was said so far stays, as an answer cut short.
            if (controller.signal.aborted) { if (said) grow({ role: 'assistant', content: said }); return; }
            setError(failure instanceof Error ? failure.message : 'AI 暂时无法响应。');
        } finally { setStreaming(null); setLive(null); setModelStage(''); setBusy(false); setFrom(null); stop.current = null; }
    }
    /** A question asked after `parent` (the end of the conversation, or before a question being changed). */
    async function send(question: string, signedIn = false, parent = tip(chat.thread), preferred?: string) {
        if (unavailableProject || activeConflict || savingProject) return;
        const asked = question.trim();
        if (!asked || busy) return;
        if (!provider) { setError(runtimeOff ? RUNTIME_DISABLED : '所选模型已停用或移除，请重新选择。'); return; }
        // The shared quota requires sign-in. Other sources keep their own authorization boundary.
        if (free && !signedIn) {
            const signed = await session();
            if (activeChat.current !== chat.id) return;
            if (!signed) { setWaiting({ text: asked, preferred }); window.open(`/login/?next=${encodeURIComponent('/signed-in/')}`, '_blank'); return; }
        }
        if (parent === tip(chat.thread)) setDraft('');
        const id = newId();
        void run(append(chat.thread, parent, id, { role: 'user', content: asked }, preferred), id, { fork: parent !== tip(chat.thread) });
    }
    /** The answer to a question asked again, beside the answer it had. */
    const again = (question: string) => { if (!busy) void run(chat.thread, question, { fork: true }); };
    const retry = () => { if (!busy) void run(chat.thread, tip(chat.thread), { retry: true }); };
    const pick = (id: string) => { if (!busy) { setChat(current => ({ ...current, thread: choose(current.thread, id) })); failedRuntime.current = null; setError(''); } };
    function confirm(key: string) {
        const proposal = chat.proposals.find(item => item.key === key); if (!proposal || proposal.saved) return;
        const current = proposal.id ? readTasks().find(task => task.id === proposal.id && !task.deleted) : undefined;
        if (proposal.id && current?.modified !== proposal.expected) { setError('这个任务已经改过了，请让 AI 重新起草。'); return; }
        saveTask({ ...proposal.task, id: proposal.id ?? newTaskId(), ...(proposal.task.done === 'awaiting-confirmation' ? { done: new Date().toISOString() } : {}) });
        setChat(all => ({ ...all, proposals: all.proposals.map(item => item.key === key ? { ...item, saved: true } : item) }));
    }
    let shown = path(chat.thread);
    const cut = from === null ? -1 : shown.findIndex(node => node.id === from);
    if (cut >= 0 && shown[cut + 1] && !fresh.current.has(shown[cut + 1]!.id)) shown = shown.slice(0, cut + 1);
    const results = new Map(shown.filter(node => node.message.role === 'tool').map(node => [node.message.tool_call_id!, parse(node.message.content)]));
    const today = momentNow().date;
    // One turn: a question, and everything that answered it, however many rounds of looking up it took.
    const turns: { question: Node; replies: Node[]; last: boolean }[] = [];
    shown.forEach(node => {
        if (node.message.role === 'user') turns.push({ question: node, replies: [], last: false });
        else turns.at(-1)?.replies.push(node);
    });
    if (turns.length) turns.at(-1)!.last = true;
    const blank = !shown.length;
    const locked = busy || savingProject;
    const whyUnavailable = unavailableProject ? '打开主目录后即可继续聊天。' : activeConflict ? '此对话有两个冲突版本，已保存在项目目录。' : runtimeOff ? RUNTIME_DISABLED : undefined;
    const composer = <Composer key={chat.id} value={draft} onChange={setDraft} onSend={(question, preferred) => void send(question, false, tip(chat.thread), preferred)} onStop={() => stop.current?.abort()} busy={busy} canSend={Boolean(provider && !unavailableProject && !activeConflict && !savingProject)} unavailable={whyUnavailable} tools={availableTools}
        permission={<ToolPermission mode={toolPreferences.mode ?? 'read'} disabled={busy} change={mode => {
            try { writeToolPreferences({ ...readToolPreferences(), mode }); } catch { setError('工具权限暂时无法保存。'); }
        }} />}
        picker={<ModelPicker settings={modelSettings} choice={choice} disabled={busy} runtimeOff={runtimeOff} select={setModel} />} />;
    const current = workspace ? diskBase.current?.chat : kept.chats.find(item => item.id === kept.current);
    const shownChats = (workspace ? workspace.revisions.map(revision => revision.chat) : kept.chats.filter(item => (item.project || undefined) === project?.id))
        .filter(item => Boolean(item.archived) === archived && (!search.trim() || titleOf(item).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
    const counts = new Map<string, number>();
    workspace?.revisions.forEach(revision => counts.set(revision.chat.id, (counts.get(revision.chat.id) ?? 0) + 1));
    function row(item: Saved<Proposal>) {
        const revision = workspace?.revisions.find(entry => entry.chat === item);
        const key = revision?.name ?? item.id;
        const conflicted = (counts.get(item.id) ?? 0) > 1;
        return <div key={key} className={`ai-chat ${item === current ? 'on' : ''} ${menu === key ? 'menu' : ''}`}>
            {multi && !workspace && <input type="checkbox" aria-label={`选择${titleOf(item)}`} checked={multi.includes(item.id)} onChange={event => setMulti(event.target.checked ? [...multi, item.id] : multi.filter(id => id !== item.id))} />}
            {renaming === key
                ? <input className="ai-rename" autoFocus defaultValue={titleOf(item)} maxLength={60} onBlur={event => rename(item, event.target.value, revision)}
                    onKeyDown={event => { if (event.key === 'Enter') rename(item, event.currentTarget.value, revision); if (event.key === 'Escape') setRenaming(null); }} />
                : <button className="ai-chat-t" disabled={locked} onClick={() => open(item.id, projectId, workspace ?? null, revision)} title={titleOf(item)}>{titleOf(item)}{conflicted && <small>冲突 · {revision?.name.slice(-6)}</small>}</button>}
            {!multi && <button className="ai-chat-more" aria-label="更多" disabled={locked} onClick={() => setMenu(menu === key ? null : key)}><Dots /></button>}
            {menu === key && <div className="ai-menu" role="menu">
                <button role="menuitem" disabled={conflicted} onClick={() => { setRenaming(key); setMenu(null); }}>重命名</button>
                <button role="menuitem" disabled={conflicted} onClick={() => void projectAction(() => changeChat(item, { pinned: !item.pinned }, revision))}>{item.pinned ? '取消置顶' : '置顶'}</button>
                <button role="menuitem" disabled={conflicted} onClick={() => void projectAction(() => changeChat(item, { archived: !item.archived }, revision))}>{item.archived ? '取消归档' : '归档'}</button>
                {!workspace && <button role="menuitem" onClick={() => { setMoving([item.id]); setMenu(null); }}>移入项目</button>}
                {!workspace && <button role="menuitem" className="danger" onClick={() => remove(item.id)}>删除</button>}
            </div>}
        </div>;
    }
    return <div className={`sd ai campus-entry ${blank ? 'blank' : ''} ${side ? 'side-open' : ''}`}>
        <aside className="ai-side" aria-label="对话">
            <button className="ai-side-new" disabled={locked || unavailableProject} onClick={() => open(null)}><Compose />新对话</button>
            <button className="ai-side-new ai-side-tools" onClick={() => { setMcpOpen(true); setSide(false); }}>MCP</button>
            <label className="ai-history-search"><Magnifier /><input type="search" placeholder="搜索对话" aria-label="搜索对话" value={search} onChange={event => setSearch(event.target.value)} /></label>
            <nav className="ai-side-list">
                <section className="ai-project-nav" aria-label="项目">
                    <div className="ai-project-heading"><h4>项目</h4><button type="button" className="ai-icon" aria-label="新建项目" title="新建项目" disabled={locked} onClick={() => setNewProject('')}>＋</button></div>
                    {projects.map(item => <button key={item.id} className={`ai-project-link${projectId === item.id ? ' on' : ''}`} disabled={locked} onClick={() => void projectAction(() => chooseProject(item))}>{item.name}</button>)}
                    {courseProjects.length > 0 && <details className="ai-course-projects"><summary>课程</summary>{courseProjects.map(item => <button key={item.course} className="ai-project-link" disabled={locked} onClick={() => {
                        const next = { ...item, id: newId(), instructions: `以《${item.name}》为当前课程。优先查阅本课程的讲解和资料，给出相关出处。` };
                        keepProject(next); enter(next);
                    }}>{item.name}</button>)}</details>}
                    {folderAvailable() && <button className="ai-project-link" disabled={locked} onClick={() => void projectAction(selectLocal)}>打开本地项目…</button>}
                </section>
                <section className="ai-history" aria-label="对话">
                    <div className="ai-project-heading"><h4>{project?.name ?? '对话'}</h4>{project && <button className="ai-link" disabled={locked} onClick={ordinary}>全部对话</button>}</div>
                    <div className="ai-project-controls">
                        {project && <button className="ai-link" disabled={locked} onClick={() => setProjectSettings(true)}>项目设置</button>}
                        {workspace && <button className="ai-link" disabled={locked} onClick={() => void projectAction(() => chooseProject(project!))}>刷新</button>}
                        <button className="ai-link" disabled={locked} onClick={() => { setArchived(!archived); setMulti(null); }}>{archived ? '返回近期' : '归档'}</button>
                        {!workspace && shownChats.length > 0 && <button className="ai-link" disabled={locked} onClick={() => setMulti(multi ? null : [])}>{multi ? '取消选择' : '多选'}</button>}
                        {multi && multi.length > 0 && <button className="ai-link" disabled={locked} onClick={() => setMoving(multi)}>移入项目 · {multi.length}</button>}
                    </div>
                    {shownChats.some(item => item.pinned) && <section><h4>置顶</h4>{shownChats.filter(item => item.pinned).sort((a, b) => b.updated - a.updated).map(row)}</section>}
                    {chatGroups(shownChats.filter(item => !item.pinned), Date.now()).map(group => <section key={group.name}><h4>{group.name}</h4>{group.chats.map(row)}</section>)}
                    {!shownChats.length && <p className="ai-side-none">{search.trim() ? '没有找到对话' : archived ? '没有归档对话' : '暂无对话'}</p>}
                </section>
            </nav>
            <button className="ai-side-memory" onClick={() => { setMinding(true); setSide(false); }}><b>{project ? '项目记忆' : '记忆'}</b><small>{!memory.on ? '已关闭' : scopedMemory.current.text.trim() ? `记着 ${scopedMemory.current.text.split('\n').filter(line => line.trim()).length} 件事` : '还没有'}</small></button>
        </aside>
        {side && <div className="ai-scrim" onClick={() => setSide(false)} />}
        {projectError && <div className="ai-project-error" role="alert"><span>{projectError}</span><button className="ai-link" onClick={() => setProjectError('')}>关闭</button></div>}
        {project && projectSettings && <ProjectSettings project={project} folder={workspace?.folder} instructions={workspace?.instructions ?? project.instructions ?? ''} activeSkill={skill?.name}
            save={saveProjectNote} bind={bindProject} attach={addReference} detach={removeReference} useSkill={(name, text) => setSkill(name ? { name, text } : undefined)} onClose={() => setProjectSettings(false)} />}
        {pendingProject && <Sheet title="打开项目目录" onClose={() => setPendingProject(undefined)}>
            <p className="fine">{pendingProject.project.name} · {pendingProject.folder.name}</p>
            <div className="ai-project-actions"><button className="btn" onClick={() => { enter(pendingProject.project); setPendingProject(undefined); }}>重新定位</button>
                <button className="btn go" disabled={locked} onClick={() => void projectAction(async () => {
                    const { folder, project: target, view } = pendingProject;
                    if (await folder.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('需要允许访问主目录才能打开这个项目。');
                    await openBound(target, folder, view);
                    setPendingProject(undefined);
                })}>打开</button></div>
        </Sheet>}
        {newProject !== null && <Sheet title="新建项目" onClose={() => setNewProject(null)}>
            <form className="ai-project-settings" onSubmit={event => {
                event.preventDefault();
                const name = newProject.trim(); if (!name) return;
                const next = { id: newId(), name };
                keepProject(next); setNewProject(null);
                if (moving.length) void projectAction(() => moveChats(next)); else enter(next);
            }}><label>项目名称<input className="tf" autoFocus required maxLength={60} value={newProject} onChange={event => setNewProject(event.target.value)} /></label>
                <div className="ai-project-actions"><button className="btn go" disabled={!newProject.trim() || locked}>创建</button></div></form>
        </Sheet>}
        {moving.length > 0 && newProject === null && <Sheet title="移入项目" onClose={() => setMoving([])}>
            {projects.filter(item => item.id !== projectId).map(item => <button type="button" className="kv" key={item.id} disabled={locked} onClick={() => void projectAction(() => moveChats(item))}><span className="v">{item.name}</span><Chevron /></button>)}
            <div className="ai-project-actions"><button className="btn go" disabled={locked} onClick={() => setNewProject('')}>新建项目</button></div>
        </Sheet>}
        {mcpOpen && <Sheet title="MCP" onClose={() => setMcpOpen(false)}><ToolSettings /></Sheet>}
        {approval && <Sheet title={`允许${approval.label}？`} onClose={() => approval.finish(false)}>
            <p className="fine lead">{approval.detail}</p>
            <div className="ai-tool-actions"><button type="button" className="btn" onClick={() => approval.finish(false)}>跳过</button><button type="button" className="btn primary" onClick={() => approval.finish(true)}>允许本次</button></div>
        </Sheet>}
        {minding && <MemorySettings memory={{ on: memory.on, text: scopedMemory.current.text }} isProject={Boolean(project)} onClose={() => setMinding(false)} onSave={next => void projectAction(async () => { await saveScopedMemory(next); setMinding(false); })} />}
        <div className="ai-main">
        <CampusHeader className="ai-bar">
            <button className="ai-icon ai-menu-btn" aria-label="对话列表" onClick={() => setSide(true)}><Bars /></button>
            <span className="ai-title">{blank ? project?.name ?? '' : titleOf(current ?? { title: '', thread: chat.thread })}</span>
            {!blank && <button className="ai-icon ai-bar-new" aria-label="新对话" title="新对话" disabled={locked} onClick={() => open(null)}><Compose /></button>}
        </CampusHeader>
        <div className="ai-scroll" ref={scroller}><div className="ai-col">
        {blank && <div className="ai-hello">
            <h1>{project?.name ?? '有什么可以帮你？'}</h1>
            {composer}
            {!waiting && !project && <div className="ai-examples">{AI_EXAMPLES.map(example => <button key={example} disabled={runtimeOff} onClick={() => void send(example)}>{example}</button>)}</div>}
            {!prefs.class && <p className="fine">先在“我”里选好班级，AI 才能看到你的课表；搜索和空教室现在就能问。</p>}
            {!project && <p className="fine">可以问课表、空教室和地图，还能查课程知识、培养方案、真题与通知。任务草案经你确认后才会保存。普通对话保存在当前设备。</p>}
        </div>}
        {loadError && <p role="status" className="fine">课表还没读完：{loadError}</p>}
        <div className="ai-turns" aria-live="polite">{turns.map(turn => {
            const replies = turn.replies.map(node => node.message);
            const calls = replies.flatMap(reply => reply.tool_calls ?? []);
            // What it said last without looking anything more up: what it says before looking something up is part of
            // the looking (its steps), and a tool's result is never the answer.
            const answer = [...replies].reverse().find(reply => reply.role === 'assistant' && reply.content && !reply.tool_calls?.length)?.content;
            const steps = stepsOf(calls.map(call => ({ id: call.id, name: call.function.name, arguments: call.function.arguments })), results);
            const doing = steps.some(step => step.pending);
            // What it found, to tap: every article it read, the last of anything else.
            const found = new Map<string, { name: string; result: unknown }>();
            calls.forEach(call => { const result = results.get(call.id); if (result && !(typeof result === 'object' && 'error' in (result as object))) found.set(call.function.name === 'read' ? call.id : call.function.name, { name: call.function.name, result }); });
            const drafts = chat.proposals.filter(item => calls.some(call => call.id === item.call));
            const question = turn.question.message.content ?? '';
            const answering = turn.last && busy;
            return <section key={turn.question.id} className="ai-turn">
                {editing === turn.question.id
                    ? <Editing text={question} onCancel={() => setEditing(null)} onSend={text => void send(text, false, turn.question.parent)} />
                    : <div className="ai-ask"><p className="ai-q">{question}</p>
                        <div className="ai-tools ai-tools-q"><CopyButton text={question} /><button className="ai-icon" aria-label="改问题" title="改问题" disabled={busy} onClick={() => setEditing(turn.question.id)}><Pencil /></button>
                            <Branches thread={chat.thread} id={turn.question.id} onChoose={pick} disabled={busy} /></div></div>}
                {steps.length > 0 && <details className="ai-steps"><summary className={doing ? 'doing' : ''}>{stepsLine(steps)}</summary>
                    <ol>{steps.map((step, i) => <li key={calls[i]!.id} className={step.failed ? 'failed' : step.pending ? 'doing' : ''}><details><summary><b>{step.label}</b>{step.detail && <span>{step.detail}</span>}</summary><p>调用参数</p><pre>{showArguments(calls[i]!.function.arguments)}</pre><p>调用结果</p><pre>{step.pending ? '正在等待结果…' : JSON.stringify(results.get(calls[i]!.id), null, 2)}</pre></details></li>)}</ol>
                </details>}
                {answer && drawn && <div className="ai-a"><DocText text={answer} /></div>}
                {turn.last && live && <div className="ai-a"><Doc blocks={live.blocks} live /></div>}
                {answering && !live && !doing && <p className="ai-think">{modelStage || '正在想'}</p>}
                {found.size > 0 && [...found.values()].map(item => <Found key={item.name} name={item.name} result={item.result} />)}
                {drafts.length > 0 && <Drafts drafts={drafts} today={today} onAdd={keys => keys.forEach(confirm)} onDrop={key => setChat(all => ({ ...all, proposals: all.proposals.filter(item => item.key !== key) }))} />}
                {!answering && turn.replies.length > 0 && <div className="ai-tools">
                    {answer && <CopyButton text={answer} />}
                    <button className="ai-icon" aria-label="重新回答" title="重新回答" disabled={busy} onClick={() => again(turn.question.id)}><Again /></button>
                    <Branches thread={chat.thread} id={turn.replies[0]!.id} onChoose={pick} disabled={busy} />
                </div>}
            </section>;
        })}</div>
        {error && !runtimeOff && <p role="alert" className="ai-error">{error}{turns.length > 0 && <TextAction refresh onClick={retry}>重试</TextAction>}</p>}
        {waiting && <p role="status" className="fine">在新打开的页面登录或注册，回到这里会自动发出：“{waiting.text}”</p>}
        <div ref={end} className="ai-end" />
        </div></div>
        {below && !blank && <button className="ai-down" aria-label="回到底部" onClick={() => { stuck.current = true; end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }}><Down /></button>}
        {!blank && <div className="ai-dock">{composer}</div>}
        </div>
    </div>;
}

/** What the AI keeps in mind: to read, change, empty or turn off. */
function MemorySettings({ memory, isProject, onClose, onSave }: { memory: Memory; isProject: boolean; onClose: () => void; onSave: (memory: Memory) => void }) {
    // Shown as plain lines; kept as a list, one `- ` item a line, as the AI reads and writes it.
    const [value, setValue] = useState(() => ({ ...memory, text: memory.text.replace(/^- /gm, '') }));
    const count = value.text.split('\n').filter(line => line.trim()).length;
    const kept = () => value.text.split('\n').map(line => line.trim()).filter(Boolean).map(line => `- ${line}`).join('\n').slice(0, MEMORY_LIMIT);
    const title = isProject ? '项目记忆' : '记忆';
    return <div className="ai-modal" role="dialog" aria-label={title} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
        <form className="ai-modal-box ai-mind" onSubmit={event => { event.preventDefault(); onSave({ on: value.on, text: kept() }); }}>
            <header className="ai-mind-head">
                <div><h2>{title}</h2><p>{isProject ? '记下这个项目的约定、结论和进展。' : 'AI 记下你的专业、习惯和偏好，回答会越来越贴合你。'}</p></div>
                <label className="ai-toggle" title={value.on ? '关闭记忆' : '打开记忆'}>
                    <input type="checkbox" role="switch" aria-label="使用记忆" checked={value.on} onChange={event => setValue(current => ({ ...current, on: event.target.checked }))} /><span />
                </label>
            </header>
            {value.on
                ? <div className="ai-mind-body">
                    <textarea className="ai-memory" value={value.text} maxLength={MEMORY_LIMIT} rows={5} autoFocus={!value.text}
                        placeholder={'一行一件，比如：\n通信工程专业，在准备考研\n喜欢早上学习'} onChange={event => setValue(current => ({ ...current, text: event.target.value }))} />
                    <div className="ai-mind-foot"><span>{count ? `记着 ${count} 件事` : '聊天时说“记住……”，AI 也会写进来'}</span>{value.text.length > MEMORY_LIMIT * 0.8 && <span>{value.text.length} / {MEMORY_LIMIT}</span>}</div>
                </div>
                : <div className="ai-mind-off">记忆已关闭，AI 看不到这些内容，也不再记新的。{count > 0 && `记着的 ${count} 件事还在，打开就接着用。`}</div>}
            <p className="ai-mind-note">{isProject ? '保存在当前项目。开启记忆后，提问时会发送给所选模型。' : '未登录时保存在本机，登录后记忆随账号同步。开启记忆后，提问时会发送给所选模型。'}</p>
            <div className="ai-modal-btns">
                {value.on && value.text && <button type="button" className="ai-link danger" onClick={() => setValue(current => ({ ...current, text: '' }))}>全部清空</button>}
                <span />
                <button type="button" className="ai-pill" onClick={onClose}>取消</button>
                <button className="ai-pill go">保存</button>
            </div>
        </form>
    </div>;
}

/** The tasks one turn drafted, in one card: each to tick, then added together. */
function Drafts({ drafts, today, onAdd, onDrop }: { drafts: Proposal[]; today: string; onAdd: (keys: string[]) => void; onDrop: (key: string) => void }) {
    const open = drafts.filter(item => !item.saved);
    const [picked, setPicked] = useState<string[]>(() => open.map(item => item.key));
    useEffect(() => setPicked(current => [...new Set([...current, ...open.filter(item => !current.includes(item.key)).map(item => item.key)])]), [drafts.length]);
    const chosen = open.filter(item => picked.includes(item.key));
    return <div className="ai-drafts">
        <h3>{open.length ? `起草了 ${drafts.length} 个任务` : `任务已添加 · ${drafts.length} 个任务`}</h3>
        {drafts.map(item => <label key={item.key} className={`ai-draft ${item.saved ? 'saved' : ''}`}>
            {item.saved ? <span className="tcheck on" /> : <input type="checkbox" checked={picked.includes(item.key)} onChange={event => setPicked(current => event.target.checked ? [...current, item.key] : current.filter(key => key !== item.key))} />}
            <span className="ai-draft-main"><b>{item.id ? '改成 · ' : ''}{item.task.title}</b>
                <small>{[item.task.date ? `${dayWord(item.task.date, today)} ${hm(item.task.start!)}${item.task.end !== undefined ? `–${hm(item.task.end)}` : ''}` : '',
                    item.task.due ? `${dayWord(item.task.due.date, today)}${item.task.due.time !== undefined ? ` ${hm(item.task.due.time)}` : ''} 截止` : ''].filter(Boolean).join(' · ')}</small></span>
            {!item.saved && <button type="button" className="tskip" aria-label="不要这个" onClick={() => onDrop(item.key)}>×</button>}
        </label>)}
        {open.length > 0 && <div className="btns"><button className="btn go" disabled={!chosen.length} onClick={() => onAdd(chosen.map(item => item.key))}>{chosen.length === open.length ? '添加全部任务' : `添加 ${chosen.length} 个任务`}</button></div>}
    </div>;
}
