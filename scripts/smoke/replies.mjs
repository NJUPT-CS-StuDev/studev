// A real HTTP event stream with separate gates, used only for native acceptance.
import { createServer } from 'node:http';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = process.argv[2];
if (!directory) throw new Error('Missing temporary conversation-test directory');
const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        response.writeHead(404).end();
        return;
    }
    try {
        let text = '';
        for await (const piece of request) text += piece;
        const asked = JSON.parse(text).messages.findLast(message => message.role === 'user')?.content;
        const id = asked === '这周有哪些考试' ? 'a' : asked === '今天哪里有空教室' ? 'b' : undefined;
        if (!id) { response.writeHead(400).end(); return; }
        const partial = id === 'a' ? '考试的部分回答' : '空教室的';
        const send = (content, finish_reason = null) => response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason }] })}\n\n`);
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
        send(partial);
        writeFileSync(join(directory, `${id}.started`), '');
        while (!response.destroyed && !existsSync(join(directory, `${id}.finish`))) await delay(60);
        if (response.destroyed) return;
        send(id === 'a' ? '多余尾句' : '完整回答', 'stop');
        response.end('data: [DONE]\n\n');
    } catch {
        response.destroy();
    }
});
server.listen(0, '127.0.0.1', () => writeFileSync(join(directory, 'port'), String(server.address().port)));
