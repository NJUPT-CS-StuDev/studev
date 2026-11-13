// AI, the fourth entry beside the timetable, the map and search: one conversation over the same tools as the other
// three, run on this device. The answer is shown as it comes; what was looked up is shown as steps one can open;
// rooms and routes it finds are things to tap; a task it drafts is saved only when confirmed. A question can be
// changed where it stands and an answer asked again: each grows a branch beside the old one (thread.ts), and one goes
// back and forth between them. The conversation is kept on this device. Asking is for someone signed in, since the
// model is reached through the platform.
import { useEffect, useMemo, useRef, useState } from 'react';
import { session } from '../../platform/client/api';
import { usePreferences } from '@/world/usePreferences';
import { useTasks } from '@/world/useTasks';
import { newTaskId, readTasks, saveTask } from '@/world/tasks';
import { dayWord, hm, momentNow } from '@/world/time';
import { useTimeline } from '@/timetable/useTimeline';
import { CampusTools } from '@/world/campusTools';
import { roomLabel } from '@/world/names';
import { Again, Back, Chevron, Compose, Copy, Down, Pencil, Square, Tick, Up } from '@/world/ui';
import { definitions, readTimeline, schedulingTool, taskProposal, toolArguments, type TaskProposal } from '@/world/tools';
import { ask, type Message } from './stream';
import { append, chain, choose, emptyThread, lineage, path, siblings, tip, type Node, type Thread } from './thread';
import { Doc, DocStream, docReady, DocText, type Update } from '@/world/doc';
import '../campus.css';

/** What one can ask, offered while the conversation is empty. */
const AI_EXAMPLES = ['这周有哪些截止和考试？', '今天下午哪里有空教室？', '帮我在下周找三次一小时复习，周五前完成', '从教三到图书馆怎么走？'];
/** What each tool is doing, as a step says it. */
const STEPS: Record<string, string> = { campus_search: '搜索校园资料', timeline: '查看你的安排', list_tasks: '读取你的任务', suggest_slots: '找空闲时间', free_rooms: '查空教室', route: '规划路线', propose_task: '起草任务' };
const KEY = 'studev_ai_thread';

interface ModelContext { registerTool(tool: { name: string; description: string; inputSchema: object; execute(args: unknown): Promise<unknown> }): void; unregisterTool(name: string): void }
type Proposal = TaskProposal & { key: string; call: string; saved?: boolean };
interface Chat { thread: Thread; proposals: Proposal[] }
const newId = () => crypto.randomUUID();
function readChat(): Chat {
    try {
        const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Chat | null;
        if (raw && Array.isArray(raw.thread?.nodes)) return { thread: raw.thread, proposals: raw.proposals ?? [] };
        // A conversation kept before it could branch becomes one branch.
        const old = JSON.parse(localStorage.getItem('studev_ai_chat') ?? 'null') as { messages?: Message[]; proposals?: Proposal[] } | null;
        localStorage.removeItem('studev_ai_chat');
        if (old && Array.isArray(old.messages)) return { thread: chain(old.messages, old.messages.map(newId)), proposals: old.proposals ?? [] };
    } catch { /* Nothing kept, or kept unreadably: a new conversation. */ }
    return { thread: emptyThread(), proposals: [] };
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
    if (name === 'route' && typeof value.url === 'string') {
        const route = (value.routes as { distance_m: number; duration_s: number }[] | undefined)?.[0];
        return <div className="ai-cards"><a className="ai-card" href={value.url}><b>在地图上导航</b>{route && <small>{Math.round(route.distance_m)} 米 · 约 {Math.max(1, Math.round(route.duration_s / 60))} 分钟</small>}</a></div>;
    }
    if (name === 'campus_search' && Array.isArray(result)) return <div className="ai-cards">{(result as { id: string; title: string; url: string; source?: string }[]).slice(0, 4).map(item =>
        <a key={item.id} className="ai-card" href={item.url} target="_blank" rel="noreferrer"><b>{item.title}</b>{item.source && <small>{item.source}</small>}</a>)}</div>;
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
    const [chat, setChat] = useState<Chat>(readChat);
    const [draft, setDraft] = useState(''), [streaming, setStreaming] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [waiting, setWaiting] = useState<string | null>(null), [editing, setEditing] = useState<string | null>(null), [below, setBelow] = useState(false);
    // While answering after a message, only what this answer says shows after it, not the answer it had before.
    const [from, setFrom] = useState<string | null>(null);
    const fresh = useRef(new Set<string>());
    // The document kernel, loaded once; until then an answer shows as plain text.
    const [drawn, setDrawn] = useState(false);
    const [live, setLive] = useState<Update | null>(null);
    useEffect(() => { void docReady().then(() => setDrawn(true)); }, []);
    const stop = useRef<AbortController | null>(null);
    const end = useRef<HTMLDivElement>(null), scroller = useRef<HTMLDivElement>(null), stuck = useRef(true);
    const services = useMemo(() => new CampusTools(), []);
    useEffect(() => () => services.dispose(), [services]);
    const latest = useRef(loaded?.line); latest.current = loaded?.line;
    useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(chat)); } catch { /* Kept for this page only. */ } }, [chat]);
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
        if (name === 'campus_search') return services.query(String(args.query));
        if (name === 'free_rooms') return services.rooms(args);
        if (name === 'route') return services.route(args);
        if (!line) throw new Error('请先在“我”里选择班级，等待课表读取完成。');
        if (name === 'timeline') return readTimeline(line, String(args.from), String(args.to));
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
            for (let round = 0; round < 8; round++) {
                said = ''; setStreaming(''); setLive(null);
                const doc = drawn ? new DocStream() : null;
                const answer = await ask(history, piece => { said += piece; setStreaming(said); if (doc) setLive(doc.push(piece)); }, controller.signal).finally(() => doc?.free());
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
            setError('这一问查了很多轮，换个更具体的问法试试。');
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
        if (!signedIn && !await session()) { setWaiting(asked); window.open(`/login/?next=${encodeURIComponent('/signed-in/')}`, '_blank'); return; }
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
    const empty = !shown.length;
    const composer = <Composer value={draft} onChange={setDraft} onSend={() => void send(draft)} onStop={() => stop.current?.abort()} busy={busy} />;
    return <div className={`sd ai ${empty ? 'blank' : ''}`}>
        {!empty && <div className="ai-bar"><button className="ai-new" disabled={busy} onClick={() => { setChat({ thread: emptyThread(), proposals: [] }); setError(''); setEditing(null); }}><Compose />新对话</button></div>}
        <div className="ai-scroll" ref={scroller}><div className="ai-col">
        {empty && <div className="ai-hello">
            <h1>有什么可以帮你？</h1>
            {composer}
            {!waiting && <div className="ai-examples">{AI_EXAMPLES.map(example => <button key={example} onClick={() => void send(example)}>{example}</button>)}</div>}
            {!prefs.class && <p className="fine">先在“我”里选好班级，AI 才能看到你的课表；搜索和空教室现在就能问。</p>}
            <p className="fine">问课表、地图和校园资料：查安排、找时间、找空教室、问路；起草的任务经你确认才会加到清单。对话只存在这台设备上，问的内容会发给模型（腾讯云 EdgeOne 提供的 DeepSeek）。</p>
        </div>}
        {loadError && <p role="status" className="fine">课表还没读完：{loadError}</p>}
        <div className="ai-turns" aria-live="polite">{turns.map(turn => {
            const replies = turn.replies.map(node => node.message);
            const calls = replies.flatMap(reply => reply.tool_calls ?? []);
            const answer = [...replies].reverse().find(reply => reply.content && !reply.tool_calls?.length)?.content
                ?? (turn.last && streaming !== null ? null : [...replies].reverse().find(reply => reply.role === 'assistant' && reply.content)?.content);
            const counts = new Map<string, number>(); calls.forEach(call => counts.set(call.function.name, (counts.get(call.function.name) ?? 0) + 1));
            const doing = calls.some(call => !results.has(call.id));
            const found = new Map<string, { name: string; result: unknown }>();
            calls.forEach(call => { const result = results.get(call.id); if (result && !(typeof result === 'object' && 'error' in (result as object))) found.set(call.function.name, { name: call.function.name, result }); });
            const drafts = chat.proposals.filter(item => calls.some(call => call.id === item.call));
            const question = turn.question.message.content ?? '';
            const answering = turn.last && busy;
            return <section key={turn.question.id} className="ai-turn">
                {editing === turn.question.id
                    ? <Editing text={question} onCancel={() => setEditing(null)} onSend={text => void send(text, false, turn.question.parent)} />
                    : <div className="ai-ask"><p className="ai-q">{question}</p>
                        <div className="ai-tools ai-tools-q"><CopyButton text={question} /><button className="ai-icon" aria-label="改问题" title="改问题" disabled={busy} onClick={() => setEditing(turn.question.id)}><Pencil /></button>
                            <Branches thread={chat.thread} id={turn.question.id} onChoose={pick} disabled={busy} /></div></div>}
                {calls.length > 0 && <details className="ai-steps"><summary className={doing ? 'doing' : ''}>{doing ? '正在' : '已'}{[...counts].map(([name, count]) => `${STEPS[name] ?? name}${count > 1 ? ` ×${count}` : ''}`).join(' · ')}</summary>
                    <ol>{replies.filter(reply => reply.role === 'assistant').map((reply, i) => <li key={i}>{reply.content && reply.tool_calls?.length ? <p>{reply.content}</p> : null}
                        {reply.tool_calls?.map(call => { const result = results.get(call.id); const failed = Boolean(result && typeof result === 'object' && 'error' in (result as object));
                            return <div key={call.id} className={failed ? 'failed' : ''}>{STEPS[call.function.name] ?? call.function.name}{result === undefined ? '……' : failed ? `：${(result as { error: string }).error}` : ''}</div>; })}</li>)}</ol>
                </details>}
                {answer && <div className="ai-a">{drawn ? <DocText text={answer} /> : <p className="ai-plain">{answer}</p>}</div>}
                {turn.last && streaming !== null && <div className="ai-a">{live ? <Doc blocks={live.blocks} live /> : <p className="ai-plain">{streaming}<span className="ai-dot" /></p>}</div>}
                {answering && streaming === null && !doing && <p className="ai-think">正在想</p>}
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
        {below && !empty && <button className="ai-down" aria-label="回到底部" onClick={() => { stuck.current = true; end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }}><Down /></button>}
        {!empty && <div className="ai-dock">{composer}</div>}
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
