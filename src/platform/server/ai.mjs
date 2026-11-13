import { Completion, completionRequest, situationError, tools } from '../../campus/world/assistant.mjs';
import { fail, readJson, response } from './common.mjs';

/** The model, through EdgeOne Makers Models' gateway: the built-in one that is quickest and calls the tools right. */
export const AI_MODEL = '@makers/deepseek-v4.1-flash';
const GATEWAY = 'https://ai-gateway.edgeone.link/v1/chat/completions';
/** Free model requests per person per day, including requests that continue after tool results. */
export const DAILY = 30;
const names = new Set(tools.map(tool => tool.function.name));
const bounded = (value, max) => typeof value === 'string' && value.length <= max;
export function aiMessages(input) {
  if (!Array.isArray(input) || !input.length || input.length > 32) fail(400, 'AI_MESSAGES_INVALID', '对话过长，请新建对话。');
  const pending = new Set();
  const messages = input.map(item => {
    if (!item || !['user', 'assistant', 'tool'].includes(item.role) || !(bounded(item.content, 40000) || item.role === 'assistant' && item.content === null)) fail(400, 'AI_MESSAGES_INVALID', '对话格式无效。');
    if (item.role === 'tool') {
      if (!pending.delete(item.tool_call_id)) fail(400, 'AI_MESSAGES_INVALID', '工具结果与调用不匹配。');
      return { role: 'tool', content: item.content, tool_call_id: item.tool_call_id };
    }
    if (pending.size) fail(400, 'AI_MESSAGES_INVALID', '缺少工具结果。');
    const message = { role: item.role, content: item.content };
    if (item.role === 'assistant' && item.tool_calls !== undefined) {
      if (!Array.isArray(item.tool_calls) || !item.tool_calls.length || item.tool_calls.length > 8) fail(400, 'AI_MESSAGES_INVALID', '工具调用无效。');
      message.tool_calls = item.tool_calls.map(call => {
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(call.id) || pending.has(call.id) || call.type !== 'function' || !names.has(call.function?.name) || !bounded(call.function?.arguments, 4096)) fail(400, 'AI_MESSAGES_INVALID', '工具调用无效。');
        pending.add(call.id);
        return { id: call.id, type: 'function', function: { name: call.function.name, arguments: call.function.arguments } };
      });
    }
    return message;
  });
  if (pending.size || messages[0].role !== 'user' || !['user', 'tool'].includes(messages.at(-1).role)) fail(400, 'AI_MESSAGES_INVALID', '对话顺序无效。');
  return messages;
}

/** The platform only proxies inference. Tools and personal writes execute on the person's device. */
export function createAiService({ identity, repo, env, now = Date.now, fetcher = fetch }) {
  return async function handle(context, path) {
    if (path !== '/api/platform/ai') return null;
    const session = await identity.authenticate(context.request, { required: true, csrf: context.request.method === 'POST' });
    if (context.request.method !== 'POST') fail(405, 'METHOD_NOT_ALLOWED', '不支持此请求方式。');
    if (!env.MAKERS_MODELS_KEY) fail(503, 'AI_NOT_CONFIGURED', 'AI 服务尚未配置。');
    const body = await readJson(context.request, 131072);
    const messages = aiMessages(body.messages);
    const invalid = situationError(body.situation);
    if (invalid) fail(400, 'AI_SITUATION_INVALID', invalid);
    // Who is asking is the account's own, not what the device says.
    const user = session.user;
    const situation = { week: body.situation.week, class: body.situation.class, campus: body.situation.campus, memory: body.situation.memory,
      name: user.realName || user.nickname || null, student: user.studentId || null };
    await repo.throttle('ai-minute', session.user.id, 12);
    // The free quota is shared by everyone; each person has a fair part of it a day, said only once it is used up.
    try { await repo.throttle('ai-day', session.user.id, DAILY, 86400); }
    catch (error) { if (error?.status === 429) fail(429, 'AI_DAILY', '今天的免费额度用完了，明天再来；也可以在模型里填自己的 API 继续用。'); throw error; }
    let upstream;
    try {
      upstream = await fetcher(GATEWAY, { method: 'POST',
        headers: { Authorization: `Bearer ${env.MAKERS_MODELS_KEY}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.any([AbortSignal.timeout(90000), ...(context.request.signal ? [context.request.signal] : [])]),
        body: JSON.stringify(completionRequest(AI_MODEL, messages, situation, now())) });
    } catch { fail(502, 'AI_UPSTREAM_FAILED', 'AI 暂时无法响应，请稍后重试。'); }
    if (!upstream.ok || !upstream.body) fail(upstream.status === 429 ? 429 : 502, upstream.status === 429 ? 'AI_QUOTA' : 'AI_UPSTREAM_FAILED', upstream.status === 429 ? '这个月的免费额度用完了，下个月恢复；也可以在模型里填自己的 API 继续用。' : 'AI 暂时无法响应，请稍后重试。');
    return response.stream(relay(upstream.body));
  };
}

/**
 * The model's answer as it comes, in the platform's own few events, the same for every client: `delta` with the next
 * piece of what it says, then `message` with the whole turn, its tool calls put together, or `error`. What the model
 * thinks before answering is not passed on.
 */
export function relay(body) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const send = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const completion = new Completion();
      const take = (line) => { const piece = completion.take(line); if (piece) send('delta', { content: piece }); };
      let pending = '';
      try {
        const reader = body.pipeThrough(new TextDecoderStream()).getReader();
        for (let read = await reader.read(); !read.done; read = await reader.read()) {
          pending += read.value;
          const lines = pending.split(/\r?\n/);
          pending = lines.pop() ?? '';
          lines.forEach(take);
        }
        take(pending);
        const { message, error } = completion.result();
        if (message) send('message', { message }); else send('error', { message: error });
      } catch { send('error', { message: 'AI 暂时无法响应，请稍后重试。' }); }
      finally { controller.close(); }
    },
  });
}
