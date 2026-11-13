// AI, the fourth entry beside the timetable, the map and search: one conversation over the same tools as the other
// three, run on this device. The answer is shown as it comes; what was looked up is shown as steps one can open;
// rooms and routes it finds are things to tap; a task it drafts is saved only when confirmed. A question can be
// changed where it stands and an answer asked again: each grows a branch beside the old one (thread.ts), and one goes
// back and forth between them. Conversations are kept on this device and listed at the side (chats.ts), and so is what it
// keeps in mind about the person (memory.ts). It is told the moment and who is asking (assistant.mjs). The model is the
// free quota, which needs signing in, or one's own key used straight from this device (model.ts).
import { useEffect, useMemo, useRef, useState } from 'react';
import { session, type Session } from '../../platform/client/api';
import { usePreferences } from '@/world/usePreferences';
import { useTasks } from '@/world/useTasks';
import { newTaskId, readTasks, saveTask } from '@/world/tasks';
import { dayWord, hm, momentNow } from '@/world/time';
import { weekOfDate } from '@/world/events';
import { ROUNDS, type Situation } from '@/world/assistant.mjs';
import { useTimeline } from '@/timetable/useTimeline';
import { PRODUCT_CONFIG } from '@/world/product';
import { CampusTools } from '@/world/campusTools';
import { roomLabel } from '@/world/names';
import { Again, Back, Bars, Chevron, Compose, Copy, Down, Dots, Pencil, Square, Tick, Up } from '@/world/ui';
import { definitions, readExams, readTimeline, schedulingTool, taskProposal, toolArguments, type TaskProposal } from '@/world/tools';
import { ask, askOwn, type Message } from './stream';
import { addressError, endpoint, ownName, readChoice, writeChoice, type Choice, type Own } from './model';
import { append, chain, choose, emptyThread, lineage, path, siblings, tip, type Node, type Thread } from './thread';
import { chatGroups, titleOf, type Saved } from './chats';
import { stepsLine, stepsOf } from './steps';
import { MEMORY_LIMIT, readMemory, remembered, writeMemory, type Memory } from './memory';
import { Doc, DocStream, docReady, DocText, type Update } from '@/world/doc';
import '../campus.css';

/** What one can ask, offered while the conversation is empty. */
const AI_EXAMPLES = ['这周有哪些截止和考试？', '今天下午哪里有空教室？', '帮我在下周找三次一小时复习，周五前完成', '从教三到图书馆怎么走？'];
const KEY = 'studev_ai_chats';

interface ModelContext { registerTool(tool: { name: string; description: string; inputSchema: object; execute(args: unknown): Promise<unknown> }): void; unregisterTool(name: string): void }
type Proposal = TaskProposal & { key: string; call: string; saved?: boolean };
interface Chat { thread: Thread; proposals: Proposal[] }
/** Every conversation kept, and the one open (none: a new one, kept once something is asked in it). */
interface Kept { chats: Saved<Proposal>[]; current: string | null }
const newId = () => crypto.randomUUID();
const empty = (): Chat => ({ thread: emptyThread(), proposals: [] });
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
    if (name === 'route' && typeof value.url === 'string') return <div className="ai-cards"><a className="ai-card" href={value.url}><b>导航到{String(value.to)}</b>
        <small>{String(value.distance_m)} 米 · 约 {Math.max(1, Math.round(Number(value.duration_s) / 60))} 分钟</small></a></div>;
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

/** The box one writes in: grows with what is written, sends on Enter, stops while answering. */
function Composer({ value, onChange, onSend, onStop, busy }: { value: string; onChange: (text: string) => void; onSend: () => void; onStop: () => void; busy: boolean }) {
    return <form className="ai-compose" onSubmit={event => { event.preventDefault(); onSend(); }}>
        <textarea aria-label="问点什么" value={value} maxLength={4000} rows={1} placeholder="问点什么" onChange={event => onChange(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); onSend(); } }} />
        {busy ? <button type="button" className="ai-send" aria-label="停止" onClick={onStop}><Square /></button>
            : <button className="ai-send" aria-label="发送" disabled={!value.trim()}><Up /></button>}
    </form>;
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
    const { loaded, error: loadError } = useTimeline(who, prefs, ready, null, tasks);
    const [kept, setKept] = useState<Kept>(readKept);
    const [chat, setChat] = useState<Chat>(() => kept.chats.find(item => item.id === kept.current) ?? empty());
    const [side, setSide] = useState(false), [menu, setMenu] = useState<string | null>(null), [renaming, setRenaming] = useState<string | null>(null);
    const [choice, setChoice] = useState<Choice>(readChoice), [picking, setPicking] = useState(false), [setting, setSetting] = useState(false);
    const [memory, setMemory] = useState<Memory>(readMemory), [minding, setMinding] = useState(false);
    useEffect(() => writeMemory(memory), [memory]);
    const memoryNow = useRef(memory); memoryNow.current = memory;
    // Who is signed in, if anyone: one's own key tells the model their name as the platform would.
    const [account, setAccount] = useState<Session['user'] | null>(null);
    useEffect(() => { void session().then(current => setAccount(current?.user ?? null), () => setAccount(null)); }, []);
    useEffect(() => writeChoice(choice), [choice]);
    const own = choice.use === 'own' && choice.own.key ? choice.own : null;
    // Opening a conversation shows it as it was; only what is said in it moves it to the top of the list.
    const opening = useRef(true);
    const [draft, setDraft] = useState(''), [streaming, setStreaming] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [waiting, setWaiting] = useState<string | null>(null), [editing, setEditing] = useState<string | null>(null), [below, setBelow] = useState(false);
    // While answering after a message, only what this answer says shows after it, not the answer it had before.
    const [from, setFrom] = useState<string | null>(null);
    const fresh = useRef(new Set<string>());
    // The document kernel, loaded once; nothing is shown as raw text while it loads, and an answer waits for it.
    const [drawn, setDrawn] = useState(false);
    const [live, setLive] = useState<Update | null>(null);
    useEffect(() => { void docReady().then(() => setDrawn(true)); }, []);
    const stop = useRef<AbortController | null>(null);
    const end = useRef<HTMLDivElement>(null), scroller = useRef<HTMLDivElement>(null), stuck = useRef(true);
    const services = useMemo(() => new CampusTools(), []);
    useEffect(() => () => services.dispose(), [services]);
    const latest = useRef(loaded?.line); latest.current = loaded?.line;
    useEffect(() => {
        if (opening.current) { opening.current = false; return; }
        if (!chat.thread.nodes.length) return;
        setKept(all => {
            const id = all.current ?? newId(), before = all.chats.find(item => item.id === id);
            const saved = { id, title: before?.title ?? '', updated: Date.now(), thread: chat.thread, proposals: chat.proposals };
            return { chats: [saved, ...all.chats.filter(item => item.id !== id)], current: id };
        });
    }, [chat]);
    useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(kept)); } catch { /* Kept for this page only. */ } }, [kept]);
    const open = (id: string | null) => {
        if (busy) return;
        const found = kept.chats.find(item => item.id === id);
        opening.current = true;
        setChat(found ? { thread: found.thread, proposals: found.proposals } : empty());
        setKept(all => ({ ...all, current: found ? found.id : null }));
        setError(''); setEditing(null); setSide(false); setMenu(null); stuck.current = true;
    };
    const remove = (id: string) => { setKept(all => ({ chats: all.chats.filter(item => item.id !== id), current: all.current === id ? null : all.current })); if (kept.current === id) { opening.current = true; setChat(empty()); } setMenu(null); };
    const rename = (id: string, title: string) => { setKept(all => ({ ...all, chats: all.chats.map(item => item.id === id ? { ...item, title: title.trim().slice(0, 60) } : item) })); setRenaming(null); };
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
        if (name === 'read') return services.read(String(args.id));
        if (name === 'find_place') return services.findPlace(String(args.query));
        if (name === 'nearby') return services.nearby(String(args.near), String(args.what));
        if (name === 'free_rooms') return services.rooms(args);
        if (name === 'route') return services.route(args);
        if (name === 'remember') {
            if (!memoryNow.current.on) throw new Error('记忆已关闭。');
            const text = remembered(memoryNow.current.text, String(args.fact));
            memoryNow.current = { ...memoryNow.current, text }; setMemory(memoryNow.current);
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
    useEffect(() => {
        const context = (navigator as Navigator & { modelContext?: ModelContext }).modelContext;
        if (!context) return;
        for (const tool of definitions) context.registerTool({ name: tool.function.name, description: tool.function.description, inputSchema: tool.function.parameters, execute: args => execute(tool.function.name, args).then(value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] })) });
        return () => definitions.forEach(tool => context.unregisterTool(tool.function.name));
    }, [execute]);

    // Asking is for someone signed in; signing in happens in another tab and the question waits.
    useEffect(() => {
        if (!waiting) return;
        const back = async () => { if (document.visibilityState === 'visible' && await session()) { const question = waiting; setWaiting(null); void send(question, true); } };
        window.addEventListener('focus', back); document.addEventListener('visibilitychange', back);
        return () => { window.removeEventListener('focus', back); document.removeEventListener('visibilitychange', back); };
    });
    /** The moment and who is asking, as this device knows them now. */
    const situation = (): Situation => {
        const line = latest.current, today = momentNow().date;
        return { week: line ? weekOfDate(line.term, today) : null, class: prefs.class ?? null, campus: prefs.campus ?? PRODUCT_CONFIG.CAMPUS.id,
            name: account ? account.realName || account.nickname || null : null, student: account?.studentId || null, memory: memoryNow.current.on ? memoryNow.current.text : null };
    };
    /** Answering after `at` in `base`: each message said grows the branch from there, and is the one shown. */
    async function run(base: Thread, at: string) {
        let thread = base, tipId = at;
        const grow = (message: Message) => { const id = newId(); fresh.current.add(id); thread = append(thread, tipId, id, message); tipId = id; setChat(current => ({ ...current, thread })); };
        fresh.current = new Set(); setFrom(at);
        let history = recent(lineage(thread, at).map(node => node.message));
        setChat(current => ({ ...current, thread })); setBusy(true); setError(''); setEditing(null); stuck.current = true;
        const controller = new AbortController(); stop.current = controller;
        let said = '';
        try {
            await docReady();
            for (let round = 0; round < ROUNDS; round++) {
                const last = round === ROUNDS - 1;
                said = ''; setStreaming(''); setLive(null);
                const doc = new DocStream();
                const onDelta = (piece: string) => { said += piece; setStreaming(said); setLive(doc.push(piece)); };
                const answer = await (own ? askOwn(own, history, situation(), last, onDelta, controller.signal) : ask(history, situation(), last, onDelta, controller.signal)).finally(() => doc.free());
                setStreaming(null); setLive(null);
                history = [...history, answer]; grow(answer);
                if (!answer.tool_calls?.length) return;
                for (const call of answer.tool_calls) {
                    let value: unknown;
                    try { value = await execute(call.function.name, JSON.parse(call.function.arguments), call.id); } catch (failure) { value = { error: failure instanceof Error ? failure.message : '工具执行失败。' }; }
                    const result: Message = { role: 'tool', tool_call_id: call.id, content: JSON.stringify(value) };
                    history = [...history, result]; grow(result);
                }
            }
        } catch (failure) {
            // Stopped: what was said so far stays, as an answer cut short.
            if (controller.signal.aborted) { if (said) grow({ role: 'assistant', content: said }); return; }
            setError(failure instanceof Error ? failure.message : 'AI 暂时无法响应。');
        } finally { setStreaming(null); setLive(null); setBusy(false); setFrom(null); stop.current = null; }
    }
    /** A question asked after `parent` (the end of the conversation, or before a question being changed). */
    async function send(question: string, signedIn = false, parent = tip(chat.thread)) {
        const asked = question.trim();
        if (!asked || busy) return;
        // One's own key needs no sign-in; the free quota is shared, so it is asked when signed in.
        if (!own && !signedIn && !await session()) { setWaiting(asked); window.open(`/login/?next=${encodeURIComponent('/signed-in/')}`, '_blank'); return; }
        if (parent === tip(chat.thread)) setDraft('');
        const id = newId();
        void run(append(chat.thread, parent, id, { role: 'user', content: asked }), id);
    }
    /** The answer to a question asked again, beside the answer it had. */
    const again = (question: string) => { if (!busy) void run(chat.thread, question); };
    const pick = (id: string) => { if (!busy) { setChat(current => ({ ...current, thread: choose(current.thread, id) })); setError(''); } };
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
    const composer = <Composer value={draft} onChange={setDraft} onSend={() => void send(draft)} onStop={() => stop.current?.abort()} busy={busy} />;
    const current = kept.chats.find(item => item.id === kept.current);
    return <div className={`sd ai ${blank ? 'blank' : ''} ${side ? 'side-open' : ''}`}>
        <aside className="ai-side" aria-label="对话">
            <button className="ai-side-new" disabled={busy} onClick={() => open(null)}><Compose />新对话</button>
            <nav className="ai-side-list">{chatGroups(kept.chats, Date.now()).map(group => <section key={group.name}>
                <h4>{group.name}</h4>
                {group.chats.map(item => <div key={item.id} className={`ai-chat ${item.id === kept.current ? 'on' : ''} ${menu === item.id ? 'menu' : ''}`}>
                    {renaming === item.id
                        ? <input className="ai-rename" autoFocus defaultValue={titleOf(item)} maxLength={60} onBlur={event => rename(item.id, event.target.value)}
                            onKeyDown={event => { if (event.key === 'Enter') rename(item.id, (event.target as HTMLInputElement).value); if (event.key === 'Escape') setRenaming(null); }} />
                        : <button className="ai-chat-t" disabled={busy && item.id !== kept.current} onClick={() => open(item.id)} title={titleOf(item)}>{titleOf(item)}</button>}
                    <button className="ai-chat-more" aria-label="更多" onClick={() => setMenu(menu === item.id ? null : item.id)}><Dots /></button>
                    {menu === item.id && <div className="ai-menu" role="menu">
                        <button role="menuitem" onClick={() => { setRenaming(item.id); setMenu(null); }}>重命名</button>
                        <button role="menuitem" className="danger" disabled={busy && item.id === kept.current} onClick={() => remove(item.id)}>删除</button>
                    </div>}
                </div>)}
            </section>)}
            {!kept.chats.length && <p className="ai-side-none">问过的对话会列在这里，只存在这台设备上。</p>}</nav>
            <button className="ai-side-memory" onClick={() => { setMinding(true); setSide(false); }}><b>记忆</b><small>{!memory.on ? '已关闭' : memory.text.trim() ? `记着 ${memory.text.split('\n').filter(line => line.trim()).length} 件事` : '还没有'}</small></button>
        </aside>
        {side && <div className="ai-scrim" onClick={() => setSide(false)} />}
        {picking && <div className="ai-catch" onClick={() => setPicking(false)} />}
        {minding && <MemorySettings memory={memory} onClose={() => setMinding(false)} onSave={next => { memoryNow.current = next; setMemory(next); setMinding(false); }} />}
        {setting && <OwnSettings own={choice.own} onClose={() => setSetting(false)} onSave={next => { setChoice({ use: next.key ? 'own' : 'free', own: next }); setSetting(false); }} />}
        <div className="ai-main">
        <div className="ai-bar">
            <button className="ai-icon ai-menu-btn" aria-label="对话列表" onClick={() => setSide(true)}><Bars /></button>
            <div className="ai-model">
                <button className={`ai-model-b ${picking ? 'on' : ''}`} onClick={() => setPicking(!picking)}>{own ? ownName(own) : '免费额度'}<Chevron /></button>
                {picking && <div className="ai-menu ai-model-menu" role="menu">
                    <button role="menuitemradio" aria-checked={!own} onClick={() => { setChoice(current => ({ ...current, use: 'free' })); setPicking(false); }}>
                        <b>免费额度 · 为爱发电</b><small>登录后可用</small>{!own && <Tick />}</button>
                    <button role="menuitemradio" aria-checked={Boolean(own)} onClick={() => { if (choice.own.key) setChoice(current => ({ ...current, use: 'own' })); else setSetting(true); setPicking(false); }}>
                        <b>我的 API</b><small>{choice.own.key ? `${ownName(choice.own)} · 存在这台设备上` : '填上自己的 Key 就能用'}</small>{own && <Tick />}</button>
                    <button role="menuitem" className="ai-model-set" onClick={() => { setSetting(true); setPicking(false); }}>设置我的 API…</button>
                </div>}
            </div>
            <span className="ai-title">{blank ? '' : titleOf(current ?? { title: '', thread: chat.thread })}</span>
            {!blank && <button className="ai-icon ai-bar-new" aria-label="新对话" title="新对话" disabled={busy} onClick={() => open(null)}><Compose /></button>}
        </div>
        <div className="ai-scroll" ref={scroller}><div className="ai-col">
        {blank && <div className="ai-hello">
            <h1>有什么可以帮你？</h1>
            {composer}
            {!waiting && <div className="ai-examples">{AI_EXAMPLES.map(example => <button key={example} onClick={() => void send(example)}>{example}</button>)}</div>}
            {!prefs.class && <p className="fine">先在“我”里选好班级，AI 才能看到你的课表；搜索和空教室现在就能问。</p>}
            <p className="fine">可以问课表、地图和校园资料：查安排、找空闲、找空教室、问路、读通知。起草的任务你点一下才加进清单；对话和记忆存在这台设备上。</p>
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
                    <ol>{steps.map((step, i) => <li key={i} className={step.failed ? 'failed' : step.pending ? 'doing' : ''}><b>{step.label}</b>{step.detail && <span>{step.detail}</span>}</li>)}</ol>
                </details>}
                {answer && drawn && <div className="ai-a"><DocText text={answer} /></div>}
                {turn.last && live && <div className="ai-a"><Doc blocks={live.blocks} live /></div>}
                {answering && !live && !doing && <p className="ai-think">正在想</p>}
                {found.size > 0 && [...found.values()].map(item => <Found key={item.name} name={item.name} result={item.result} />)}
                {drafts.length > 0 && <Drafts drafts={drafts} today={today} onAdd={keys => keys.forEach(confirm)} onDrop={key => setChat(all => ({ ...all, proposals: all.proposals.filter(item => item.key !== key) }))} />}
                {!answering && turn.replies.length > 0 && <div className="ai-tools">
                    {answer && <CopyButton text={answer} />}
                    <button className="ai-icon" aria-label="重新回答" title="重新回答" disabled={busy} onClick={() => again(turn.question.id)}><Again /></button>
                    <Branches thread={chat.thread} id={turn.replies[0]!.id} onChoose={pick} disabled={busy} />
                </div>}
            </section>;
        })}</div>
        {error && <p role="alert" className="ai-error">{error}{turns.length > 0 && <button className="ai-pill" onClick={() => again(turns.at(-1)!.question.id)}>重试</button>}</p>}
        {waiting && <p role="status" className="fine">在新打开的页面登录或注册，回到这里会自动发出：“{waiting}”</p>}
        <div ref={end} className="ai-end" />
        </div></div>
        {below && !blank && <button className="ai-down" aria-label="回到底部" onClick={() => { stuck.current = true; end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }}><Down /></button>}
        {!blank && <div className="ai-dock">{composer}</div>}
        </div>
    </div>;
}

/** What the AI keeps in mind: to read, change, empty or turn off. */
function MemorySettings({ memory, onClose, onSave }: { memory: Memory; onClose: () => void; onSave: (memory: Memory) => void }) {
    // Shown as plain lines; kept as a list, one `- ` item a line, as the AI reads and writes it.
    const [value, setValue] = useState(() => ({ ...memory, text: memory.text.replace(/^- /gm, '') }));
    const count = value.text.split('\n').filter(line => line.trim()).length;
    const kept = () => value.text.split('\n').map(line => line.trim()).filter(Boolean).map(line => `- ${line}`).join('\n');
    return <div className="ai-modal" role="dialog" aria-label="记忆" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
        <form className="ai-modal-box ai-mind" onSubmit={event => { event.preventDefault(); onSave({ on: value.on, text: kept() }); }}>
            <header className="ai-mind-head">
                <div><h2>记忆</h2><p>AI 记下你的专业、习惯和偏好，回答会越来越贴合你。</p></div>
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
            <p className="ai-mind-note">只存在这台设备上，提问时随问题一起发给模型。</p>
            <div className="ai-modal-btns">
                {value.on && value.text && <button type="button" className="ai-link danger" onClick={() => setValue(current => ({ ...current, text: '' }))}>全部清空</button>}
                <span />
                <button type="button" className="ai-pill" onClick={onClose}>取消</button>
                <button className="ai-pill go">保存</button>
            </div>
        </form>
    </div>;
}

/** One's own provider: where, which model, and the key, kept only on this device. */
function OwnSettings({ own, onClose, onSave }: { own: Own; onClose: () => void; onSave: (own: Own) => void }) {
    const [value, setValue] = useState(own);
    const invalid = addressError(value.base);
    const set = (part: Partial<Own>) => setValue(current => ({ ...current, ...part }));
    return <div className="ai-modal" role="dialog" aria-label="我的 API" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
        <form className="ai-modal-box" onSubmit={event => { event.preventDefault(); onSave({ base: value.base.trim(), model: value.model.trim(), key: value.key.trim() }); }}>
            <h2>我的 API</h2>
            <p className="fine">填一个兼容 OpenAI 接口的模型服务，比如 DeepSeek。Key 存在这台设备上，提问从这里直接发给服务商。</p>
            <label>接口地址<input value={value.base} onChange={event => set({ base: event.target.value })} placeholder="https://api.deepseek.com" required /></label>
            <small className="fine">{invalid ?? `会请求 ${endpoint(value.base)}`}</small>
            <label>模型<input value={value.model} onChange={event => set({ model: event.target.value })} placeholder="deepseek-flash" required /></label>
            <label>API Key<input type="password" value={value.key} onChange={event => set({ key: event.target.value })} placeholder="sk-…" autoComplete="off" /></label>
            <div className="ai-modal-btns">
                {own.key && <button type="button" className="ai-pill" onClick={() => onSave({ ...value, key: '' })}>清除 Key</button>}
                <span />
                <button type="button" className="ai-pill" onClick={onClose}>取消</button>
                <button className="ai-pill go" disabled={!!invalid || !value.key.trim() || !value.model.trim()}>保存并使用</button>
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
        <h3>{open.length ? `起草了 ${drafts.length} 个任务` : `已加到清单 · ${drafts.length} 个任务`}</h3>
        {drafts.map(item => <label key={item.key} className={`ai-draft ${item.saved ? 'saved' : ''}`}>
            {item.saved ? <span className="tcheck on" /> : <input type="checkbox" checked={picked.includes(item.key)} onChange={event => setPicked(current => event.target.checked ? [...current, item.key] : current.filter(key => key !== item.key))} />}
            <span className="ai-draft-main"><b>{item.id ? '改成 · ' : ''}{item.task.title}</b>
                <small>{[item.task.date ? `${dayWord(item.task.date, today)} ${hm(item.task.start!)}${item.task.end !== undefined ? `–${hm(item.task.end)}` : ''}` : '',
                    item.task.due ? `${dayWord(item.task.due.date, today)}${item.task.due.time !== undefined ? ` ${hm(item.task.due.time)}` : ''} 截止` : ''].filter(Boolean).join(' · ')}</small></span>
            {!item.saved && <button type="button" className="tskip" aria-label="不要这个" onClick={() => onDrop(item.key)}>×</button>}
        </label>)}
        {open.length > 0 && <div className="btns"><button className="btn go" disabled={!chosen.length} onClick={() => onAdd(chosen.map(item => item.key))}>{chosen.length === open.length ? '全部加到清单' : `加 ${chosen.length} 个到清单`}</button></div>}
    </div>;
}
