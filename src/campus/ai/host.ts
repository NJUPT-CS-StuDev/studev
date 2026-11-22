import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// The AI lives in one element kept across the app pages' in-place swaps: opened once, it stays mounted, hidden while
// another page shows, so an answer being written carries on. The header marks the AI tab while it is busy, and once
// an answer finished while one was away.
let root: Root | undefined;
const here = () => location.pathname.replace(/\/+$/, '') === '/ai';
async function show() {
    const host = document.getElementById('ai-host');
    if (!host) return;
    const open = here();
    host.hidden = !open;
    document.documentElement.toggleAttribute('data-ai-busy', host.hasAttribute('data-ai-busy'));
    document.documentElement.toggleAttribute('data-ai-open', open);
    if (open) document.documentElement.removeAttribute('data-ai-done');
    if (open && !root) {
        const { default: AiApp } = await import('./AiApp');
        root = createRoot(host);
        root.render(createElement(AiApp));
    }
}
document.addEventListener('astro:page-load', () => void show());
void show();
// A whole-page load would end the answer: ask first.
window.addEventListener('beforeunload', event => { if (document.getElementById('ai-host')?.hasAttribute('data-ai-busy')) event.preventDefault(); });
