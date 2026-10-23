import { api, button, el, empty, errorText, formatTime, message, pill, q, renderFields, renderSubmission, session, type FormDefinition, type Session, type Submission } from './platform-client';

const status = q<HTMLElement>('[data-submissions-status]');
let items: Submission[] = [];
let identity: Session | null = null;
const CACHE_KEY = 'studev_submissions_cache';

function render() {
  const term = q<HTMLInputElement>('[data-submissions-search]').value.trim().toLowerCase();
  const filtered = items.filter((s) => `${s.formTitle} ${s.id}`.toLowerCase().includes(term));
  q('[data-submissions-count]').textContent = `${filtered.length} 条记录`;
  const root = q('[data-submissions-list]');
  root.replaceChildren();

  if (!filtered.length) {
    root.append(empty('暂无提交记录'));
    return;
  }

  const wrap = el('div', undefined, 'p-table-wrap');
  const table = el('table', undefined, 'p-table');
  const head = el('thead');
  const tr = el('tr');
  for (const title of ['表单名称', '状态', '提交时间', '操作']) tr.append(el('th', title));
  head.append(tr);
  const body = el('tbody');

  for (const item of filtered) {
    const row = el('tr');
    const name = el('td', item.formTitle);
    if (item.submitterIdentity) {
      name.append(el('small', `${item.submitterIdentity.studentId} · ${item.submitterIdentity.realName}`));
    }
    name.append(el('small', item.id));
    const state = el('td');
    state.append(pill(item.status));
    const action = el('td');
    action.append(button('查看详情', () => show(item.id)));
    row.append(name, state, el('td', formatTime(item.createdAt)), action);
    body.append(row);
  }

  table.append(head, body);
  wrap.append(table);
  root.append(wrap);
}

async function show(id: string) {
  try {
    const result = await api<{
      submission: Submission;
      form: FormDefinition;
      canEdit?: boolean;
    }>(`/submissions/${encodeURIComponent(id)}`);
    const content = q('[data-submission-content]');
    content.replaceChildren();
    renderSubmission(content, result.submission, result.form, (e) => message(status, errorText(e), 'error'));
    const canEdit = !!identity && result.submission.userId === identity.user.id && result.canEdit === true;
    q('[data-submission-edit]').hidden = !canEdit;
    if (canEdit) {
      renderFields(q('[data-submission-edit-fields]'), result.form.fields, result.submission.answers, true);
    }
    q('[data-submission-detail]').hidden = false;
    q('[data-submission-detail]').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    message(status, errorText(e), 'error');
  }
}

q('[data-submissions-search]').addEventListener('input', render);
q<HTMLButtonElement>('[data-submission-close]').addEventListener('click', () => {
  q('[data-submission-detail]').hidden = true;
});

// 0ms SWR 优先从本地渲染
try {
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    const parsed = JSON.parse(cached);
    if (Array.isArray(parsed) && parsed.length > 0) {
      items = parsed;
      render();
      message(status);
    }
  }
} catch {}

void (async () => {
  try {
    identity = await session(true);
    if (!identity) return;
    const data = await api<{ items: Submission[] }>('/me/submissions');
    items = data.items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    render();
    message(status);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(items));
    } catch {}
  } catch (e) {
    message(status, errorText(e), 'error');
  }
})();
