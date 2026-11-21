import { api, avatarImg, avatarUrl, button, copy, el, empty, errorText, formatTime, labels, message, pill, q, session, type Session, type User } from './api';

// Staff columns and actions for the shared member directory.
const status = q<HTMLElement>('[data-members-status]');
let preview = false;
let current: Session | null = null;
let members: User[] = [];
const avatarCacheBust = '';
const unassigned = '暂未分配';

async function guard(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    message(status, errorText(e), 'error');
    status.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

async function confirmAction(title: string, description: string, password = false): Promise<string | null> {
  const dialog = q<HTMLDialogElement>('[data-platform-confirm]');
  q('[data-confirm-title]').textContent = title;
  q('[data-confirm-description]').textContent = description;
  q('[data-confirm-password-field]').hidden = !password;
  const input = q<HTMLInputElement>('#confirm-user-password');
  input.value = '';
  input.required = password;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) =>
    dialog.addEventListener(
      'close',
      () => {
        const result = password ? input.value : 'ok';
        input.value = '';
        resolve(dialog.returnValue === 'confirm' ? result : null);
      },
      { once: true }
    )
  );
}


async function editRosterModal(user: User): Promise<{
  studentId: string;
  realName: string;
  term: string;
  department: string;
  title: string;
  order: number;
  identityVerified: boolean;
} | null> {
  const dialog = q<HTMLDialogElement>('[data-roster-edit-modal]');
  const form = q<HTMLFormElement>('[data-roster-edit-form]');
  const errBox = q<HTMLElement>('[data-roster-edit-error]');
  const verifiedInput = q<HTMLInputElement>('#roster-edit-verified');
  q('[data-roster-edit-title]').textContent = `编辑档案 · ${user.realName || user.nickname}`;
  const studentInput = q<HTMLInputElement>('#roster-edit-student');
  const realNameInput = q<HTMLInputElement>('#roster-edit-real-name');
  studentInput.value = user.studentId;
  realNameInput.value = user.realName;
  const termInput = q<HTMLInputElement>('#roster-edit-term');
  const orderInput = q<HTMLInputElement>('#roster-edit-order');
  const deptInput = q<HTMLInputElement>('#roster-edit-department');
  const titleInput = q<HTMLInputElement>('#roster-edit-role-title');
  verifiedInput.checked = Boolean(user.identityVerified);
  termInput.value = user.term || '';
  orderInput.value = String(user.order ?? 999);
  deptInput.value = user.department || '';
  titleInput.value = user.title || '';
  errBox.hidden = true;
  errBox.textContent = '';

  const onSubmit = (e: SubmitEvent) => {
    const submitter = e.submitter as HTMLButtonElement | null;
    if (submitter?.value !== 'confirm') return;
    errBox.hidden = true;
  };
  form.addEventListener('submit', onSubmit);

  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        form.removeEventListener('submit', onSubmit);
        if (dialog.returnValue !== 'confirm') {
          resolve(null);
          return;
        }
        const parsedOrder = Number.parseInt(orderInput.value, 10);
        resolve({
          studentId: studentInput.value.trim().toUpperCase(),
          realName: realNameInput.value.trim(),
          term: termInput.value.trim(),
          department: deptInput.value.trim(),
          title: titleInput.value.trim(),
          order: Number.isSafeInteger(parsedOrder) && parsedOrder >= 0 && parsedOrder <= 9999 ? parsedOrder : 999,
          identityVerified: verifiedInput.checked,
        });
      },
      { once: true }
    );
  });
}

function openMemberCardModal(user: User) {
  const dialog = q<HTMLDialogElement>('[data-member-card-modal]');
  const body = q('[data-member-card-body]');
  body.replaceChildren();

  const top = el('div', undefined, 'p-id-top');
  top.style.marginBottom = '16px';
  const img = avatarImg(user, { size: 0, width: 68, height: 68, className: 'p-id-avatar', cacheBust: avatarCacheBust });
  if (user.qq) {
    img.style.cursor = 'zoom-in';
    img.title = '点击查看 1080×1080 原图头像';
    img.addEventListener('click', () => window.open(avatarUrl(user, 0, avatarCacheBust), '_blank', 'noopener'));
  }

  const titleWrap = el('div', undefined, 'p-id-title-wrap');
  const head = el('div', undefined, 'p-id-head');
  head.append(el('h2', user.realName || user.nickname));
  if (user.department) {
    head.append(el('span', user.department, 'p-user-dept'));
  }
  titleWrap.append(head);
  if (user.title) {
    titleWrap.append(el('p', user.title, 'p-id-sub'));
  }
  top.append(img, titleWrap);
  body.append(top);

  const meta = el('dl', undefined, 'p-meta');
  const rows: [string, string][] = [
    ['学号', user.studentId || '待补充'],
    ['所属部门', user.department || unassigned],
    ['职务分工', user.title || unassigned],
    ['所属届别', user.term ? `${user.term} 届` : '—'],
    ['QQ 号', user.qq],
    ['联系邮箱', user.email || `${user.qq}@qq.com`],
    ['管理权限', labels[user.role] || user.role],
  ];
  for (const [k, v] of rows) {
    meta.append(el('dt', k), el('dd', v));
  }
  body.append(meta);
  const card = el('details', undefined, 'p-public-card');
  card.append(el('summary', '公开名片'));
  const publicFields = el('dl', undefined, 'p-meta');
  publicFields.append(el('dt', '昵称'), el('dd', user.nickname || '—'), el('dt', '签名'), el('dd', user.signature || '—'));
  card.append(publicFields);
  body.append(card);

  const quickActions = el('div', undefined, 'p-actions');
  quickActions.style.marginTop = '18px';
  quickActions.append(
    button('复制 QQ 号', () => copy(user.qq, status)),
    button('复制邮箱', () => copy(user.email || `${user.qq}@qq.com`, status))
  );
  const mailLink = el('a', '发送邮件', 'p-button secondary small');
  mailLink.href = `mailto:${encodeURIComponent(user.email || `${user.qq}@qq.com`)}`;
  quickActions.append(mailLink);
  if (user.term && user.department) {
    const anchor = `#member-${user.id}`;
    const archiveLink = el('a', '在历届档案中定位名片 ↗', 'p-button secondary small');
    archiveLink.href = user.term === '2026-2027' ? `/history/${anchor}` : `/history/${encodeURIComponent(user.term)}/${anchor}`;
    quickActions.append(archiveLink);
  }
  body.append(quickActions);

  dialog.showModal();
}


let directorySignal: AbortSignal | undefined;
async function refreshMembers(signal = directorySignal) {
  const visit = directorySignal;
  const res = await api<{ items: User[] }>('/admin/users', undefined, { signal });
  if (visit?.aborted) return;
  members = res.items.sort((a, b) => (a.realName || a.nickname).localeCompare(b.realName || b.nickname, 'zh-CN') || a.id.localeCompare(b.id));
  const filter = q<HTMLSelectElement>('[data-manage-dept-filter]');
  const previous = filter.value;
  filter.replaceChildren(new Option('全部部门', ''), ...[...new Set(members.flatMap(user => user.department ? [user.department] : []))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN')).map(department => new Option(department, department)), new Option('未分配部门', '__other__'));
  filter.value = [...filter.options].some(option => option.value === previous) ? previous : '';
  renderManagedMembers();
}

export function renderManagedMembers() {
  if (!current || directorySignal?.aborted) return;
  const isOwner = !preview && current.user.role === 'owner';
  const term = q<HTMLInputElement>('[data-members-search]').value.trim().normalize('NFKC').toLowerCase();
  const deptFilter = q<HTMLSelectElement>('[data-manage-dept-filter]').value;
  const roleFilter = q<HTMLSelectElement>('[data-manage-role-filter]').value;
  const visible = members.filter((user) => {
    if (deptFilter === '__other__' && user.department) return false;
    if (deptFilter && deptFilter !== '__other__' && user.department !== deptFilter) return false;
    // Role and position are independent: this filter is the role alone; the department filter covers position.
    if (roleFilter && user.role !== roleFilter) return false;
    return [user.studentId, user.realName, user.qq, user.nickname, user.department, user.title].join(' ').normalize('NFKC').toLowerCase().includes(term);
  });

  q('[data-members-count]').textContent = `${visible.length} / ${members.length} 人`;
  const head = q<HTMLTableSectionElement>('[data-members-list] thead');
  const body = q<HTMLTableSectionElement>('[data-members-list] tbody');
  const headings = el('tr');
  for (const label of ['成员', '学号', '部门', '职务', '管理权限', '操作']) {
    const heading = el('th', label);
    heading.scope = 'col';
    headings.append(heading);
  }
  head.replaceChildren(headings);
  body.replaceChildren();
  for (const user of visible) {
    const display = user.realName || user.nickname;
    const ref = user.studentId || user.qq;
    const isSelf = user.id === current?.user.id;
    const row = el('tr');

    const nameCell = el('td');
    const userBox = el('div', undefined, 'p-user-cell');
    const img = avatarImg(user, { size: 140, width: 42, height: 42, className: 'p-user-avatar', lazy: true, cacheBust: avatarCacheBust });
    img.style.cursor = 'pointer';
    img.addEventListener('click', () => openMemberCardModal(user));

    const infoBox = el('div', undefined, 'p-user-info');
    const nameBtn = el('button', undefined, 'p-user-name-btn');
    nameBtn.type = 'button';
    nameBtn.append(el('strong', display));
    nameBtn.addEventListener('click', () => openMemberCardModal(user));
    infoBox.append(nameBtn);
    userBox.append(img, infoBox);
    nameCell.append(userBox);

    const studentCell = el('td', user.studentId || '—', 'p-member-student');
    const deptCell = el('td', user.department || unassigned, user.department ? undefined : 'p-muted');
    const titleCell = el('td', user.title || unassigned, user.title ? undefined : 'p-muted');
    const mayManage = !preview && (isOwner || user.role === 'user');
    const roleCell = el('td');
    if (isOwner && !isSelf && user.role !== 'owner') {
      const select = el('select', undefined, 'p-input');
      select.style.minWidth = '104px';
      select.style.padding = '6px 9px';
      select.style.minHeight = '34px';
      select.setAttribute('aria-label', `${display}的角色`);
      for (const roleValue of ['user', 'admin']) {
        const option = el('option', labels[roleValue]);
        option.value = roleValue;
        select.append(option);
      }
      select.value = user.role;
      select.addEventListener('change', () => {
        const next = select.value as 'user' | 'admin';
        // The owner sets and lifts admins directly, as a group owner does; admin and position are independent.
        void guard(async () => {
          if ((await confirmAction('调整成员角色', `将 ${display}（${ref}）设为${labels[next]}？`)) === null) {
            select.value = user.role;
            return;
          }
          await api(`/admin/users/${encodeURIComponent(user.id)}`, { revision: user.revision, role: next });
          await refreshMembers();
          message(status, '成员角色已更新。', 'success');
        }).finally(() => (select.value = user.role));
      });
      roleCell.append(select);
    } else {
      const pillsWrap = el('div', undefined, 'p-pills');
      pillsWrap.append(pill(user.role));
      if (user.status !== 'active') pillsWrap.append(pill(user.status));
      roleCell.append(pillsWrap);
    }

    // 5. 操作
    const actionsCell = el('td');
    const controls = el('div', undefined, 'p-actions');
    if (!mayManage) controls.append(el('span', '—', 'p-muted'));

    if (mayManage) {
      controls.append(
        button('编辑档案', () =>
          guard(async () => {
            const nextProfile = await editRosterModal(user);
            if (!nextProfile) return;
            await api(`/admin/users/${encodeURIComponent(user.id)}`, {
              revision: user.revision,
              ...nextProfile,
            });
            try {
              localStorage.removeItem('studev_roster_2026-2027');
            } catch {}
            await refreshMembers();
            if (isSelf) {
              current = await session(true);
            }
            message(status, '成员档案已保存并实时同步至历届档案。', 'success');
          })
        )
      );
    }

    if (mayManage && !isSelf) {
      const isPending = user.status === 'pending';
      if (isPending) controls.append(button('设置密码并激活', () => guard(async () => {
        const password = await confirmAction('激活账号', `核实 ${display}（${ref}）的身份后设置临时密码。对方首次登录必须修改密码。`, true);
        if (password === null) return;
        await api(`/admin/users/${encodeURIComponent(user.id)}/reset-password`, { password });
        const latest = await api<{ user: User }>(`/admin/users/${encodeURIComponent(user.id)}`);
        await api(`/admin/users/${encodeURIComponent(user.id)}`, { revision: latest.user.revision, status: 'active' });
        await refreshMembers();
        message(status, '账号已激活，请向本人安全交付临时密码。', 'success');
      })));
      if (!isPending) {
        controls.append(
          button(
            user.status === 'active' ? '停用' : '启用',
            () =>
              guard(async () => {
                if ((await confirmAction(user.status === 'active' ? '停用账号' : '启用账号', `${display}（${ref}）${user.status === 'active' ? '将无法登录，旧会话立即失效。' : '将恢复登录权限。'}`)) === null) return;
                await api(`/admin/users/${encodeURIComponent(user.id)}`, { revision: user.revision, status: user.status === 'active' ? 'disabled' : 'active' });
                await refreshMembers();
                message(status, '账号状态已更新。', 'success');
              }),
            user.status === 'active' ? 'danger small' : 'secondary small'
          ),
          button('重置密码', () =>
            guard(async () => {
              const password = await confirmAction('重置成员密码', `为 ${display}（${ref}）设置临时密码。对方下次登录须修改密码。`, true);
              if (password === null) return;
              await api(`/admin/users/${encodeURIComponent(user.id)}/reset-password`, { password });
              message(status, '密码已重置。', 'success');
            })
          )
        );
      }
      if (user.totpEnabled) {
        controls.append(
          button(
            '重置验证器',
            () =>
              guard(async () => {
                if ((await confirmAction('重置验证器', `确认重置 ${display} 的两步验证器？`)) === null) return;
                await api(`/admin/users/${encodeURIComponent(user.id)}/reset-totp`, {});
                await refreshMembers();
                message(status, '验证器已重置。', 'success');
              }),
            'danger small'
          )
        );
      }
      controls.append(
        button(
          '删除',
          () =>
            guard(async () => {
              if ((await confirmAction('彻底删除账号', `确认彻底删除 ${display}（${ref}）的账号？删除后不可恢复。`)) === null) return;
              await api(`/admin/users/${encodeURIComponent(user.id)}/delete`, {}, { method: 'POST' });
              await refreshMembers();
              message(status, '账号已删除。', 'success');
            }),
          'danger small'
        )
      );
    }

    actionsCell.append(controls);
    const cells = [nameCell, studentCell, deptCell, titleCell, roleCell, actionsCell];
    cells.forEach((cell, index) => { cell.dataset.label = headings.cells[index]!.textContent; });
    row.append(...cells);
    body.append(row);
  }

  message(status, visible.length ? '' : '没有匹配的成员。');
}

const auditLabels: Record<string, string> = {
  'identity.owner.initialized': '初始化所有者',
  'identity.registered': '注册账号',
  'identity.profile.bound': '绑定实名身份',
  'identity.profile.updated': '修改个人资料',
  'identity.profile.corrected': '更正实名信息',
  'identity.verification.updated': '核验身份状态',
  'identity.password.changed': '修改密码',
  'identity.totp.enabled': '绑定验证器',
  'identity.totp.disabled': '停用验证器',
  'identity.password.reset': '重置密码',
  'identity.totp.reset': '重置验证器',
  'identity.user.updated': '调整成员档案与权限',
  'identity.user.deleted': '删除账号',
  'identity.user.seeded': '预录在编成员',
  'identity.roster.synced': '同步历届名录',
  'form.create': '新建表单',
  'form.update': '修改表单',
  'form.duplicate': '复制表单',
  'form.delete': '删除表单',
  'submission.review': '审核提交',
  'submission.edit': '修改提交',
};

function resolveAuditEntity(idOrTarget: unknown): string {
  const raw = String(idOrTarget || '').trim();
  if (!raw) return '—';
  const u = members.find((item) => item.id === raw);
  if (u) return `${u.realName || u.nickname}${u.studentId ? `（${u.studentId}）` : ''}`;
  if (current?.user.id === raw) return `${current.user.realName || current.user.nickname}${current.user.studentId ? `（${current.user.studentId}）` : ''}`;
  return raw;
}

function formatAuditDetails(details: unknown): string {
  if (!details || typeof details !== 'object') return '—';
  const d = details as Record<string, unknown>;
  const parts: string[] = [];
  if (d.department) parts.push(`部门：${d.department}`);
  if (d.role) parts.push(`角色：${labels[String(d.role)] || d.role}`);
  if (d.status) parts.push(`状态：${labels[String(d.status)] || d.status}`);
  if (typeof d.totalCount === 'number') parts.push(`在编 ${d.totalCount} 人`);
  return parts.length ? parts.join(' · ') : JSON.stringify(details);
}

async function refreshAudit() {
  const [result] = await Promise.all([
    api<{ items: Record<string, unknown>[] }>('/admin/audit'),
    !members.length ? api<{ items: User[] }>('/admin/users').then(result => { members = result.items; }) : Promise.resolve(),
  ]);
  const root = q('[data-audit-list]');
  root.replaceChildren();
  if (!result.items.length) {
    root.append(empty('暂无操作记录', '关键账号和表单操作会在这里留下记录。'));
    return;
  }
  const wrap = el('div', undefined, 'p-table-wrap');
  const table = el('table', undefined, 'p-table');
  const head = el('thead');
  const titles = el('tr');
  for (const label of ['时间', '操作', '操作者', '对象', '详情']) titles.append(el('th', label));
  head.append(titles);
  const body = el('tbody');
  for (const item of result.items) {
    const row = el('tr');
    const actor = typeof item.actor === 'object' && item.actor !== null ? (item.actor as Record<string, unknown>) : null;
    const actorName = actor ? String(actor.realName || actor.nickname || actor.qq || actor.id || '系统') : resolveAuditEntity(item.actorId || '系统');
    row.append(
      el('td', formatTime(String(item.createdAt || item.time || ''))),
      el('td', auditLabels[String(item.action)] || String(item.action || '—')),
      el('td', actorName),
      el('td', resolveAuditEntity(item.target)),
      el('td', formatAuditDetails(item.details))
    );
    body.append(row);
  }
  table.append(head, body);
  wrap.append(table);
  root.append(wrap);
}

export async function showManagement(who: Session, readOnly: boolean, signal: AbortSignal, visit: AbortSignal) {
  current = who;
  preview = readOnly;
  directorySignal = visit;
  members = [];
  await refreshMembers(signal);
}

export async function showAudit(who: Session) {
  current = who;
  const auditStatus = q('[data-audit-status]');
  message(auditStatus, '正在读取操作记录…');
  try {
    await refreshAudit();
    message(auditStatus);
  } catch (error) {
    message(auditStatus, errorText(error), 'error');
  }
}
