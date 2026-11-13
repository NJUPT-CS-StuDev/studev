// AI, the fourth entry beside the timetable, the map and search: one conversation over the same tools as the other
// three, run on this device. The answer is shown as it comes; what was looked up is shown as steps one can open;
// rooms and routes it finds are things to tap; a task it drafts is saved only when confirmed. The conversation is kept
// on this device. Asking is for someone signed in, since the model is reached through the platform.
import { useEffect, useMemo, useRef, useState } from 'react';
import { session } from '../../platform/client/api';
import { usePreferences } from '@/world/usePreferences';
import { useTasks } from '@/world/useTasks';
import { newTaskId, readTasks, saveTask } from '@/world/tasks';
import { dayWord, hm, momentNow } from '@/world/time';
import { useTimeline } from '@/timetable/useTimeline';
import { CampusTools } from '@/world/campusTools';
import { roomLabel } from '@/world/names';
import { definitions, readTimeline, schedulingTool, taskProposal, toolArguments, type TaskProposal } from '@/world/tools';
import { ask, type Message } from './stream';
import '../campus.css';

/** What one can ask, offered while the conversation is empty. */
const AI_EXAMPLES = ['这周有哪些截止和考试？', '今天下午哪里有空教室？', '帮我在下周找三次一小时复习，周五前完成', '从教三到图书馆怎么走？'];
/** What each tool is doing, as a step says it. */
const STEPS: Record<string, string> = { campus_search: '搜索校园资料', timeline: '查看你的安排', list_tasks: '读取你的任务', suggest_slots: '找空闲时间', free_rooms: '查空教室', route: '规划路线', propose_task: '起草任务' };
const KEY = 'studev_ai_chat';

interface ModelContext { registerTool(tool: { name: string; description: string; inputSchema: object; execute(args: unknown): Promise<unknown> }): void; unregisterTool(name: string): void }
type Proposal = TaskProposal & { key: string; call: string; saved?: boolean };
interface Chat { messages: Message[]; proposals: Proposal[] }
const readChat = (): Chat => { try { const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return raw && Array.isArray(raw.messages) ? { messages: raw.messages, proposals: raw.proposals ?? [] } : { messages: [], proposals: [] }; } catch { return { messages: [], proposals: [] }; } };
const parse = (text: string | null) => { try { return JSON.parse(text ?? 'null') as unknown; } catch { return null; } };

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

export default function AiApp() {
    const { prefs, ready } = usePreferences(), tasks = useTasks();
    const who = useMemo(() => ({ type: 'me' as const }), []);
    const { loaded, error: loadError } = useTimeline(who, prefs, ready, null, tasks);
    const [chat, setChat] = useState<Chat>(readChat);
    const [draft, setDraft] = useState(''), [streaming, setStreaming] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [waiting, setWaiting] = useState<string | null>(null);
    const stop = useRef<AbortController | null>(null);
    const end = useRef<HTMLDivElement>(null), scroller = useRef<HTMLDivElement>(null), stuck = useRef(true);
    const services = useMemo(() => new CampusTools(), []);
    useEffect(() => () => services.dispose(), [services]);
    const latest = useRef(loaded?.line); latest.current = loaded?.line;
    useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(chat)); } catch { /* Kept for this page only. */ } }, [chat]);
    // The view follows the answer down unless one has scrolled up to read.
    useEffect(() => {
        const box = scroller.current; if (!box) return;
        const onScroll = () => { stuck.current = box.scrollTop + box.clientHeight >= box.scrollHeight - 80; };
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
        const back = async () => { if (document.visibilityState === 'visible' && await session()) { const question = waiting; setWaiting(null); void run([...chat.messages, { role: 'user', content: question }]); } };
        window.addEventListener('focus', back); document.addEventListener('visibilitychange', back);
        return () => { window.removeEventListener('focus', back); document.removeEventListener('visibilitychange', back); };
    });
    async function run(start: Message[]) {
        let history = start;
        // Whole turns are kept: a tool result never stays without the call that made it.
        while (history.length > 24) { const next = history.findIndex((item, i) => i > 0 && item.role === 'user'); if (next < 0) break; history = history.slice(next); }
        setChat(current => ({ ...current, messages: history })); setBusy(true); setError(''); stuck.current = true;
        const controller = new AbortController(); stop.current = controller;
        let said = '';
        try {
            for (let round = 0; round < 8; round++) {
                said = ''; setStreaming('');
                const answer = await ask(history, piece => { said += piece; setStreaming(said); }, controller.signal);
                setStreaming(null);
                history = [...history, answer]; setChat(current => ({ ...current, messages: history }));
                if (!answer.tool_calls?.length) return;
                for (const call of answer.tool_calls) {
                    let value: unknown;
                    try { value = await execute(call.function.name, JSON.parse(call.function.arguments), call.id); } catch (failure) { value = { error: failure instanceof Error ? failure.message : '工具执行失败。' }; }
                    history = [...history, { role: 'tool', tool_call_id: call.id, content: JSON.stringify(value) }];
                }
                setChat(current => ({ ...current, messages: history }));
            }
            setError('这一问查了很多轮，换个更具体的问法试试。');
        } catch (failure) {
            // Stopped: what was said so far stays, as an answer cut short.
            if (controller.signal.aborted) { if (said) setChat(current => ({ ...current, messages: [...history, { role: 'assistant', content: said }] })); return; }
            setError(failure instanceof Error ? failure.message : 'AI 暂时无法响应。');
        } finally { setStreaming(null); setBusy(false); stop.current = null; }
    }
    async function send(question = draft) {
        const asked = question.trim();
        if (!asked || busy) return;
        if (!await session()) { setWaiting(asked); window.open(`/login/?next=${encodeURIComponent('/signed-in/')}`, '_blank'); return; }
        setDraft('');
        void run([...chat.messages, { role: 'user', content: asked }]);
    }
    const lastUser = chat.messages.map(item => item.role).lastIndexOf('user');
    /** Asking the last question again, or changing it: the turn after it is set aside. */
    const again = () => { if (lastUser >= 0 && !busy) void run(chat.messages.slice(0, lastUser + 1)); };
    const edit = () => { if (lastUser < 0 || busy) return; setDraft(chat.messages[lastUser]!.content ?? ''); setChat(current => ({ ...current, messages: current.messages.slice(0, lastUser) })); };
    function confirm(key: string) {
        const proposal = chat.proposals.find(item => item.key === key); if (!proposal || proposal.saved) return;
        const current = proposal.id ? readTasks().find(task => task.id === proposal.id && !task.deleted) : undefined;
        if (proposal.id && current?.modified !== proposal.expected) { setError('这个任务已经改过了，请让 AI 重新起草。'); return; }
        saveTask({ ...proposal.task, id: proposal.id ?? newTaskId(), ...(proposal.task.done === 'awaiting-confirmation' ? { done: new Date().toISOString() } : {}) });
        setChat(all => ({ ...all, proposals: all.proposals.map(item => item.key === key ? { ...item, saved: true } : item) }));
    }
    const results = new Map(chat.messages.filter(item => item.role === 'tool').map(item => [item.tool_call_id!, parse(item.content)]));
    const today = momentNow().date;
    // One turn: a question, and everything that answered it, however many rounds of looking up it took.
    const turns: { question: string; replies: Message[]; last: boolean }[] = [];
    chat.messages.forEach(message => {
        if (message.role === 'user') turns.push({ question: message.content ?? '', replies: [], last: false });
        else if (message.role === 'assistant') turns.at(-1)?.replies.push(message);
    });
    if (turns.length) turns.at(-1)!.last = true;
    return <div className="sd ai"><div className="ai-scroll" ref={scroller}><div className="wrap narrow">
        <header className="ai-head"><h1>AI</h1>{chat.messages.length > 0 && !busy && <button className="ib" onClick={() => { setChat({ messages: [], proposals: [] }); setError(''); }}>新对话</button>}</header>
        {!chat.messages.length && <div className="ai-empty">
            <p>问课表、地图和校园资料：查安排、找时间、找空教室、问路。起草的任务经你确认才会加到清单。</p>
            {!prefs.class && <p className="fine">先在“我”里选好班级，AI 才能看到你的课表；搜索和空教室现在就能问。</p>}
            {!waiting && <div className="ai-examples">{AI_EXAMPLES.map(example => <button key={example} onClick={() => void send(example)}>{example}</button>)}</div>}
            <p className="fine">对话只存在这台设备上；问的内容会发给模型（腾讯云 EdgeOne 提供的 DeepSeek）。</p>
        </div>}
        {loadError && <p role="status" className="fine">课表还没读完：{loadError}</p>}
        <div className="ai-turns" aria-live="polite">{turns.map((turn, at) => {
            const calls = turn.replies.flatMap(reply => reply.tool_calls ?? []);
            const answer = [...turn.replies].reverse().find(reply => reply.content && !reply.tool_calls?.length)?.content
                ?? (turn.last && streaming !== null ? null : [...turn.replies].reverse().find(reply => reply.content)?.content);
            const counts = new Map<string, number>(); calls.forEach(call => counts.set(call.function.name, (counts.get(call.function.name) ?? 0) + 1));
            const doing = calls.some(call => !results.has(call.id));
            const found = new Map<string, { name: string; result: unknown }>();
            calls.forEach(call => { const result = results.get(call.id); if (result && !(typeof result === 'object' && 'error' in (result as object))) found.set(call.function.name, { name: call.function.name, result }); });
            const drafts = chat.proposals.filter(item => calls.some(call => call.id === item.call));
            return <section key={at} className="ai-turn">
                <p className="ai-q">{turn.question}</p>
                {calls.length > 0 && <details className="ai-steps"><summary className={doing ? 'doing' : ''}>{doing ? '正在' : '已'}{[...counts].map(([name, count]) => `${STEPS[name] ?? name}${count > 1 ? ` ×${count}` : ''}`).join(' · ')}</summary>
                    <ol>{turn.replies.map((reply, i) => <li key={i}>{reply.content && reply.tool_calls?.length ? <p>{reply.content}</p> : null}
                        {reply.tool_calls?.map(call => { const result = results.get(call.id); const failed = Boolean(result && typeof result === 'object' && 'error' in (result as object));
                            return <div key={call.id} className={failed ? 'failed' : ''}>{STEPS[call.function.name] ?? call.function.name}{result === undefined ? '……' : failed ? `：${(result as { error: string }).error}` : ''}</div>; })}</li>)}</ol>
                </details>}
                {answer && <div className="ai-a"><p>{answer}</p></div>}
                {turn.last && streaming !== null && <div className="ai-a"><p>{streaming}<span className="ai-caret" /></p></div>}
                {turn.last && busy && streaming === null && !doing && <p className="ai-wait">正在想……</p>}
                {found.size > 0 && [...found.values()].map(item => <Found key={item.name} name={item.name} result={item.result} />)}
                {drafts.length > 0 && <Drafts drafts={drafts} today={today} onAdd={keys => keys.forEach(confirm)} onDrop={key => setChat(all => ({ ...all, proposals: all.proposals.filter(item => item.key !== key) }))} />}
            </section>;
        })}</div>
        {error && <p role="alert" className="ai-error">{error}{lastUser >= 0 && <button className="ib" onClick={again}>重试</button>}</p>}
        {!busy && lastUser >= 0 && !error && <div className="ai-again"><button className="ib" onClick={again}>重新回答</button><button className="ib" onClick={edit}>改问题</button></div>}
        {waiting && <p role="status" className="fine">在新打开的页面登录或注册，回到这里会自动发出：“{waiting}”</p>}
        <div ref={end} className="ai-end" />
        </div></div>
        <div className="ai-dock"><form className="ai-compose" onSubmit={event => { event.preventDefault(); void send(); }}>
            <textarea aria-label="问点什么" value={draft} maxLength={4000} rows={1} placeholder="问点什么" onChange={event => setDraft(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
            {busy ? <button type="button" className="btn" onClick={() => stop.current?.abort()}>停止</button> : <button className="btn go" disabled={!draft.trim()}>发送</button>}
        </form></div>
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
