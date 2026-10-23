import { api, el, empty, errorText, formatTime, link, message, pill, q, session, type FormDefinition } from './platform-client';

const status = q<HTMLElement>('[data-forms-status]');
let forms: FormDefinition[] = [];
const FORMS_CACHE_KEY = 'studev_forms_cache_v2';

function render() {
  const search = q<HTMLInputElement>('[data-forms-search]').value.trim().toLowerCase();
  const items = forms.filter((f) => `${f.title} ${f.description}`.toLowerCase().includes(search));
  const list = q('[data-forms-list]');
  list.replaceChildren();
  q('[data-forms-count]').textContent = `${items.length} 个可用表单`;

  if (!items.length) {
    const note = empty(search ? '无匹配表单' : '暂无可用表单');
    note.style.gridColumn = '1 / -1';
    list.append(note);
    return;
  }

  for (const form of items) {
    const card = el('article', undefined, 'p-form-card');
    const pills = el('div', undefined, 'p-pills');
    pills.append(pill(form.access));
    if (form.requireReview) pills.append(el('span', '审核', 'p-pill'));
    card.append(pills, el('h2', form.title), el('p', form.description || ''));
    if (form.deadline) card.append(el('p', `截止：${formatTime(form.deadline)}`, 'p-help'));
    const actions = el('div', undefined, 'p-actions');
    actions.append(link('填写表单', `/fill/?id=${encodeURIComponent(form.id)}`, ''));
    card.append(actions);
    list.append(card);
  }
}

q('[data-forms-search]').addEventListener('input', render);

// 0ms SWR 优先从客户端本地缓存展示表单，消灭初次白屏骨架等待
try {
  const cached = localStorage.getItem(FORMS_CACHE_KEY);
  if (cached) {
    const parsed = JSON.parse(cached) as FormDefinition[];
    if (Array.isArray(parsed) && parsed.length > 0) {
      forms = parsed;
      render();
      message(status);
    }
  }
} catch {
  /* localStorage unavailable */
}

void (async () => {
  try {
    const [currentSession, data] = await Promise.all([
      session(true),
      api<{ items: FormDefinition[] }>('/forms'),
    ]);
    if (!currentSession) return;
    forms = data.items;
    render();
    message(status);
    try {
      localStorage.setItem(FORMS_CACHE_KEY, JSON.stringify(forms));
    } catch {}
  } catch (e) {
    message(status, errorText(e), 'error');
  }
})();
