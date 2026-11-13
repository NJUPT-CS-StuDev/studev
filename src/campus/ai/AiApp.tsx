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
    const end = useRef<HTMLDivElement>(null), stuck = useRef(true);
    const services = useMemo(() => new CampusTools(), []);
    useEffect(() => () => services.dispose(), [services]);
    const latest = useRef(loaded?.line); latest.current = loaded?.line;
    useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(chat)); } catch { /* Kept for this page only. */ } }, [chat]);
    // The view follows the answer down unless one has scrolled up to read.
    useEffect(() => {
        const onScroll = () => { stuck.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 80; };
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
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
    return <main className="ai-entry">
        <header><h1>AI</h1>{chat.messages.length > 0 && !busy && <button className="ib" onClick={() => { setChat({ messages: [], proposals: [] }); setError(''); }}>新对话</button>}</header>
        {!chat.messages.length && <>
            <p className="meta">问课表、地图和校园资料：查安排、找时间、找空教室、问路，起草的任务经你确认才保存。对话只存在这台设备上，问的内容会发给模型（腾讯云 EdgeOne 提供的 DeepSeek）。</p>
            {!prefs.class && <p className="meta">先在“我”里选好班级，AI 才能看到你的课表；搜索和空教室现在就能问。</p>}
            {!waiting && <div className="ai-examples">{AI_EXAMPLES.map(example => <button key={example} onClick={() => void send(example)}>{example}</button>)}</div>}
        </>}
        {loadError && <p role="status" className="meta">课表还没读完：{loadError}</p>}
        <div className="ai-messages" aria-live="polite">
            {chat.messages.map((message, at) => {
                if (message.role === 'tool') return null;
                if (message.role === 'user') return <article key={at} className="ai-message user"><p>{message.content}</p></article>;
                return <article key={at} className="ai-message assistant">
                    {message.content && <p>{message.content}</p>}
                    {message.tool_calls?.map(call => {
                        const result = results.get(call.id), failed = Boolean(result && typeof result === 'object' && 'error' in (result as object));
                        const proposal = chat.proposals.find(item => item.call === call.id);
                        return <div key={call.id} className="ai-step">
                            <details><summary className={result === undefined ? 'doing' : failed ? 'failed' : ''}>{STEPS[call.function.name] ?? call.function.name}{result === undefined ? '……' : failed ? ' · 没查到' : ''}</summary>
                                <pre>{call.function.arguments}{result !== undefined ? `\n→ ${JSON.stringify(result).slice(0, 1200)}` : ''}</pre></details>
                            {result !== undefined && !failed && <Found name={call.function.name} result={result} />}
                            {proposal && <section className="ai-proposal">
                                <b>{proposal.id ? '改成' : '新任务'} · {proposal.task.title}</b>
                                {proposal.task.date && <small>{dayWord(proposal.task.date, today)} {hm(proposal.task.start!)}{proposal.task.end !== undefined ? `–${hm(proposal.task.end)}` : ''}</small>}
                                {proposal.task.due && <small>{dayWord(proposal.task.due.date, today)} {proposal.task.due.time !== undefined ? hm(proposal.task.due.time) : ''} 截止</small>}
                                {proposal.task.note && <small>{proposal.task.note}</small>}
                                <div className="btns"><button className="btn go" disabled={proposal.saved} onClick={() => confirm(proposal.key)}>{proposal.saved ? '已加到清单' : '加到清单'}</button>
                                    {!proposal.saved && <button className="btn" onClick={() => setChat(all => ({ ...all, proposals: all.proposals.filter(item => item.key !== proposal.key) }))}>不要</button>}</div>
                            </section>}
                        </div>;
                    })}
                </article>;
            })}
            {streaming !== null && <article className="ai-message assistant"><p>{streaming}<span className="ai-caret" /></p></article>}
            {busy && streaming === null && <p className="meta ai-thinking">正在查……</p>}
        </div>
        {error && <p role="alert" className="ai-error">{error}{lastUser >= 0 && <button className="ib" onClick={again}>重试</button>}</p>}
        {!busy && lastUser >= 0 && !error && <div className="ai-turn"><button className="ib" onClick={again}>重新回答</button><button className="ib" onClick={edit}>改问题</button></div>}
        {waiting && <p role="status" className="meta">在新打开的页面登录或注册，回到这里会自动发出：“{waiting}”</p>}
        <form className="ai-compose" onSubmit={event => { event.preventDefault(); void send(); }}>
            <textarea aria-label="问点什么" value={draft} maxLength={4000} rows={1} placeholder="问点什么" onChange={event => setDraft(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
            {busy ? <button type="button" className="btn ai-stop" onClick={() => stop.current?.abort()}>停止</button> : <button className="btn go" disabled={!draft.trim()}>发送</button>}
        </form>
        <div ref={end} />
    </main>;
}
