import { api, el, empty, errorText, formatTime, link, message, q, type FormDefinition } from './platform-client';

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
    if (form.requireReview) {
      const pills = el('div', undefined, 'p-pills');
      pills.append(el('span', '提交后审核', 'p-pill'));
      card.append(pills);
    }
    card.append(el('h2', form.title), el('p', form.description || ''));
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
  if (cached !== null) {
    const parsed = JSON.parse(cached) as FormDefinition[];
    if (Array.isArray(parsed)) {
      forms = parsed;
      render();
    }
  }
} catch {
  /* localStorage unavailable */
}

void (async () => {
  try {
    const data = await api<{ items: FormDefinition[] }>('/forms');
    forms = data.items;
    render();
    try {
      localStorage.setItem(FORMS_CACHE_KEY, JSON.stringify(forms));
    } catch {}
  } catch (e) {
    const err = e as { status?: number };
    if (err?.status === 401) {
      try { localStorage.removeItem('studev_auth_user'); } catch {}
      location.replace(`/login/?next=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
    message(status, errorText(e), 'error');
  }
})();
