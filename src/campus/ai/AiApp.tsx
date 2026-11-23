// AI, the fourth entry beside the timetable, the map and search: one conversation over the same tools as the other
// three, run on this device. The answer is shown as it comes; what was looked up is shown as steps one can open;
// rooms and routes it finds are things to tap; a task it drafts is saved only when confirmed. A question can be
// changed where it stands and an answer asked again: each grows a branch beside the old one (thread.ts), and one goes
// back and forth between them. Conversations are kept on this device and listed at the side (chats.ts), and so is what it
// keeps in mind about the person (memory.ts). It is told the moment and campus context (assistant.mjs). The model is the
// free quota, one's own key, or an owner-authorized Local Runtime model source (model.ts).
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { suggestions } from '@/world/assistant.json';
import tokens from '../../../design/tokens.json';
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
import { askRuntime, closeRuntimeChat, runtimeModels, runtimeRequest, type RuntimeRequest } from './runtime';
import { FREE_MODEL, MODEL_SETTINGS_CHANGED, RUNTIME_DISABLED, RUNTIME_PROVIDER, freeProvider, freeService, readModelSettings, selectedProvider, visibleModelProviders, writeModelSettings, type ModelSelection, type ModelSettings } from './model';
import { FreeServiceAvatar } from './FreeServiceAvatar';
import { append, chain, choose, conversationId, emptyThread, lineage, path, siblings, tip, type Node, type Thread } from './thread';
import { chatGroups, titleOf, type Saved } from './chats';
import { stepsLine, stepsOf } from './steps';
import { reachOf, invokeBrowserTool, listBrowserTools, needsToolConfirmation, readToolPreferences, toolCatalog, toolHistory, toolPermissionModes, TOOL_SETTINGS_CHANGED, writeToolPreferences, type BrowserTool, type LocalRuntimeSnapshot, type PermissionMode, type ToolItem } from './toolCatalog';
import ToolSettings from './ToolSettings';
import ModelSettingsPanel from './ModelSettings';
import { activeRemoteTools, invokeRemoteTool, REMOTE_MCP_CHANGED, type RemoteTool } from './remoteMcp';
import ProjectSettings from './ProjectSettings';
import { projectInstructions, foldPersonalInstructions } from './instructions';
import { dropFolder, folderAvailable, newProjectFolder, openWorkspace, pickFolder, readProjects, renameWorkspace, saveFolder, saveProjectChat, saveProjects, savedFolder, workspaceRevisions, writeProjectInstructions, writeProjectMemory, type ChatRevision, type Folder, type Project, type Workspace } from './projects';
import { routeDuration } from '@/world/routes';
import { MEMORY_LIMIT, readMemory, remembered, writeMemory, type Memory } from './memory';
import { Doc, DocStream, docReady, DocText, type Update } from '@/world/doc';
import '../campus.css';

const KEY = 'studev_ai_chats';
const OPEN_PROJECT = 'studev_ai_open_project';

type Proposal = TaskProposal & { key: string; call: string; saved?: boolean };
interface Chat { id: string; thread: Thread; proposals: Proposal[]; forks: string[]; runtimeModels: string[]; model?: ModelSelection; resetRuntime?: boolean }
/** Every conversation kept, and the one open (none: a new one, kept once something is asked in it). */
interface Kept { chats: Saved<Proposal>[]; current: string | null }
interface ProjectView { id: string; chat?: string; revision?: string }
type Approval = { label: string; detail: string; finish: (allow: boolean) => void };
type Waiting = { text: string; preferred?: string[] };
type Failure = { request: RuntimeRequest; firstId?: string; model: ModelSelection };
type Reply = {
    controller: AbortController; from: string; fresh: Set<string>;
    chat: Chat; said: string; live: Update | null; stage: string;
    approval?: Approval; project?: string; bound: boolean; tip: string;
};
type Conversation = { draft: string; error: string; reply?: Reply; failure?: Failure; waiting?: Waiting };
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
const sameModel = (a: ModelSelection | undefined, b: ModelSelection) => a?.provider === b.provider && a.model === b.model;
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

type ResourceLink = { href: string; title: string; detail: string; kind: 'map' | 'knowledge' };

/** The links a result offers when the reader wants to act on the answer. */
function resourceLinks({ name, result }: { name: string; result: unknown }): ResourceLink[] {
    const value = result as Record<string, unknown> | null;
    if (!value || typeof value !== 'object') return [];
    const place = (id: string, title: string, detail: string): ResourceLink => ({ href: `/map/?place=${encodeURIComponent(id)}`, title, detail, kind: 'map' });
    if (name === 'free_rooms' && Array.isArray(value.rooms)) return (value.rooms as { room: string; until: number }[]).slice(0, 6)
        .map(room => place(room.room, roomLabel(room.room), `空到 ${hm(room.until)}`));
    if (name === 'route' && typeof value.url === 'string') return [{ href: value.url, kind: 'map',
        title: `${value.scope === 'within-building' ? '查看' : '导航到'}${String(value.to)}`,
        detail: value.scope === 'within-building' ? `同在${String(value.building)}${value.to_floor ? ` · ${String(value.to_floor)} 层` : ''}`
            : `${String(value.distance_m)} 米 · ${routeDuration(Number(value.duration_s))}` }];
    if (name === 'read' && typeof value.url === 'string') return [{ href: value.url, kind: 'knowledge', title: String(value.title), detail: [value.source, value.date].filter(Boolean).join(' · ') }];
    if (name === 'nearby' && Array.isArray(value.places)) return (value.places as { id: string; name: string; metres: number; now?: string }[]).slice(0, 4)
        .map(item => place(item.id, item.name, [`${item.metres} 米`, item.now].filter(Boolean).join(' · ')));
    if (name === 'find_place' && Array.isArray(result)) return (result as { id: string; name: string; where: string; now?: string }[]).slice(0, 3)
        .map(item => place(item.id, item.name, [item.where, item.now].filter(Boolean).join(' · ')));
    return [];
}

function Resources({ links }: { links: ResourceLink[] }) {
    const rows = links.map(item => {
        const external = !item.href.startsWith('/');
        return <a key={item.href} className="ai-resource" href={item.href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined} title={item.title}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={tokens.glyph[item.kind]} /></svg>
            <span className="ai-resource-copy"><span>{item.title}</span>{item.detail && <small>{item.detail}</small>}</span>
            {external ? <span aria-hidden="true">↗</span> : <Chevron />}
        </a>;
    });
    if (rows.length === 1) return <div className="ai-resources">{rows}</div>;
    const label = links.every(item => item.kind === 'knowledge') ? '参考资料' : links.every(item => item.kind === 'map') ? '校园地点' : '相关资料与地点';
    return <details className="ai-resources"><summary><Chevron /><span>{label}</span><small>{links.length} 项</small></summary>{rows}</details>;
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

/** One picture per permission level: looking over each step, a lock on what is kept, a shield that lets things run. */
const PERMISSION_ICONS: Record<string, ReactNode> = {
    review: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></svg>,
    read: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></svg>,
    approved: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 19 6v5.5c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6Z" /></svg>,
};

function ToolPermission({ mode, disabled, change, manage }: { mode: PermissionMode; disabled: boolean; change: (mode: PermissionMode) => void; manage: () => void }) {
    const [open, setOpen] = useState(false);
    const current = toolPermissionModes.find(item => item.id === mode);
    return <div className="ai-tool-permission" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
        onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); event.currentTarget.querySelector('button')?.focus(); } }}>
        <button type="button" className="ai-tool-trigger" aria-label={`工具权限，${current?.label}`} title="输入 / 查找工具" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>{current && PERMISSION_ICONS[current.id]}工具 · {current?.label} <Chevron /></button>
        {open && <div className="ai-menu ai-permission-menu" role="group" aria-label="工具权限">
            {toolPermissionModes.map(item => <button type="button" aria-pressed={item.id === mode} key={item.id} onClick={() => { change(item.id); setOpen(false); }}>
                <span className="ai-permission-icon">{PERMISSION_ICONS[item.id]}</span><span className="ai-permission-copy"><b>{item.label}</b><small>{item.description}</small></span>{item.id === mode && <Tick />}
            </button>)}
            <p className="ai-permission-note">读取：查资料、看网页和文件。写入：记下记忆、添加任务、替你操作。</p>
            <button type="button" onClick={() => { setOpen(false); manage(); }}>管理工具</button>
        </div>}
    </div>;
}

/** The box one writes in: grows with what is written, sends on Enter, stops while answering. */
/** The tools a question names, as `/工具名` anywhere in it, in the order they first appear. */
export function mentionedTools(text: string, tools: ToolItem[]): string[] {
    const found: { at: number; name: string }[] = [];
    for (const tool of [...tools].sort((a, b) => b.label.length - a.label.length)) {
        const at = text.indexOf(`/${tool.label}`);
        if (at >= 0 && !found.some(item => item.name === tool.definition.function.name)) found.push({ at, name: tool.definition.function.name });
    }
    return found.sort((a, b) => a.at - b.at).map(item => item.name);
}

/** The question with each named tool marked, drawn under the text box so the mentions read as part of the sentence. */
function Mentions({ text, tools }: { text: string; tools: ToolItem[] }) {
    const labels = tools.map(tool => tool.label).sort((a, b) => b.length - a.length);
    const parts: ReactNode[] = [];
    let rest = text, key = 0;
    while (rest) {
        let hit = -1, label = '';
        for (const candidate of labels) { const at = rest.indexOf(`/${candidate}`); if (at >= 0 && (hit < 0 || at < hit)) { hit = at; label = candidate; } }
        if (hit < 0) { parts.push(rest); break; }
        if (hit) parts.push(rest.slice(0, hit));
        parts.push(<mark key={key++}>/{label}</mark>);
        rest = rest.slice(hit + label.length + 1);
    }
    return <div className="ai-compose-mirror" aria-hidden="true">{parts}{'\u200b'}</div>;
}

/** The box one writes in: grows with what is written, sends on Enter, stops while answering. Typing `/` at the start or
 * after a space looks up a tool; the chosen one goes into the sentence as `/工具名`, as many as the question needs. */
function Composer({ input, value, onChange, onSend, onStop, busy, canSend, unavailable, picker, permission, tools }: { input: RefObject<HTMLTextAreaElement | null>; value: string; onChange: (text: string) => void; onSend: (text: string, preferred: string[]) => void; onStop: () => void; busy: boolean; canSend: boolean; unavailable?: string; picker: ReactNode; permission: ReactNode; tools: ToolItem[] }) {
    const [active, setActive] = useState(0), [caret, setCaret] = useState(0), [dismissed, setDismissed] = useState(-1);
    const id = useId(), menu = useRef<HTMLDivElement>(null);
    // The `/word` being typed right before the caret, if any.
    const typed = /(?:^|\s)\/([^\s/]*)$/.exec(value.slice(0, caret));
    const slash = typed ? caret - typed[1]!.length - 1 : -1;
    const query = typed?.[1];
    const matching = tools.filter(tool => !query || `${tool.label} ${tool.group}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    const showing = query !== undefined && slash !== dismissed && matching.length > 0, at = Math.min(active, matching.length - 1);
    const question = value.trim();
    useEffect(() => { if (showing) menu.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' }); }, [showing, at]);
    function select(tool: ToolItem) {
        const insert = `/${tool.label} `;
        const next = value.slice(0, slash) + insert + value.slice(caret);
        onChange(next); setActive(0);
        const place = slash + insert.length;
        requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(place, place); setCaret(place); });
    }
    function submit() {
        if (showing) { if (at >= 0) select(matching[at]!); return; }
        if (canSend && !busy && question) onSend(question, mentionedTools(question, tools));
    }
    const track = (event: { currentTarget: HTMLTextAreaElement }) => setCaret(event.currentTarget.selectionStart);
    return <form className="ai-compose" onSubmit={event => { event.preventDefault(); submit(); }} onBlur={event => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setDismissed(slash);
    }}>
        {unavailable && <p id={`${id}-status`} role="status" className="fine ai-model-status">{unavailable}</p>}
        <div className="ai-compose-field">
        <Mentions text={value} tools={tools} />
        <textarea ref={input} aria-label="问点什么" aria-describedby={unavailable ? `${id}-status` : undefined} aria-controls={showing ? id : undefined} aria-activedescendant={showing && at >= 0 ? `${id}-${at}` : undefined} value={value} maxLength={4000} rows={1} placeholder="问点什么"
            onChange={event => { setActive(0); setDismissed(-1); onChange(event.target.value); track(event); }} onSelect={track} onClick={track}
            onScroll={event => { const mirror = event.currentTarget.previousElementSibling as HTMLElement | null; if (mirror) mirror.scrollTop = event.currentTarget.scrollTop; }}
            onKeyDown={event => {
                if (event.nativeEvent.isComposing) return;
                if (showing && event.key === 'Escape') { event.preventDefault(); setDismissed(slash); }
                else if (showing && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                    event.preventDefault(); setActive((at + (event.key === 'ArrowDown' ? 1 : matching.length - 1)) % matching.length);
                } else if ((event.key === 'Enter' && !event.shiftKey && (!busy || showing)) || (showing && event.key === 'Tab')) { event.preventDefault(); submit(); }
            }} />
        </div>
        <div className="ai-tool-control">
            {permission}
        </div>
        {showing && <div className="ai-menu ai-tool-menu" id={id} ref={menu} role="menu" aria-label="可用工具">
            {[...new Set(matching.map(tool => tool.group))].map(group => <div role="group" aria-label={group} key={group}>
                <p className="fine">{group}</p>
                {matching.map((tool, index) => tool.group === group && <button type="button" role="menuitem" id={`${id}-${index}`} aria-current={index === at ? 'true' : undefined} key={tool.definition.function.name} onClick={() => select(tool)}>{tool.label}</button>)}
            </div>)}
        </div>}
        {picker}
        {busy ? <button type="button" className="ai-send" aria-label="停止" onClick={onStop}><Square /></button>
            : <button className="ai-send" aria-label="发送" disabled={!canSend || !question}><Up /></button>}
    </form>;
}

function ModelPicker({ settings, choice, disabled, answering, runtimeOff, select, manage }: { settings: ModelSettings; choice: ModelSelection; disabled: boolean; answering: boolean; runtimeOff: boolean; select: (model: ModelSelection) => void; manage: () => void }) {
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
            <span>{title}</span><Chevron />
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
            {answering && <p className="fine ai-model-empty">正在回答的这一轮用原来的模型答完，新选的从下一个问题开始。</p>}
            <button type="button" className="ai-model-manage" onClick={() => { close(false); manage(); }}>添加或管理模型…</button>
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
    const keptNow = useRef(kept); keptNow.current = kept;
    const [chat, setChat] = useState<Chat>(() => { const saved = kept.chats.find(item => item.id === kept.current); return saved ? opened(saved) : empty(); });
    const [projects, setProjects] = useState(readProjects);
    const restore = useRef(rememberedProject());
    const [projectId, setProjectId] = useState(() => kept.chats.find(item => item.id === kept.current)?.project);
    const [sideView, setSideView] = useState<'chats' | 'projects' | 'project'>(() => projectId || restore.current ? 'project' : 'chats');
    const [listMenu, setListMenu] = useState(false);
    const [workspace, setWorkspace] = useState<Workspace<Proposal>>();
    const [projectSettings, setProjectSettings] = useState(false);
    const [pendingProject, setPendingProject] = useState<{ project: Project; folder: Folder; view?: ProjectView }>();
    const [newProject, setNewProject] = useState<string | null>(null);
    const [moving, setMoving] = useState<string[]>([]);
    const [multi, setMulti] = useState<string[] | null>(null);
    const [search, setSearch] = useState('');
    const [archived, setArchived] = useState(false);
    const [folded, setFolded] = useState<{ projects?: boolean; pinned?: boolean }>({});
    const [allProjects, setAllProjects] = useState(false);
    const [expanded, setExpanded] = useState<string[]>([]);
    const [dropping, setDropping] = useState<string | null>(null);
    const [projectMenu, setProjectMenu] = useState<string | null>(null), [renamingProject, setRenamingProject] = useState<string | null>(null);
    const [projectError, setProjectError] = useState('');
    const [savingProject, setSavingProject] = useState(Boolean(restore.current));
    const [skill, setSkill] = useState<{ name: string; text: string }>();
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
    useEffect(foldPersonalInstructions, []);
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
    const [runtimeStatus, setRuntimeStatus] = useState<LocalRuntimeSnapshot>({ state: 'unknown', models: [], granted: [] });
    const runtimeStatusRef = useRef(runtimeStatus); runtimeStatusRef.current = runtimeStatus;
    const [remoteTools, setRemoteTools] = useState<RemoteTool[]>([]);
    const [utility, setUtility] = useState<'tools' | 'models'>();
    const canUseBrowser = Boolean(own || runtime);
    useEffect(() => {
        const refresh = () => setTools(readToolPreferences());
        window.addEventListener(TOOL_SETTINGS_CHANGED, refresh); window.addEventListener('storage', refresh);
        return () => { window.removeEventListener(TOOL_SETTINGS_CHANGED, refresh); window.removeEventListener('storage', refresh); };
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        void Promise.all([listBrowserTools(controller.signal), runtimeModels(controller.signal).catch(() => [])]).then(([tools, models]) => {
            if (controller.signal.aborted) return;
            setRuntimeStatus({ state: 'ready', models: models.map(model => model.name), granted: tools });
            setBrowserTools(canUseBrowser && toolPreferences.runtime ? tools : []);
        }, () => {
            if (controller.signal.aborted) return;
            setRuntimeStatus({ state: 'offline', models: [], granted: [] });
            setBrowserTools([]);
        });
        return () => controller.abort();
    }, [canUseBrowser, toolPreferences, utility]);
    useEffect(() => {
        let loading: AbortController | undefined;
        function refresh() {
            loading?.abort();
            const controller = new AbortController(); loading = controller;
            setRemoteTools([]);
            void activeRemoteTools(AbortSignal.any([controller.signal, AbortSignal.timeout(8000)])).then(tools => {
                if (!controller.signal.aborted) setRemoteTools(tools);
            });
        }
        refresh();
        window.addEventListener(REMOTE_MCP_CHANGED, refresh);
        return () => { loading?.abort(); window.removeEventListener(REMOTE_MCP_CHANGED, refresh); };
    }, []);
    // Opening a conversation shows it as it was; only what is said in it moves it to the top of the list.
    const opening = useRef(true);
    const conversations = useRef(new Map<string, Conversation>());
    const [, redraw] = useState(0);
    function viewOf(id: string) {
        let view = conversations.current.get(id);
        if (!view) { view = { draft: '', error: '' }; conversations.current.set(id, view); }
        return view;
    }
    const view = viewOf(chat.id), reply = view.reply;
    const busy = Boolean(reply), draft = view.draft, error = view.error;
    function setDraft(next: string | ((draft: string) => string)) {
        view.draft = typeof next === 'function' ? next(view.draft) : next;
        redraw(value => value + 1);
    }
    function setError(next: string) { view.error = next; redraw(value => value + 1); }
    const running = [...conversations.current.values()].some(item => item.reply);
    const wasBusy = useRef(false);
    useEffect(() => {
        const root = document.documentElement;
        document.getElementById('ai-host')?.toggleAttribute('data-ai-busy', running);
        root.toggleAttribute('data-ai-busy', running);
        if (wasBusy.current && !running && !root.hasAttribute('data-ai-open')) root.setAttribute('data-ai-done', '');
        wasBusy.current = running;
    }, [running]);
    useEffect(() => {
        if (!modelSettings.runtimeEnabled)
            for (const item of conversations.current.values())
                if (item.reply?.chat.model?.provider === RUNTIME_PROVIDER) item.reply.controller.abort();
    }, [modelSettings.runtimeEnabled]);
    const waiting = view.waiting;
    const [editing, setEditing] = useState<string | null>(null), [below, setBelow] = useState(false);
    const [drawn, setDrawn] = useState(false);
    // Flush partial replies for every open request when the document goes away.
    useEffect(() => {
        const keep = () => {
            try {
                const all = readKept();
                const chats = all.chats.map(item => {
                    const now = conversations.current.get(item.id)?.reply;
                    if (!now || now.bound || !now.said.trim()) return item;
                    const thread = append(now.chat.thread, now.tip, newId(), { role: 'assistant', content: now.said });
                    return { ...item, thread, updated: Date.now() };
                });
                localStorage.setItem(KEY, JSON.stringify({ ...all, chats }));
            } catch { /* Storage unavailable. */ }
        };
        window.addEventListener('pagehide', keep);
        return () => window.removeEventListener('pagehide', keep);
    }, []);
    useEffect(() => { void docReady().then(() => setDrawn(true)); }, []);
    const recorded = useRef(new WeakSet<Chat>());
    const end = useRef<HTMLDivElement>(null), scroller = useRef<HTMLDivElement>(null), stuck = useRef(true);
    const composeInput = useRef<HTMLTextAreaElement>(null);
    const services = useMemo(() => new CampusTools(), []);
    useEffect(() => () => services.dispose(), [services]);
    const latest = useRef(loaded?.line); latest.current = loaded?.line;
    const latestTerm = useRef(term); latestTerm.current = term;
    useEffect(() => {
        if (opening.current) { opening.current = false; return; }
        if (!chat.thread.nodes.length || recorded.current.has(chat)) return;
        if (workspace) {
            if (diskDirty.current === chat) return;
            diskDirty.current = chat;
            const root = workspace.folder;
            const { id } = chat;
            diskWrite.current = diskWrite.current.then(async () => {
                const base = diskBase.current?.chat.id === id ? diskBase.current : undefined;
                const saved = { ...base?.chat, ...chat, title: base?.chat.title ?? '', updated: Date.now() };
                const name = await saveProjectChat(root, saved, base?.name);
                if (activeChat.current === id) { diskBase.current = { name, chat: saved }; rememberProject(projectId, id, name); }
                setWorkspace(work => work?.folder === root ? { ...work, revisions: [{ name, chat: saved }, ...work.revisions.filter(revision => revision.chat.id !== id)] } : work);
            }).catch(failure => {
                setProjectError(failure instanceof Error ? failure.message : '无法保存这段项目对话。');
            });
            return;
        }
        if (project?.folder) return;
        if (projectId) rememberProject(projectId, chat.id);
        setKept(all => {
            const id = chat.id, before = all.chats.find(item => item.id === id);
            const saved = { ...before, ...chat, project: projectId, title: before?.title ?? '', updated: Date.now() };
            return { chats: [saved, ...all.chats.filter(item => item.id !== id)], current: id };
        });
    }, [chat, workspace, project?.folder, projectId]);
    // One record for every tab: another tab's change is read in, and a write that changes nothing is skipped, so two open
    // tabs never overwrite each other's chats with an older copy.
    useEffect(() => { try { const text = JSON.stringify(kept); if (localStorage.getItem(KEY) !== text) localStorage.setItem(KEY, text); } catch { /* Kept for this page only. */ } }, [kept]);
    useEffect(() => {
        const update = (event: StorageEvent) => {
            if (event.key !== KEY || !event.newValue) return;
            const theirs = readKept();
            // Which chat is open stays each tab's own; only the chats themselves are shared.
            if (JSON.stringify(theirs.chats) !== JSON.stringify(keptNow.current.chats)) setKept(own => ({ chats: theirs.chats, current: own.current }));
        };
        window.addEventListener('storage', update);
        return () => window.removeEventListener('storage', update);
    }, []);
    const open = (id: string | null, inProject = projectId, work: Workspace<Proposal> | null | undefined = workspace, revision?: ChatRevision<Proposal>) => {
        const found = revision?.chat ?? keptNow.current.chats.find(item => item.id === id);
        diskBase.current = revision;
        opening.current = true;
        const live = id === null ? undefined : conversations.current.get(id)?.reply?.chat;
        const next = live ? { ...live, model: found?.model ?? live.model, resetRuntime: found?.resetRuntime ?? live.resetRuntime } : found ? opened(found) : empty();
        const previousId = activeChat.current;
        activeChat.current = next.id;
        const previous = conversations.current.get(previousId);
        if (!chat.thread.nodes.length && previousId !== next.id && !previous?.reply && !previous?.waiting) conversations.current.delete(previousId);
        diskDirty.current = next;
        setChat(next);
        rememberProject(inProject, found?.id, revision?.name);
        setProjectId(inProject); setSideView(inProject ? 'project' : 'chats'); setWorkspace(work ?? undefined); setMulti(null); setSkill(undefined); setListMenu(false);
        setKept(all => ({ ...all, current: found && !work ? found.id : null }));
        setEditing(null); setSide(false); setMenu(null); setBelow(false); stuck.current = true;
    };
    const ordinary = () => { setProjectError(''); open(null, '', null); };
    function showList(view: 'chats' | 'projects') {
        if (view === 'chats' && projectId) { ordinary(); if (side) setSide(true); }
        setSideView(view); setListMenu(false); setArchived(false); setSearch(''); setMulti(null);
    }
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
    async function renameProject(target: Project, title: string) {
        setRenamingProject(null);
        const name = title.trim().slice(0, 60);
        if (!name || name === target.name) return;
        if (target.folder) {
            const root = workspace?.project.id === target.id ? workspace.folder : await savedFolder(target.id);
            if (!root || await root.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('先打开这个项目并授权目录，然后再改名。');
            await renameWorkspace(root, name);
            if (workspace?.project.id === target.id) setWorkspace({ ...workspace, project: { ...workspace.project, name } });
        }
        keepProject({ ...target, name });
    }
    /** A project goes; its chats stay, back among the recent ones. A folder keeps its own files. */
    function removeProject(target: Project) {
        if ([...conversations.current.values()].some(item => item.reply?.project === target.id)) return;
        setProjectMenu(null);
        setProjects(current => { const all = current.filter(item => item.id !== target.id); saveProjects(all); return all; });
        setKept(all => ({ ...all, chats: all.chats.map(item => item.project === target.id ? { ...item, project: undefined } : item) }));
        if (target.folder) void dropFolder(target.id);
        if (projectId === target.id) ordinary();
    }
    /** Recent first until one drags: then the order shown is kept, and projects added later stay on top by time. */
    const orderedProjects = [...projects.filter(item => item.rank === undefined), ...projects.filter(item => item.rank !== undefined).sort((a, b) => a.rank! - b.rank!)];
    function placeProject(dragged: string, before: string) {
        if (dragged === before) return;
        const order = orderedProjects.filter(item => item.id !== dragged);
        const moved = projects.find(item => item.id === dragged);
        if (!moved) return;
        order.splice(order.findIndex(item => item.id === before), 0, moved);
        const ranked = order.map((item, rank) => ({ ...item, rank }));
        setProjects(ranked); saveProjects(ranked);
    }
    function takeOutOfProject(id: string) {
        if (conversations.current.get(id)?.reply) return;
        setKept(all => ({ ...all, chats: all.chats.map(record => record.id === id ? { ...record, project: undefined } : record) }));
        if (id === chat.id && projectId) ordinary();
    }
    async function moveChats(target: Project, chosen: string[] = moving) {
        const ids = new Set(chosen.filter(id => !conversations.current.get(id)?.reply));
        if (!ids.size) return;
        if (target.folder) {
            const root = await savedFolder(target.id);
            if (!root || await root.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('先打开目标项目并授权目录，然后重试。');
            const work = await openWorkspace<Proposal>(root);
            if (work.project.id !== target.id) throw new Error('当前文件夹属于另一个项目。');
            for (const item of keptNow.current.chats.filter(item => ids.has(item.id))) await saveProjectChat(work.folder, { ...item, project: target.id });
        }
        if (ids.has(chat.id)) ordinary();
        setKept(all => ({ current: ids.has(all.current ?? '') ? null : all.current,
            chats: target.folder ? all.chats.filter(item => !ids.has(item.id))
                : all.chats.map(item => ids.has(item.id) ? { ...item, project: target.id } : item) }));
        setMoving([]); setMulti(null);
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
        } else setKept(all => ({ ...all, chats: all.chats.map(record => record.id === item.id ? { ...record, ...update } : record) }));
        setMenu(null);
    }
    const remove = (id: string) => {
        if (conversations.current.get(id)?.reply) return;
        conversations.current.delete(id);
        const removed = kept.chats.find(item => item.id === id);
        setKept(all => ({ chats: all.chats.filter(item => item.id !== id), current: all.current === id ? null : all.current }));
        if (activeChat.current === id) open(null);
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
        view.failure = undefined;
        if (!busy) setError('');
    }
    function answerPosition(): number | undefined {
        const box = scroller.current, anchor = end.current;
        if (!box || !anchor) return;
        return Math.max(0, Math.min(box.scrollHeight - box.clientHeight,
            box.scrollTop + anchor.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom + 12));
    }
    function followAnswer(behavior: ScrollBehavior = 'instant') {
        const top = answerPosition();
        if (top !== undefined) scroller.current?.scrollTo({ top, behavior });
    }
    // Resource rows sit after this target, so neither streaming nor a refresh follows them.
    useEffect(() => {
        const box = scroller.current; if (!box) return;
        const onScroll = () => {
            const top = answerPosition();
            if (top === undefined) return;
            stuck.current = Math.abs(box.scrollTop - top) < 64;
            setBelow(!stuck.current);
        };
        box.addEventListener('scroll', onScroll, { passive: true });
        return () => box.removeEventListener('scroll', onScroll);
    }, []);
    useLayoutEffect(() => { if (stuck.current) followAnswer(); }, [chat, reply?.said, reply?.live, drawn, error, reply?.approval]);

    const execute = async (name: string, raw: unknown, call: string, add: (proposal: Proposal) => void): Promise<unknown> => {
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
            const fact = String(args.fact);
            if (workspace) {
                const current = await openWorkspace<Proposal>(workspace.folder);
                const text = remembered(current.memory ?? '', fact);
                await writeProjectMemory(workspace.folder, current.memory ?? '', text);
                setWorkspace(value => value?.folder === workspace.folder ? { ...value, memory: text } : value);
            } else if (project) {
                setProjects(all => {
                    const changed = all.map(item => item.id === project.id ? { ...item, memory: remembered(item.memory ?? '', fact) } : item);
                    saveProjects(changed);
                    return changed;
                });
            } else {
                memoryNow.current = { ...memoryNow.current, text: remembered(memoryNow.current.text, fact) };
                setMemory(memoryNow.current);
            }
            return { remembered: true };
        }
        if (!line) throw new Error('请先在“我”里选择班级，等待课表读取完成。');
        if (name === 'timeline') return readTimeline(line, String(args.from), String(args.to));
        if (name === 'exams') return readExams(line);
        if (name === 'list_tasks') return readTasks().filter(task => !task.deleted);
        if (name === 'suggest_slots') return schedulingTool(line, args);
        if (name === 'propose_task') {
            const proposal = taskProposal(args, { ...line, tasks: readTasks().filter(task => !task.deleted) }); const key = newTaskId();
            add({ ...proposal, key, call });
            return { state: 'awaiting_user_confirmation', proposal: key, task: proposal.task };
        }
        throw new Error('未知工具。');
    };

    // Only the shared quota waits for sign-in. Switching source never silently sends that pending question elsewhere.
    useEffect(() => {
        if (!free && waiting) { view.waiting = undefined; setDraft(current => current || waiting.text); }
    }, [free, waiting]);
    useEffect(() => {
        if (!waiting || !free) return;
        const back = async () => {
            if (document.visibilityState !== 'visible' || !await session() || activeChat.current !== chat.id || view.waiting !== waiting) return;
            view.waiting = undefined;
            void send(waiting.text, true, tip(chat.thread), waiting.preferred);
        };
        window.addEventListener('focus', back); document.addEventListener('visibilitychange', back);
        return () => { window.removeEventListener('focus', back); document.removeEventListener('visibilitychange', back); };
    });
    /** The moment and campus context, as this device knows them now. */
    const situation = (): Situation => {
        const term = latestTerm.current, today = momentNow().date;
        const note = [project?.course ? `当前课程项目是「${project.name}」。` : '', workspace?.instructions ?? project?.instructions, skill ? `本轮使用技能「${skill.name}」\n${skill.text}` : ''].filter(Boolean).join('\n\n');
        return { week: term ? weekOfDate(term, today) ?? 0 : null, class: prefs.class ?? null, campus: prefs.campus ?? PRODUCT_CONFIG.CAMPUS.id,
            memory: memoryNow.current.on ? scopedMemory.current.text : null, instructions: projectInstructions(note) };
    };
    const availableTools = toolCatalog(situation(), toolPreferences, canUseBrowser ? browserTools : [], remoteTools);
    function approve(reply: Reply, tool: ToolItem, args: unknown): Promise<boolean> {
        const signal = reply.controller.signal;
        if (signal.aborted) return Promise.resolve(false);
        const fact = (args as { fact?: unknown } | null)?.fact;
        const detail = tool.remote ? `将以下参数发送给 ${tool.remote.connection.name}，并把返回的内容交给当前模型。\n${JSON.stringify(args).slice(0, 480)}`
            : tool.browser ? '读取结果会交给当前模型。' : typeof fact === 'string' ? fact : '把一条信息写入你的记忆。';
        return new Promise(resolve => {
            const cancel = () => finish(false);
            const finish = (allow: boolean) => { signal.removeEventListener('abort', cancel); reply.approval = undefined; redraw(value => value + 1); resolve(allow); };
            signal.addEventListener('abort', cancel, { once: true });
            reply.approval = { label: tool.label, detail, finish }; redraw(value => value + 1);
        });
    }
    /** Answering after `at` in `base`: each message said grows the branch from there, and is the one shown. */
    async function run(base: Thread, at: string, options: { fork?: boolean; retry?: boolean; signIn?: Waiting; clearDraft?: boolean } = {}) {
        if (view.reply || activeConflict || unavailableProject) return;
        if (!provider) { setError(runtimeOff ? RUNTIME_DISABLED : '所选模型已停用或移除，请重新选择。'); return; }
        const contextAtSend = situation();
        const preferences = readToolPreferences();
        if (skill) setSkill(undefined);
        const origin = chat.id, location = projectId, work = workspace;
        let revision = diskBase.current?.chat.id === origin ? diskBase.current : undefined;
        const previous = view.failure;
        const matchingModel = sameModel(previous?.model, choice);
        const retried = runtime && options.retry && matchingModel ? previous : undefined;
        const pending = runtime && !options.fork && matchingModel ? previous : undefined;
        let firstId = options.fork ? newId() : pending?.firstId && !base.nodes.some(node => node.id === pending.firstId) ? pending.firstId : undefined;
        const reset = runtime && chat.resetRuntime && !options.fork && !retried;
        const cid = firstId ?? retried?.request.conversation_id ?? (reset ? at : conversationId(base, at, origin, chat.forks));
        const controller = new AbortController();
        const run: Reply = { controller, from: at, fresh: new Set(), said: '', stage: '', live: null, project: location, bound: Boolean(work), tip: at,
            chat: { ...chat, thread: base, model: choice,
                forks: options.fork || reset ? [...chat.forks, cid] : chat.forks, resetRuntime: reset ? false : chat.resetRuntime } };
        view.reply = run;
        view.error = '';
        view.failure = undefined;
        setEditing(null);
        stuck.current = true;
        redraw(value => value + 1);
        const turn = lineage(base, at);
        const preferred = turn.findLast(node => node.message.role === 'user')?.preferredTools ?? [];
        let history = turn.map(node => node.message);
        function record() {
            const next = run.chat;
            if (activeChat.current === origin) setChat(active => {
                if (active.id !== origin) return active;
                const changed = { ...next, model: active.model ?? next.model, resetRuntime: active.model && !sameModel(active.model, choice) ? active.resetRuntime : next.resetRuntime };
                recorded.current.add(changed);
                return changed;
            });
            if (!work) {
                if (activeChat.current === origin && location) rememberProject(location, origin);
                setKept(all => {
                    const before = all.chats.find(item => item.id === origin);
                    const saved = { ...before, ...next, model: before?.model ?? next.model,
                        resetRuntime: before?.model && !sameModel(before.model, choice) ? before.resetRuntime : next.resetRuntime,
                        project: location, title: before?.title ?? '', updated: Date.now() };
                    return { chats: [saved, ...all.chats.filter(item => item.id !== origin)],
                        current: activeChat.current === origin ? origin : all.current };
                });
                return Promise.resolve();
            }
            const write = diskWrite.current.then(async () => {
                const edited = activeChat.current === origin && diskBase.current?.chat.id === origin ? diskBase.current : revision;
                const model = edited?.chat.model;
                const saved = { ...edited?.chat, ...next, model: model ?? next.model,
                    resetRuntime: model && !sameModel(model, choice) ? edited?.chat.resetRuntime : next.resetRuntime,
                    title: edited?.chat.title ?? '', updated: Date.now() };
                const name = await saveProjectChat(work.folder, saved, edited?.name);
                revision = { name, chat: saved };
                if (activeChat.current === origin) { diskBase.current = revision; rememberProject(location, origin, name); }
                setWorkspace(current => current?.project.id === work.project.id ? {
                    ...current, revisions: [{ name, chat: saved }, ...current.revisions.filter(item => item.name !== edited?.name && item.name !== name)],
                } : current);
            });
            diskWrite.current = write.catch(() => {});
            return write;
        }
        async function grow(message: Message) {
            const id = message.role === 'assistant' && firstId ? firstId : newId();
            if (message.role === 'assistant') firstId = undefined;
            run.fresh.add(id);
            run.chat = { ...run.chat, thread: append(run.chat.thread, run.tip, id, message) };
            run.tip = id;
            await record();
        }
        try {
            if (options.signIn && !await session()) {
                if (controller.signal.aborted) return;
                view.waiting = options.signIn;
                if (activeChat.current === origin) window.open(`/login/?next=${encodeURIComponent('/signed-in/')}`, '_blank');
                return;
            }
            controller.signal.throwIfAborted();
            if (options.clearDraft) view.draft = '';
            await record();
            await docReady();
            const probeRuntime = async (): Promise<LocalRuntimeSnapshot> => {
                const needLive = runtimeStatusRef.current.state === 'unknown' || Boolean(canUseBrowser && preferences.runtime);
                if (!needLive) return runtimeStatusRef.current;
                const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(2500)]);
                try {
                    const [tools, models] = await Promise.all([listBrowserTools(signal), runtimeModels(signal).catch(() => [])]);
                    return { state: 'ready', models: models.map(model => model.name), granted: tools };
                } catch {
                    return { state: 'offline', models: [], granted: [] };
                }
            };
            const [runtimeNow, external] = await Promise.all([
                probeRuntime(),
                activeRemoteTools(AbortSignal.any([controller.signal, AbortSignal.timeout(4500)])),
            ]);
            if (controller.signal.aborted) return;
            setRuntimeStatus(runtimeNow);
            const granted = canUseBrowser && preferences.runtime && runtimeNow.state === 'ready' ? runtimeNow.granted : [];
            setBrowserTools(granted);
            setRemoteTools(external);
            const reach = reachOf(runtimeNow, preferences, canUseBrowser, external);
            const catalog = toolCatalog(contextAtSend, preferences, granted, external);
            const modelTools = catalog.map(tool => tool.definition);
            const byName = new Map(catalog.map(tool => [tool.definition.function.name, tool]));
            history = toolHistory(history, new Set(byName.keys()), free);
            if (!runtime) history = recent(history);
            const denied = new Set<string>();
            const missing = preferred.find(name => !byName.has(name));
            if (missing) throw new Error('你在问题里选的工具暂时用不了。可以换一个，或去掉工具再试。');
            if (retried?.request.tools?.some(tool => !byName.has(tool.function.name))) throw new Error('工具授权已变化，请生成新的回答。');
            for (let round = 0; round < ROUNDS; round++) {
                const last = round === ROUNDS - 1;
                controller.signal.throwIfAborted();
                run.said = ''; run.live = null; run.stage = ''; redraw(value => value + 1);
                const doc = new DocStream();
                const onDelta = (piece: string) => { run.said += piece; run.live = doc.push(piece); if (activeChat.current === origin) redraw(value => value + 1); };
                const context = { tools: modelTools.filter(tool => !denied.has(tool.function.name)), external: external.map(tool => tool.definition), preferred: round === 0 ? preferred : undefined, reach };
                const request = runtime ? round === 0 && retried ? retried.request : runtimeRequest(choice.model, history, contextAtSend, last, cid, context) : null;
                if (request) {
                    view.failure = { request, firstId, model: choice };
                    if (!run.chat.runtimeModels.includes(request.model)) run.chat = { ...run.chat, runtimeModels: [...run.chat.runtimeModels, request.model] };
                }
                const answer = await (request ? askRuntime(request, onDelta, controller.signal, Boolean(retried) && round === 0, stage => { run.stage = stage; if (activeChat.current === origin) redraw(value => value + 1); })
                    : own ? askOwn(own, history, contextAtSend, last, onDelta, controller.signal, context) : ask(history, contextAtSend, last, onDelta, controller.signal, context)).finally(() => doc.free());
                view.failure = undefined;
                run.said = ''; run.live = null;
                history = [...history, answer]; await grow(answer);
                if (!answer.tool_calls?.length) return;
                for (const call of answer.tool_calls) {
                    controller.signal.throwIfAborted();
                    const tool = byName.get(call.function.name);
                    let value: unknown;
                    try {
                        if (!tool || readToolPreferences().disabledCampus.includes(call.function.name)) throw new Error('这个工具已停用或不在本轮授权中。');
                        const args = JSON.parse(call.function.arguments);
                        if (denied.has(call.function.name)) throw new Error('本轮已跳过这项工具。');
                        if (needsToolConfirmation(preferences.mode ?? 'read', tool) && !await approve(run, tool, args)) {
                            denied.add(call.function.name); throw new Error('本轮已跳过这项工具。');
                        }
                        if (controller.signal.aborted) return;
                        if (readToolPreferences().disabledCampus.includes(call.function.name)) throw new Error('这个工具已停用。');
                        value = tool.browser ? { tool: tool.label, data: await invokeBrowserTool(tool.browser, args, controller.signal) }
                            : tool.remote ? await invokeRemoteTool(tool.remote, args, controller.signal) : await execute(call.function.name, args, call.id, proposal => { run.chat = { ...run.chat, proposals: [...run.chat.proposals, proposal] }; });
                    } catch (failure) {
                        controller.signal.throwIfAborted();
                        value = { error: failure instanceof Error ? failure.message : '工具执行失败。', ...(tool?.browser || tool?.remote ? { tool: tool.label } : {}), ...(failure instanceof UnknownReference ? { code: failure.code } : {}) };
                    }
                    const result: Message = { role: 'tool', tool_call_id: call.id, content: JSON.stringify(value) };
                    history = [...history, result]; await grow(result);
                }
            }
        } catch (failure) {
            // Stopped: what was said so far stays, as an answer cut short.
            if (controller.signal.aborted) {
                view.failure = undefined;
                if (run.said) {
                    try { await grow({ role: 'assistant', content: run.said }); }
                    catch (error) { view.error = error instanceof Error ? error.message : '无法保存未完成的回答。'; }
                }
                return;
            }
            view.error = failure instanceof Error ? failure.message : 'AI 暂时无法响应。';
        } finally { view.reply = undefined; redraw(value => value + 1); }
    }
    /** A question asked after `parent` (the end of the conversation, or before a question being changed). */
    function send(question: string, signedIn = false, parent = tip(chat.thread), preferred?: string[]) {
        if (unavailableProject || activeConflict || savingProject) return;
        const asked = question.trim();
        if (!asked || view.reply) return;
        if (!provider) { setError(runtimeOff ? RUNTIME_DISABLED : '所选模型已停用或移除，请重新选择。'); return; }
        // The shared quota requires sign-in. Other sources keep their own authorization boundary.
        const clearDraft = parent === tip(chat.thread);
        const id = newId();
        void run(append(chat.thread, parent, id, { role: 'user', content: asked }, preferred), id, {
            fork: !clearDraft, clearDraft, signIn: free && !signedIn ? { text: asked, preferred } : undefined,
        });
    }
    /** The answer to a question asked again, beside the answer it had. */
    const again = (question: string) => { if (!busy) void run(chat.thread, question, { fork: true }); };
    const retry = () => { if (!busy) void run(chat.thread, tip(chat.thread), { retry: true }); };
    const pick = (id: string) => { if (!busy) { setChat(current => ({ ...current, thread: choose(current.thread, id) })); view.failure = undefined; setError(''); } };
    function confirm(key: string) {
        const proposal = chat.proposals.find(item => item.key === key); if (!proposal || proposal.saved) return;
        const current = proposal.id ? readTasks().find(task => task.id === proposal.id && !task.deleted) : undefined;
        if (proposal.id && current?.modified !== proposal.expected) { setError('这个任务已经改过了，请让 AI 重新起草。'); return; }
        saveTask({ ...proposal.task, id: proposal.id ?? newTaskId(), ...(proposal.task.done === 'awaiting-confirmation' ? { done: new Date().toISOString() } : {}) });
        setChat(all => ({ ...all, proposals: all.proposals.map(item => item.key === key ? { ...item, saved: true } : item) }));
    }
    let shown = path(chat.thread);
    const cut = reply ? shown.findIndex(node => node.id === reply.from) : -1;
    if (cut >= 0 && shown[cut + 1] && !reply?.fresh.has(shown[cut + 1]!.id)) shown = shown.slice(0, cut + 1);
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
    const locked = savingProject;
    const whyUnavailable = unavailableProject ? '打开主目录后即可继续聊天。' : activeConflict ? '此对话有两个冲突版本，已保存在项目目录。' : runtimeOff ? RUNTIME_DISABLED : undefined;
    const composer = <Composer key={chat.id} input={composeInput} value={draft} onChange={setDraft} onSend={(question, preferred) => void send(question, false, tip(chat.thread), preferred)} onStop={() => reply?.controller.abort()} busy={busy} canSend={Boolean(provider && !unavailableProject && !activeConflict && !savingProject)} unavailable={whyUnavailable} tools={availableTools}
        permission={<ToolPermission mode={toolPreferences.mode ?? 'read'} disabled={false} change={mode => {
            try { writeToolPreferences({ ...readToolPreferences(), mode }); } catch { setError('工具权限暂时无法保存。'); }
        }} manage={() => setUtility('tools')} />}
        picker={<ModelPicker settings={modelSettings} choice={choice} disabled={false} answering={busy} runtimeOff={runtimeOff} select={setModel} manage={() => setUtility('models')} />} />;
    const current = workspace ? diskBase.current?.chat : kept.chats.find(item => item.id === kept.current);
    const shownChats = (workspace ? workspace.revisions.map(revision => revision.chat) : kept.chats.filter(item => (item.project || undefined) === project?.id))
        .filter(item => Boolean(item.archived) === archived && (!search.trim() || titleOf(item).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
    const counts = new Map<string, number>();
    workspace?.revisions.forEach(revision => counts.set(revision.chat.id, (counts.get(revision.chat.id) ?? 0) + 1));
    function row(item: Saved<Proposal>) {
        const revision = workspace?.revisions.find(entry => entry.chat === item);
        const key = revision?.name ?? item.id;
        const conflicted = (counts.get(item.id) ?? 0) > 1;
        return <div key={key} className={`ai-chat ${item === current ? 'on' : ''} ${menu === key ? 'menu' : ''}`} draggable={!revision && !renaming && !conversations.current.get(item.id)?.reply}
            onDragStart={event => { event.dataTransfer.setData('text/studev-chat', item.id); event.dataTransfer.effectAllowed = 'move'; }}>
            {multi && !workspace && <input type="checkbox" aria-label={`选择${titleOf(item)}`} checked={multi.includes(item.id)} onChange={event => setMulti(event.target.checked ? [...multi, item.id] : multi.filter(id => id !== item.id))} />}
            {renaming === key
                ? <input className="ai-rename" autoFocus defaultValue={titleOf(item)} maxLength={60} onBlur={event => rename(item, event.target.value, revision)}
                    onKeyDown={event => { if (event.key === 'Enter') rename(item, event.currentTarget.value, revision); if (event.key === 'Escape') setRenaming(null); }} />
                : <button className="ai-chat-t" disabled={locked} onClick={() => open(item.id, revision ? projectId : item.project || '', revision ? workspace ?? null : null, revision)} title={titleOf(item)}>{titleOf(item)}{conversations.current.get(item.id)?.reply && <small>{conversations.current.get(item.id)?.reply?.approval ? '等待确认' : '回答中'}</small>}{conflicted && <small>冲突 · {revision?.name.slice(-6)}</small>}</button>}
            {!multi && <button className="ai-chat-more" aria-label="更多" disabled={locked} onClick={() => setMenu(menu === key ? null : key)}><Dots /></button>}
            {menu === key && <div className="ai-menu" role="menu">
                <button role="menuitem" disabled={conflicted || Boolean(revision && conversations.current.get(item.id)?.reply)} onClick={() => { setRenaming(key); setMenu(null); }}>重命名</button>
                <button role="menuitem" disabled={conflicted || Boolean(revision && conversations.current.get(item.id)?.reply)} onClick={() => void projectAction(() => changeChat(item, { pinned: !item.pinned }, revision))}>{item.pinned ? '取消置顶' : '置顶'}</button>
                <button role="menuitem" disabled={conflicted || Boolean(revision && conversations.current.get(item.id)?.reply)} onClick={() => void projectAction(() => changeChat(item, { archived: !item.archived }, revision))}>{item.archived ? '取消归档' : '归档'}</button>
                {!workspace && <button role="menuitem" disabled={Boolean(conversations.current.get(item.id)?.reply)} onClick={() => { setMoving([item.id]); setMenu(null); }}>{item.project ? '移至其他项目' : '移至项目'}</button>}
                {!workspace && item.project && <button role="menuitem" disabled={Boolean(conversations.current.get(item.id)?.reply)} onClick={() => { takeOutOfProject(item.id); setMenu(null); }}>从项目中移除</button>}
                {!workspace && <button role="menuitem" className="danger" disabled={Boolean(conversations.current.get(item.id)?.reply)} onClick={() => remove(item.id)}>删除</button>}
            </div>}
        </div>;
    }
    return <div className={`sd ai campus-entry ${blank ? 'blank' : ''} ${side ? 'side-open' : ''}`}>
        <aside className="ai-side" aria-label="对话与项目">
            <button className="ai-side-new" disabled={locked || unavailableProject} onClick={() => open(null)}><Compose />新对话</button>
            <label className="ai-history-search"><Magnifier /><input type="search" placeholder="搜索对话" aria-label="搜索对话" value={search} onChange={event => setSearch(event.target.value)} /></label>
            <nav className="ai-side-list">
                {(() => {
                    const query = search.trim().toLocaleLowerCase();
                    const shown = (item: Saved<Proposal>) => Boolean(item.archived) === archived && (!query || titleOf(item).toLocaleLowerCase().includes(query));
                    const chatsOf = (item: Project) => item.id === project?.id ? shownChats : kept.chats.filter(record => record.project === item.id && shown(record));
                    const recent = kept.chats.filter(record => !record.project && shown(record));
                    const carrying = (event: React.DragEvent) => event.dataTransfer.types.includes('text/studev-chat') || event.dataTransfer.types.includes('text/studev-project');
                    const onProjectDrop = (event: React.DragEvent, target: Project) => {
                        event.preventDefault(); setDropping(null);
                        const chatId = event.dataTransfer.getData('text/studev-chat'), projectDragged = event.dataTransfer.getData('text/studev-project');
                        if (chatId) void projectAction(() => moveChats(target, [chatId]));
                        else if (projectDragged) placeProject(projectDragged, target.id);
                    };
                    const visible = allProjects ? orderedProjects : orderedProjects.slice(0, 8);
                    return <>
                        <section className="ai-side-group" aria-label="项目">
                            <div className="ai-side-heading"><button type="button" className="ai-fold" aria-expanded={!folded.projects} onClick={() => setFolded(now => ({ ...now, projects: !now.projects }))}>项目<Chevron /></button>
                                <button type="button" className="ai-icon" aria-label="新建项目" title="新建项目" disabled={locked} onClick={() => setNewProject('')}>＋</button></div>
                            {!folded.projects && <>
                                {visible.map(item => {
                                    const open_ = expanded.includes(item.id) || item.id === project?.id || Boolean(query && chatsOf(item).length);
                                    const chats = open_ ? chatsOf(item) : [];
                                    return <div key={item.id} className="ai-project-branch">
                                        <div className={`ai-chat ai-project-row ${projectMenu === item.id ? 'menu' : ''} ${dropping === item.id ? 'drop' : ''} ${item.id === project?.id ? 'current' : ''}`} draggable={renamingProject !== item.id}
                                            onDragStart={event => { event.dataTransfer.setData('text/studev-project', item.id); event.dataTransfer.effectAllowed = 'move'; }}
                                            onDragOver={event => { if (carrying(event)) { event.preventDefault(); setDropping(item.id); } }}
                                            onDragLeave={() => setDropping(now => now === item.id ? null : now)} onDrop={event => onProjectDrop(event, item)}>
                                            {renamingProject === item.id
                                                ? <input className="ai-rename" autoFocus defaultValue={item.name} maxLength={60} onBlur={event => void projectAction(() => renameProject(item, event.target.value))}
                                                    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setRenamingProject(null); }} />
                                                : <button className="ai-chat-t" disabled={locked} title={item.name} aria-expanded={open_} onClick={() => setExpanded(now => now.includes(item.id) ? now.filter(id => id !== item.id) : [...now, item.id])}><FolderGlyph open={open_} />{item.name}</button>}
                                            <button className="ai-chat-more ai-project-new" aria-label={`在${item.name}中新建对话`} title="在此项目中新建对话" disabled={locked} onClick={() => void projectAction(() => chooseProject(item))}><Compose /></button>
                                            <button className="ai-chat-more" aria-label={`${item.name} 的选项`} disabled={locked} onClick={() => setProjectMenu(projectMenu === item.id ? null : item.id)}><Dots /></button>
                                            {projectMenu === item.id && <div className="ai-menu" role="menu">
                                                <button role="menuitem" onClick={() => { setRenamingProject(item.id); setProjectMenu(null); }}>重命名</button>
                                                <button role="menuitem" onClick={() => { setProjectMenu(null); void projectAction(async () => { await chooseProject(item); setProjectSettings(true); }); }}>项目设置</button>
                                                <button role="menuitem" className="danger" onClick={() => removeProject(item)}>删除项目{item.folder ? '（保留文件夹）' : ''}</button>
                                            </div>}
                                        </div>
                                        {open_ && <div className="ai-project-chats">
                                            {item.folder && item.id !== project?.id
                                                ? <button type="button" className="ai-side-more" disabled={locked} onClick={() => void projectAction(() => chooseProject(item))}>打开文件夹，查看对话</button>
                                                : chats.length ? [...chats.filter(record => record.pinned), ...chats.filter(record => !record.pinned)].map(row)
                                                : <p className="ai-side-none">还没有对话，可以把对话拖到这里</p>}
                                        </div>}
                                    </div>;
                                })}
                                {orderedProjects.length > 8 && <button type="button" className="ai-side-more" onClick={() => setAllProjects(!allProjects)}>{allProjects ? '收起' : `展开显示（${orderedProjects.length - 8}）`}</button>}
                                {!projects.length && <button type="button" className="ai-project-link ai-project-start" disabled={locked} onClick={() => setNewProject('')}><FolderGlyph />新建项目</button>}
                            </>}
                        </section>
                        {recent.some(item => item.pinned) && <section className="ai-side-group" aria-label="置顶">
                            <div className="ai-side-heading"><button type="button" className="ai-fold" aria-expanded={!folded.pinned} onClick={() => setFolded(now => ({ ...now, pinned: !now.pinned }))}>置顶<Chevron /></button></div>
                            {!folded.pinned && recent.filter(item => item.pinned).sort((a, b) => b.updated - a.updated).map(row)}
                        </section>}
                        <section className={`ai-side-group ai-history ${dropping === 'recent' ? 'drop' : ''}`} aria-label="最近"
                            onDragOver={event => { if (event.dataTransfer.types.includes('text/studev-chat')) { event.preventDefault(); setDropping('recent'); } }}
                            onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) setDropping(now => now === 'recent' ? null : now); }}
                            onDrop={event => { event.preventDefault(); setDropping(null); const id = event.dataTransfer.getData('text/studev-chat'); if (id) takeOutOfProject(id); }}>
                            <div className="ai-side-heading ai-list-heading"><span className="ai-fold-label">{archived ? '已归档' : '最近'}</span>
                                <button className="ai-icon" type="button" aria-label="对话选项" aria-haspopup="menu" aria-expanded={listMenu} disabled={locked} onClick={() => { setMenu(null); setListMenu(!listMenu); }}><Dots /></button>
                                {listMenu && <div className="ai-menu" role="menu">
                                    <button role="menuitem" onClick={() => { setArchived(!archived); setMulti(null); setListMenu(false); }}>{archived ? '返回最近' : '查看归档'}</button>
                                    {recent.length > 0 && <button role="menuitem" onClick={() => { setMulti(multi ? null : []); setListMenu(false); }}>{multi ? '取消选择' : '多选对话'}</button>}
                                    {workspace && project && <button role="menuitem" onClick={() => { setListMenu(false); void projectAction(() => openBound(project, workspace.folder, { id: project.id, chat: chat.id, revision: diskBase.current?.name })); }}>刷新当前项目</button>}
                                </div>}
                            </div>
                            {multi && <div className="ai-project-controls"><button className="ai-link" onClick={() => setMulti(null)}>取消</button>
                                <button className="ai-link" disabled={locked || !multi.length} onClick={() => setMoving(multi)}>移至项目 · {multi.length}</button></div>}
                            {chatGroups(recent.filter(item => !item.pinned), Date.now()).map(group => <section key={group.name}><h4>{group.name}</h4>{group.chats.map(row)}</section>)}
                            {!recent.length && <p className="ai-side-none">{query ? '没有找到对话' : archived ? '没有归档对话' : '暂无对话'}</p>}
                        </section>
                    </>;
                })()}
            </nav>
            <footer className="ai-side-footer">
                <button type="button" onClick={() => { setMinding(true); setSide(false); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.5h12v15l-6-3.6-6 3.6Z" /></svg>{project ? '项目记忆' : '记忆'}</button>
            </footer>
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
            {!moving.length && courseProjects.length > 0 && <section className="ai-project-starts"><h3>从本学期课程开始</h3><div className="ai-project-chips">
                {courseProjects.map(item => <button key={item.course} type="button" className="ai-chip" disabled={locked} onClick={() => {
                    const next = { ...item, id: newId(), instructions: `以《${item.name}》为当前课程。优先查阅本课程的讲解和资料，给出相关出处。` };
                    keepProject(next); setNewProject(null); enter(next);
                }}>{item.name}</button>)}
            </div></section>}
            {!moving.length && folderAvailable() && <button type="button" className="ai-link ai-project-folder" disabled={locked} onClick={() => { setNewProject(null); void projectAction(selectLocal); }}>打开本地文件夹作为项目…</button>}
        </Sheet>}
        {moving.length > 0 && newProject === null && <Sheet title="移入项目" onClose={() => setMoving([])}>
            {projects.filter(item => item.id !== projectId).map(item => <button type="button" className="kv" key={item.id} disabled={locked} onClick={() => void projectAction(() => moveChats(item))}><span className="v">{item.name}</span><Chevron /></button>)}
            <div className="ai-project-actions"><button className="btn go" disabled={locked} onClick={() => setNewProject('')}>新建项目</button></div>
        </Sheet>}
        {utility && <Sheet title={utility === 'tools' ? '工具' : '模型'} onClose={() => setUtility(undefined)}>
            {utility === 'tools' ? <ToolSettings /> : <ModelSettingsPanel />}
        </Sheet>}
        {minding && <MemorySettings memory={{ on: memory.on, text: scopedMemory.current.text }} isProject={Boolean(project)} onClose={() => setMinding(false)} onSave={next => void projectAction(async () => { await saveScopedMemory(next); setMinding(false); })} />}
        <div className="ai-main">
        <CampusHeader className="ai-bar">
            <button className="ai-icon ai-menu-btn" aria-label="对话列表" onClick={() => setSide(true)}><Bars /></button>
            <span className="ai-title">{blank ? '' : titleOf(current ?? { title: '', thread: chat.thread })}</span>
            {!blank && <button className="ai-icon ai-bar-new" aria-label="新对话" title="新对话" disabled={locked} onClick={() => open(null)}><Compose /></button>}
        </CampusHeader>
        <div className="ai-scroll" ref={scroller}><div className="ai-col">
        {blank && <div className="ai-hello">
            <h1>{project?.name ?? '有什么可以帮你？'}</h1>
            {composer}
            {!waiting && !project && !draft && <div className="ai-examples">{suggestions.map(({ entry, label, prompt }) =>
                <button key={entry} type="button" onClick={() => { setDraft(prompt); composeInput.current?.focus(); }}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d={tokens.glyph[entry as keyof typeof tokens.glyph]} /></svg>{label}
                </button>)}</div>}
            {!project && !prefs.class && <p className="fine">在「我」里选好班级后，即可询问个人课表。</p>}
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
            const links = [...new Map([...found.values()].flatMap(resourceLinks).map(item => [item.href, item])).values()];
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
                {turn.last && reply?.live && <div className="ai-a"><Doc blocks={reply.live.blocks} live /></div>}
                {answering && reply?.approval && <div className="ai-approval">
                    <p><b>允许{reply.approval.label}？</b></p><p className="fine">{reply.approval.detail}</p>
                    <div className="ai-tool-actions"><button type="button" className="btn" onClick={() => reply.approval?.finish(false)}>跳过</button><button type="button" className="btn primary" onClick={() => reply.approval?.finish(true)}>允许本次</button></div>
                </div>}
                {answering && !reply?.live && !reply?.approval && !doing && <p className="ai-think">{reply?.stage || '正在想'}</p>}
                {turn.last && error && !runtimeOff && <p role="alert" className="ai-error">{error}<TextAction refresh onClick={retry}>重试</TextAction></p>}
                {turn.last && <div ref={end} className="ai-answer-end" aria-hidden="true" />}
                {!answering && turn.replies.length > 0 && <div className="ai-tools">
                    {answer && <CopyButton text={answer} />}
                    <button className="ai-icon" aria-label="重新回答" title="重新回答" disabled={busy} onClick={() => again(turn.question.id)}><Again /></button>
                    <Branches thread={chat.thread} id={turn.replies[0]!.id} onChoose={pick} disabled={busy} />
                </div>}
                {!answering && links.length > 0 && <Resources links={links} />}
                {!answering && drafts.length > 0 && <Drafts drafts={drafts} today={today} onAdd={keys => keys.forEach(confirm)} onDrop={key => setChat(all => ({ ...all, proposals: all.proposals.filter(item => item.key !== key) }))} />}
            </section>;
        })}</div>
        {blank && error && !runtimeOff && <p role="alert" className="ai-error">{error}</p>}
        {waiting && <p role="status" className="fine">在新打开的页面登录或注册，回到这里会自动发出：“{waiting.text}”</p>}
        </div></div>
        {below && !blank && <button className="ai-down" aria-label="回到最新回答" onClick={() => { stuck.current = true; followAnswer(); setBelow(false); }}><Down /></button>}
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
                <div><h2>{title}</h2><p>{isProject ? '记下这个项目的约定、结论和进展。' : '你是谁、希望 AI 怎么回答，一行一件。你写的和 AI 记下的都在这里。'}</p></div>
                <label className="ai-toggle" title={value.on ? '关闭记忆' : '打开记忆'}>
                    <input type="checkbox" role="switch" aria-label="使用记忆" checked={value.on} onChange={event => setValue(current => ({ ...current, on: event.target.checked }))} /><span />
                </label>
            </header>
            {value.on
                ? <div className="ai-mind-body">
                    <textarea className="ai-memory" value={value.text} maxLength={MEMORY_LIMIT} rows={5} autoFocus={!value.text}
                        placeholder={'一行一件，比如：\n回答先给结论，尽量简短\n通信工程专业，在准备考研'} onChange={event => setValue(current => ({ ...current, text: event.target.value }))} />
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

const FolderGlyph = ({ open = false }: { open?: boolean }) => <svg className="ai-folder" viewBox="0 0 24 24" aria-hidden="true">{open
    ? <path d="M3.5 17V7a2 2 0 0 1 2-2h4l2 2.2h6a2 2 0 0 1 2 2V10M3.5 17l2.6-6.1a1.5 1.5 0 0 1 1.4-.9h12.4a1 1 0 0 1 .9 1.4L18.4 17a2 2 0 0 1-1.8 1.2H5.4a1.9 1.9 0 0 1-1.9-1.2Z" />
    : <path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />}</svg>;

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
