import { useEffect, useMemo, useRef, useState } from 'react';
import { api, session } from '../../platform/client/api';
import { usePreferences } from '@/world/usePreferences';
import { useTasks } from '@/world/useTasks';
import { newTaskId, readTasks, saveTask } from '@/world/tasks';
import { momentNow, hm } from '@/world/time';
import { useTimeline } from '@/timetable/useTimeline';
import { CampusTools } from '@/world/campusTools';
import { definitions, readTimeline, schedulingTool, taskProposal, toolArguments, type TaskProposal } from '@/world/tools';
import '../campus.css';

/** What one can ask, offered while the conversation is empty. */
const AI_EXAMPLES = ['这周有哪些截止和考试？', '今天下午哪里有空教室？', '帮我在下周找三次一小时复习，周五前完成', '从教三到图书馆怎么走？'];

interface Call { id: string; type: 'function'; function: { name: string; arguments: string } }
interface Message { role: 'user' | 'assistant' | 'tool'; content: string | null; tool_call_id?: string; tool_calls?: Call[] }
interface ModelContext { registerTool(tool: { name: string; description: string; inputSchema: object; execute(args: unknown): Promise<unknown> }): void; unregisterTool(name: string): void }

export default function AiApp() {
    const { prefs, ready } = usePreferences(), tasks = useTasks();
    const who = useMemo(() => ({ type: 'me' as const }), []);
    const { loaded, error: loadError } = useTimeline(who, prefs, ready, null, tasks);
    const [draft, setDraft] = useState(''), [messages, setMessages] = useState<Message[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [proposals, setProposals] = useState<(TaskProposal & { key: string; saved?: boolean })[]>([]);
    const services = useMemo(() => new CampusTools(), []);
    useEffect(() => () => services.dispose(), [services]);
    const latest = useRef(loaded?.line); latest.current = loaded?.line;
    const execute = useMemo(() => async (name: string, raw: unknown): Promise<unknown> => {
        const args = toolArguments(name, raw), line = latest.current;
        if (name === 'campus_search') return services.query(String(args.query));
        if (name === 'free_rooms') return services.rooms(args);
        if (name === 'route') return services.route(args);
        if (!line) throw new Error('请先在“我”里选择班级，等待课表读取完成。');
        if (name === 'timeline') return readTimeline(line, String(args.from), String(args.to));
        if (name === 'list_tasks') return readTasks().filter(task => !task.deleted);
        if (name === 'suggest_slots') return schedulingTool(line, args);
        if (name === 'propose_task') { const proposal = taskProposal(args, { ...line, tasks: readTasks().filter(task => !task.deleted) }); const key = newTaskId(); setProposals(all => [...all, { ...proposal, key }]); return { state: 'awaiting_user_confirmation', proposal: key, task: proposal.task }; }
        throw new Error('未知工具。');
    }, [services]);
    useEffect(() => {
        const context = (navigator as Navigator & { modelContext?: ModelContext }).modelContext;
        if (!context) return;
        for (const tool of definitions) context.registerTool({ name: tool.function.name, description: tool.function.description, inputSchema: tool.function.parameters, execute: args => execute(tool.function.name, args).then(value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] })) });
        return () => definitions.forEach(tool => context.unregisterTool(tool.function.name));
    }, [execute]);
    // Asking is for someone signed in, since the answer costs; signing in happens in another tab and the question waits.
    const [waiting, setWaiting] = useState<string | null>(null);
    useEffect(() => {
        if (!waiting) return;
        const back = async () => { if (document.visibilityState === 'visible' && await session()) { const question = waiting; setWaiting(null); void send(question); } };
        window.addEventListener('focus', back); document.addEventListener('visibilitychange', back);
        return () => { window.removeEventListener('focus', back); document.removeEventListener('visibilitychange', back); };
    });
    async function send(asked = draft) {
        if (!asked.trim() || busy) return;
        if (!await session()) { setWaiting(asked.trim()); window.open(`/login/?next=${encodeURIComponent('/signed-in/')}`, '_blank'); return; }
        const question = asked.trim(); setDraft(''); setBusy(true); setError('');
        let history = [...messages, { role: 'user' as const, content: question }];
        // Keep whole turns: a tool result never survives without the call that produced it.
        while (history.length > 16) { const next = history.findIndex((item, i) => i > 0 && item.role === 'user'); if (next < 0) break; history = history.slice(next); }
        setMessages(history);
        try {
            for (let round = 0; round < 8; round++) {
                const result = await api<{ message: Message }>('/ai', { messages: history });
                const answer = result.message; history = [...history, answer]; setMessages(history);
                if (!answer.tool_calls?.length) return;
                for (const call of answer.tool_calls) {
                    let value: unknown;
                    try { value = await execute(call.function.name, JSON.parse(call.function.arguments)); } catch (error) { value = { error: error instanceof Error ? error.message : '工具执行失败。' }; }
                    history = [...history, { role: 'tool', tool_call_id: call.id, content: JSON.stringify(value) }];
                }
                setMessages(history);
            }
            throw new Error('本次已查询多轮，请缩小问题范围后继续。');
        } catch (error) { setError(error instanceof Error ? error.message : 'AI 暂不可用。'); }
        finally { setBusy(false); }
    }
    function confirm(key: string) {
        const proposal = proposals.find(item => item.key === key); if (!proposal || proposal.saved) return;
        const current = proposal.id ? readTasks().find(task => task.id === proposal.id && !task.deleted) : undefined;
        if (proposal.id && current?.modified !== proposal.expected) { setError('任务已经改变，请重新生成草案。'); return; }
        saveTask({ ...proposal.task, id: proposal.id ?? newTaskId(), ...(proposal.task.done === 'awaiting-confirmation' ? { done: new Date().toISOString() } : {}) });
        setProposals(all => all.map(item => item.key === key ? { ...item, saved: true } : item));
    }
    return <main className="ai-entry">
        <header><h1>AI</h1></header>
        <p className="meta">问课表、地图和校园资料：查安排、找时间、找空教室、问路，起草的任务经你确认才保存。对话和查到的内容会发给 DeepSeek，对话只留在这个页面。</p>
        {waiting && <p role="status" className="meta">在新打开的页面登录或注册，回到这里会自动发出：“{waiting}”</p>}
        {!messages.length && !waiting && <div className="ai-examples">{AI_EXAMPLES.map(example => <button key={example} onClick={() => void send(example)}>{example}</button>)}</div>}
        {!prefs.class && <p className="meta">查看个人安排前，请在“我”里选择班级；校园搜索与空教室查询可以直接使用。</p>}
        {loadError && <p role="status">课表尚未读完：{loadError}</p>}
        <div className="ai-messages" aria-live="polite">{messages.filter(item => item.role !== 'tool').map((message, i) => <article key={i} className={`ai-message ${message.role}`}><small>{message.role === 'user' ? '你' : '校园助手'}</small>{message.content && <p>{message.content}</p>}{message.tool_calls?.map(call => <small key={call.id}>正在查询 · {definitions.find(tool => tool.function.name === call.function.name)?.function.description.split('，')[0]}</small>)}</article>)}</div>
        {proposals.map(item => <section className="ai-proposal" key={item.key}><h3>{item.id ? '修改任务草案' : '新任务草案'} · {item.task.title}</h3><p>{item.task.date ? `执行 ${item.task.date} ${hm(item.task.start!)}${item.task.end !== undefined ? `–${hm(item.task.end)}` : ''}` : '尚未排执行时间'}</p>{item.task.due && <p>截止 {item.task.due.date} {item.task.due.time !== undefined ? hm(item.task.due.time) : '当天结束'}</p>}{item.task.note && <p>{item.task.note}</p>}{item.task.done !== undefined && <p>状态：{item.task.done ? '已完成' : '待完成'}</p>}<button className="btn" disabled={item.saved} onClick={() => confirm(item.key)}>{item.saved ? '已保存到本机' : '确认保存'}</button>{!item.saved && <button className="ib" onClick={() => setProposals(all => all.filter(other => other.key !== item.key))}>放弃</button>}</section>)}
        {error && <p role="alert">{error}</p>}
        <form className="ai-compose" onSubmit={event => { event.preventDefault(); void send(); }}><textarea aria-label="询问校园助手" value={draft} maxLength={4000} rows={3} placeholder="例如：帮我在下周找三次一小时复习，周五前完成" onChange={event => setDraft(event.target.value)} disabled={busy} /><button className="btn" disabled={busy || !draft.trim()}>{busy ? '正在查询…' : '发送'}</button><button className="ib" type="button" disabled={busy} onClick={() => { setMessages([]); setProposals([]); setError(''); }}>新对话</button></form>
    </main>;
}
