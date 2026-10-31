import { api, busy, button, bytes, copy, el, empty, errorText, formatTime, message, nicknameOf, pill, q, renderFields, renderSubmission, saveBlob, session, type Field, type FormDefinition, type Session, type Submission, type SubmitterContact } from './platform-client';

const status = q<HTMLElement>('[data-admin-platform-status]');
let identity: Session | null = null;
let forms: FormDefinition[] = [];
let editing: FormDefinition | null = null;
let fields: Field[] = [];
let activeForm: FormDefinition | null = null;
let records: Submission[] = [];
let selected: Submission | null = null;
let dirty = false;

const fieldNames: Record<Field['type'], string> = { text: '短文本', textarea: '长文本', select: '单选', checkbox: '多选', number: '数字', date: '日期', file: '附件' };

function panel(name: string) {
  document.querySelectorAll<HTMLElement>('[data-admin-panel]').forEach((p) => {
    p.hidden = p.dataset.adminPanel !== name;
  });
}

async function guard(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    message(status, errorText(e), 'error');
    status.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

async function confirmAction(title: string, description: string): Promise<string | null> {
  const dialog = q<HTMLDialogElement>('[data-platform-confirm]');
  q('[data-confirm-title]').textContent = title;
  q('[data-confirm-description]').textContent = description;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) =>
    dialog.addEventListener(
      'close',
      () => {
        resolve(dialog.returnValue === 'confirm' ? 'ok' : null);
      },
      { once: true }
    )
  );
}

function formLink(form: FormDefinition) {
  return new URL(`/fill/?id=${encodeURIComponent(form.id)}`, location.origin).href;
}

async function refreshForms() {
  forms = (await api<{ items: FormDefinition[] }>('/admin/forms')).items;
  renderForms();
}

function renderForms() {
  const term = q<HTMLInputElement>('[data-admin-form-search]').value.trim().toLowerCase();
  const state = q<HTMLSelectElement>('[data-admin-form-filter]').value;
  const visible = forms.filter((f) => (!state || f.status === state) && `${f.title} ${f.description}`.toLowerCase().includes(term));
  const root = q('[data-admin-forms-list]');
  root.replaceChildren();
  if (!visible.length) {
    const box = empty('没有符合条件的表单', '点击“新建表单”，从空白或模板开始。');
    box.style.gridColumn = '1 / -1';
    root.append(box);
  }
  for (const f of visible) {
    const card = el('article', undefined, 'p-form-card');
    const pills = el('div', undefined, 'p-pills');
    pills.append(pill(f.status));
    if (f.requireReview) pills.append(el('span', '提交后审核', 'p-pill'));
    card.append(pills, el('h3', f.title), el('p', f.description || '暂无填写说明'));
    if (f.deadline) card.append(el('p', `截止 ${formatTime(f.deadline)}`, 'p-help'));
    const actions = el('div', undefined, 'p-actions');
    actions.append(
      button('查看记录', () => guard(() => openRecords(f))),
      button('编辑', () => {
        openEditor(f);
      }),
      button('复制链接', () => copy(formLink(f), status)),
      button('复制表单', () =>
        guard(async () => {
          const result = await api<{ form: FormDefinition }>(`/admin/forms/${encodeURIComponent(f.id)}/duplicate`, {});
          await refreshForms();
          openEditor(result.form);
          message(status, '已复制为新草稿，原表记录保持不变。', 'success');
        })
      )
    );
    if (identity?.user.role === 'owner') {
      actions.append(
        button(
          '删除',
          () =>
            guard(async () => {
              if ((await confirmAction('删除表单', `确认彻底删除表单“${f.title}”？删除后不可恢复。`)) === null) return;
              await api(`/admin/forms/${encodeURIComponent(f.id)}/delete`, {}, { method: 'POST' });
              await refreshForms();
              message(status, '表单已删除。', 'success');
            }),
          'danger small'
        )
      );
    }
    card.append(actions);
    root.append(card);
  }
}

function newField(type: Field['type'], label?: string): Field {
  return {
    id: `f_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`,
    type,
    label: label || fieldNames[type],
    description: '',
    required: false,
    ...(['select', 'checkbox'].includes(type) ? { options: ['选项一', '选项二'] } : {}),
    ...(type === 'file' ? { maxFiles: 1, maxFileBytes: 20971520 } : {}),
    ...(['text', 'textarea'].includes(type) ? { maxLength: type === 'text' ? 200 : 2000 } : {}),
  };
}

function inputField(label: string, value: string, type = 'text', change?: (v: string) => void) {
  const wrap = el('div', undefined, 'p-field');
  const id = `edit-${crypto.randomUUID()}`;
  const l = el('label', label);
  l.htmlFor = id;
  const input = type === 'textarea' ? el('textarea') : el('input');
  input.id = id;
  input.value = value;
  if (input instanceof HTMLInputElement) input.type = type;
  else input.rows = 3;
  if (input instanceof HTMLInputElement && type === 'number') input.step = 'any';
  if (type === 'text') input.maxLength = label === '字段名称' ? 100 : 500;
  input.addEventListener('input', () => {
    change?.(input.value);
    dirty = true;
  });
  wrap.append(l, input);
  return { wrap, input };
}

function renderFieldEditors() {
  const root = q('[data-editor-fields]');
  root.replaceChildren();
  q('[data-editor-field-count]').textContent = `${fields.length} / 30 个字段`;
  fields.forEach((field, index) => {
    const card = el('section', undefined, 'p-field-editor');
    const head = el('div', undefined, 'p-field-editor-head');
    head.append(el('strong', `${index + 1}. ${fieldNames[field.type]}`));
    const actions = el('div', undefined, 'p-actions');
    const up = button('上移', () => {
      [fields[index - 1], fields[index]] = [fields[index] as Field, fields[index - 1] as Field];
      dirty = true;
      renderFieldEditors();
    });
    up.disabled = index === 0;
    const down = button('下移', () => {
      [fields[index + 1], fields[index]] = [fields[index] as Field, fields[index + 1] as Field];
      dirty = true;
      renderFieldEditors();
    });
    down.disabled = index === fields.length - 1;
    actions.append(
      up,
      down,
      button(
        '移除',
        () => {
          fields.splice(index, 1);
          dirty = true;
          renderFieldEditors();
        },
        'danger small'
      )
    );
    head.append(actions);
    card.append(head);
    const label = inputField('字段名称', field.label, 'text', (v) => (field.label = v));
    label.input.required = true;
    label.input.maxLength = 100;
    card.append(label.wrap, inputField('补充说明（选填）', field.description || '', 'text', (v) => (field.description = v)).wrap);
    const required = el('label', undefined, 'p-checkbox');
    const check = el('input');
    check.type = 'checkbox';
    check.checked = field.required;
    check.addEventListener('change', () => {
      field.required = check.checked;
      dirty = true;
    });
    required.append(check, el('span', '必填'));
    card.append(required);
    if (field.type === 'select' || field.type === 'checkbox') {
      const options = inputField('选项（每行一个）', (field.options || []).join('\n'), 'textarea', (v) => (field.options = v.split('\n').map((s) => s.trim()).filter(Boolean)));
      options.input.required = true;
      card.append(el('br'), options.wrap);
    }
    if (field.type === 'text' || field.type === 'textarea') {
      const length = inputField('最多字数', String(field.maxLength || 200), 'number', (v) => (field.maxLength = Number(v)));
      if (length.input instanceof HTMLInputElement) {
        length.input.required = true;
        length.input.step = '1';
        length.input.min = '1';
        length.input.max = field.type === 'text' ? '1000' : '10000';
      }
      card.append(el('br'), length.wrap);
    }
    if (field.type === 'number') {
      const grid = el('div', undefined, 'p-inline-grid');
      grid.append(
        inputField('最小值（选填）', field.min === undefined ? '' : String(field.min), 'number', (v) => (field.min = v === '' ? undefined : Number(v))).wrap,
        inputField('最大值（选填）', field.max === undefined ? '' : String(field.max), 'number', (v) => (field.max = v === '' ? undefined : Number(v))).wrap
      );
      card.append(el('br'), grid);
    }
    if (field.type === 'file') {
      const grid = el('div', undefined, 'p-inline-grid');
      const count = inputField('最多文件数', String(field.maxFiles || 1), 'number', (v) => (field.maxFiles = Number(v)));
      const size = inputField('每个文件上限（MB）', String((field.maxFileBytes || 20971520) / 1048576), 'number', (v) => (field.maxFileBytes = Math.round(Number(v) * 1048576)));
      if (count.input instanceof HTMLInputElement) {
        count.input.step = '1';
        count.input.min = '1';
        count.input.max = '5';
        count.input.required = true;
      }
      if (size.input instanceof HTMLInputElement) {
        size.input.min = '0.01';
        size.input.max = '20';
        size.input.step = '0.01';
        size.input.required = true;
      }
      grid.append(count.wrap, size.wrap);
      const extensions = inputField('允许的后缀（选填，用逗号分隔）', (field.extensions || []).join(', '), 'text', (v) => (field.extensions = v.split(/[,，\s]+/).map((s) => s.replace(/^\./, '').toLowerCase()).filter(Boolean)));
      card.append(el('br'), grid, extensions.wrap, el('p', '留空表示允许服务支持的文件格式；单次所有附件合计最多 10 个。', 'p-help'));
    }
    root.append(card);
  });
}

function openEditor(form: FormDefinition | null) {
  editing = form;
  fields = structuredClone(form?.fields || [newField('text', '登记内容')]);
  q('[data-editor-heading]').textContent = form ? '编辑表单' : '新建表单';
  q<HTMLInputElement>('#editor-title').value = form?.title || '';
  q<HTMLTextAreaElement>('#editor-description').value = form?.description || '';
  q<HTMLInputElement>('#editor-deadline').value = form?.deadline ? new Date(new Date(form.deadline).getTime() - new Date(form.deadline).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  q<HTMLInputElement>('#editor-per-user').value = String(form?.maxPerUser || 1);
  q<HTMLInputElement>('#editor-total').value = String(form?.maxSubmissions || 100);
  q<HTMLInputElement>('#editor-review').checked = form?.requireReview || false;
  q<HTMLInputElement>('#editor-edit').checked = form?.allowEdit || false;
  q<HTMLSelectElement>('#editor-status').value = form?.status || 'draft';
  q('[data-editor-copy]').hidden = !form;
  q('[data-editor-templates]').hidden = !!form;
  q('[data-editor-preview-content]').hidden = true;
  dirty = false;
  renderFieldEditors();
  panel('editor');
}

function readForm() {
  const title = q<HTMLInputElement>('#editor-title').value.trim();
  if (!title) throw new Error('请填写表单名称。');
  if (!fields.length) throw new Error('请至少添加一个字段。');
  for (const f of fields) {
    if (!f.label.trim()) throw new Error('请为每个字段填写名称。');
    if (['select', 'checkbox'].includes(f.type)) {
      const options = f.options || [];
      if (options.length < 1 || options.length > 30) throw new Error(`“${f.label}”需要 1–30 个选项。`);
      if (options.some((value) => !value || value.length > 160)) throw new Error(`“${f.label}”每个选项需要 1–160 个字符。`);
      if (new Set(options).size !== options.length) throw new Error(`“${f.label}”的选项不能重复。`);
    }
    if (f.type === 'number' && f.min !== undefined && f.max !== undefined && f.min > f.max) throw new Error(`“${f.label}”的最小值不能大于最大值。`);
  }
  const deadline = q<HTMLInputElement>('#editor-deadline').value;
  return {
    title,
    description: q<HTMLTextAreaElement>('#editor-description').value.trim(),
    status: q<HTMLSelectElement>('#editor-status').value,
    access: 'members',
    deadline: deadline ? new Date(deadline).toISOString() : '',
    requireReview: q<HTMLInputElement>('#editor-review').checked,
    allowEdit: q<HTMLInputElement>('#editor-edit').checked,
    maxPerUser: Number(q<HTMLInputElement>('#editor-per-user').value),
    maxSubmissions: Number(q<HTMLInputElement>('#editor-total').value),
    fields: fields.map((field) => (field.type === 'file' && !field.extensions?.length ? { ...field, extensions: undefined } : field)),
    revision: editing?.revision,
  };
}

q<HTMLFormElement>('[data-editor-form]').addEventListener('input', () => (dirty = true));
q<HTMLFormElement>('[data-editor-form]').addEventListener('submit', (e) => {
  e.preventDefault();
  const b = q<HTMLButtonElement>('button[type=submit]', e.currentTarget as HTMLFormElement);
  void guard(async () => {
    await busy(b, async () => {
      const value = readForm();
      const result = await api<{ form: FormDefinition }>(editing ? `/admin/forms/${encodeURIComponent(editing.id)}` : '/admin/forms', value);
      await refreshForms();
      openEditor(result.form);
      message(status, result.form.status === 'published' ? '已发布，可以分享填写链接。' : '表单已保存。', 'success');
    });
  });
});

q('[data-editor-add]').addEventListener('click', () => {
  if (fields.length >= 30) {
    message(status, '每张表最多 30 个字段。', 'error');
    return;
  }
  fields.push(newField(q<HTMLSelectElement>('[data-editor-add-type]').value as Field['type']));
  dirty = true;
  renderFieldEditors();
});

q('[data-editor-preview]').addEventListener('click', () => {
  try {
    readForm();
    const root = q('[data-editor-preview-content]');
    root.replaceChildren(el('h3', q<HTMLInputElement>('#editor-title').value || '填写预览'), el('p', q<HTMLTextAreaElement>('#editor-description').value, 'p-description'));
    const content = el('fieldset', undefined, 'p-fieldset');
    content.disabled = true;
    renderFields(content, fields);
    root.append(content, el('p', '此处仅预览当前编辑内容，不会创建提交。保存后可打开填写链接体验。', 'p-help'));
    root.hidden = false;
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    message(status, errorText(e), 'error');
  }
});

q('[data-editor-copy]').addEventListener('click', () => {
  if (editing) void copy(formLink(editing), status);
});

document.querySelectorAll<HTMLButtonElement>('[data-template]').forEach((b) =>
  b.addEventListener('click', () => {
    const type = b.dataset.template;
    fields =
      type === 'files'
        ? [newField('file', '提交文件')]
        : type === 'mixed'
          ? [newField('text', '材料名称'), newField('textarea', '说明'), newField('file', '附件')]
          : type === 'feedback'
            ? [newField('textarea', '你的意见或建议')]
            : [newField('text', '登记内容'), newField('textarea', '补充说明')];
    if (fields[0]) fields[0].required = true;
    dirty = true;
    renderFieldEditors();
  })
);

async function leaveEditor() {
  if (dirty && (await confirmAction('离开编辑？', '尚未保存的修改将丢失。')) === null) return;
  dirty = false;
  panel('forms');
}

q('[data-editor-back]').addEventListener('click', () => {
  void leaveEditor();
});

async function openRecords(form: FormDefinition) {
  activeForm = form;
  q('[data-records-title]').textContent = form.title;
  const result = await api<{
    items: Submission[];
    usage: {
      authorizations: number;
      completed: number;
      fileBytes: number;
    };
  }>(`/admin/forms/${encodeURIComponent(form.id)}/submissions`);
  records = result.items;
  q('[data-records-detail]').hidden = true;
  const usage = q('[data-records-usage]');
  usage.replaceChildren();
  for (const [value, label] of [
    [`${result.usage.authorizations} / ${form.maxSubmissions}`, '已用提交名额'],
    [String(result.usage.completed), '已完成提交'],
    [bytes(result.usage.fileBytes), '已提交附件大小（原始文件）'],
  ]) {
    const stat = el('div', undefined, 'p-stat');
    stat.append(el('strong', value), el('span', label));
    usage.append(stat);
  }
  renderRecords();
  panel('records');
}

function renderRecords() {
  const term = q<HTMLInputElement>('[data-records-search]').value.trim().toLowerCase();
  const state = q<HTMLSelectElement>('[data-records-filter]').value;
  const items = records.filter(
    (s) =>
      (!state || s.status === state) &&
      `${s.submitterIdentity?.studentId || ''} ${s.submitterIdentity?.realName || ''} ${s.submitterName} ${s.id} ${JSON.stringify(s.answers)}`.toLowerCase().includes(term)
  );
  q('[data-records-count]').textContent = `${items.length} / ${records.length} 条`;
  const root = q('[data-records-list]');
  root.replaceChildren();
  if (!items.length) {
    root.append(empty('没有填写记录', '成员提交后，信息和附件会出现在这里。'));
    return;
  }
  const wrap = el('div', undefined, 'p-table-wrap');
  const table = el('table', undefined, 'p-table');
  const head = el('thead');
  const titles = el('tr');
  for (const s of ['填写者', '状态', '附件', '提交时间', '操作']) titles.append(el('th', s));
  head.append(titles);
  const body = el('tbody');
  for (const s of items) {
    const row = el('tr');
    const name = el('td', s.submitterIdentity?.realName || s.submitterName || '成员');
    if (s.submitterIdentity) name.append(el('small', s.submitterIdentity.studentId));
    name.append(el('small', s.id));
    const stateCell = el('td');
    stateCell.append(pill(s.status));
    const action = el('td');
    action.append(button('查看详情', () => guard(() => showRecord(s.id))));
    row.append(name, stateCell, el('td', `${s.files?.length || 0} 个`), el('td', formatTime(s.createdAt)), action);
    body.append(row);
  }
  table.append(head, body);
  wrap.append(table);
  root.append(wrap);
}

async function showRecord(id: string) {
  const data = await api<{
    submission: Submission;
    form: FormDefinition;
    submitterContact?: SubmitterContact;
  }>(`/submissions/${encodeURIComponent(id)}`);
  selected = data.submission;
  const content = q('[data-records-content]');
  content.replaceChildren();
  renderSubmission(content, data.submission, data.form, (e) => message(status, errorText(e), 'error'));
  if (data.submitterContact) {
    const contact = el('section', undefined, 'p-message');
    contact.append(el('strong', '当前账号与联系方式'));
    const meta = el('dl', undefined, 'p-meta');
    meta.append(
      el('dt', '学号'),
      el('dd', data.submitterContact.studentId || '待补充'),
      el('dt', '姓名'),
      el('dd', data.submitterContact.realName || '待补充'),
      el('dt', '昵称'),
      el('dd', nicknameOf(data.submitterContact) || '未设置'),
      el('dt', 'QQ 号'),
      el('dd', data.submitterContact.qq),
      el('dt', '邮箱'),
      el('dd', data.submitterContact.email)
    );
    contact.append(
      meta,
      button('复制联系方式', () =>
        copy(`${data.submitterContact!.studentId || ''} · ${data.submitterContact!.realName || data.submitterContact!.nickname} · QQ ${data.submitterContact!.qq} · ${data.submitterContact!.email}`, status)
      )
    );
    content.append(contact);
  }
  q('[data-records-review]').hidden = !data.form.requireReview || data.submission.status === 'uploading';
  q<HTMLTextAreaElement>('#record-review-comment').value = data.submission.review?.comment || '';
  q('[data-records-detail]').hidden = false;
  q('[data-records-detail]').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

q<HTMLFormElement>('[data-records-review]').addEventListener('submit', (event) => {
  event.preventDefault();
  const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
  if (!selected || !submitter) return;
  void guard(async () => {
    await busy(submitter, async () => {
      const id = selected!.id;
      await api(`/submissions/${encodeURIComponent(id)}/review`, {
        status: submitter.value,
        comment: q<HTMLTextAreaElement>('#record-review-comment').value,
        revision: selected!.revision,
      });
      await openRecords(activeForm!);
      await showRecord(id);
      message(status, '审核结果已保存，填写者可查看。', 'success');
    });
  });
});

q('[data-records-export]').addEventListener('click', () => {
  void guard(async () => {
    if (!activeForm) return;
    const response = await fetch(`/api/platform/admin/forms/${encodeURIComponent(activeForm.id)}/export`, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('导出失败，请刷新登录状态后重试。');
    saveBlob(await response.blob(), `${activeForm.title}-填写记录.csv`);
    message(status, '已导出此表全部记录，筛选条件不影响导出内容。', 'success');
  });
});

q('[data-admin-new]').addEventListener('click', () => openEditor(null));
q('[data-admin-refresh]').addEventListener('click', () => {
  void guard(refreshForms);
});
q('[data-admin-form-search]').addEventListener('input', renderForms);
q('[data-admin-form-filter]').addEventListener('change', renderForms);
q('[data-records-search]').addEventListener('input', renderRecords);
q('[data-records-filter]').addEventListener('change', renderRecords);
q('[data-records-close]').addEventListener('click', () => (q('[data-records-detail]').hidden = true));
q('[data-records-back]').addEventListener('click', () => panel('forms'));
q('[data-records-refresh]').addEventListener('click', () => {
  if (activeForm) void guard(() => openRecords(activeForm!));
});

window.addEventListener('beforeunload', (event) => {
  if (dirty) {
    event.preventDefault();
  }
});

void guard(async () => {
  identity = await session(true, true);
  if (!identity) return;
  q('[data-admin-platform]').hidden = false;
  await refreshForms();
  message(status);
});
