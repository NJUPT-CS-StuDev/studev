import { api, avatarImg, button, el, empty, errorText, formatTime, labels, message, pill, q, type Session, type User } from './api';
import { organization, studentCenter } from '../organizations.mjs';
import { openMemberRecord, valueButton } from './member-record';

// Staff columns and actions for the shared member directory.
const status = q<HTMLElement>('[data-members-status]');
let preview = false;
let current: Session | null = null;
let members: User[] = [];
const unassigned = '暂未分配';
const orgFilter = q<HTMLSelectElement>('[data-manage-org-filter]');
const deptFilter = q<HTMLSelectElement>('[data-manage-dept-filter]');

function refreshFilters() {
  const byId = new Map([[studentCenter.id, studentCenter.name]]);
  for (const user of members) for (const group of user.memberships || []) byId.set(group.organizationId, group.organizationName);
  const then = orgFilter.value;
  orgFilter.replaceChildren(new Option('全部组织', ''), ...[...byId].map(([id, name]) => new Option(name, id)));
  orgFilter.value = byId.has(then) ? then : '';
  const scope = organization(orgFilter.value || studentCenter.id);
  const department = deptFilter.value;
  deptFilter.replaceChildren(new Option('全部部门', ''), ...(scope?.departments ?? []).map(name => new Option(name, name)), new Option(unassigned, '__other__'));
  deptFilter.value = [...deptFilter.options].some(item => item.value === department) ? department : '';
  deptFilter.hidden = !scope?.departments.length;
}
orgFilter.addEventListener('change', () => { deptFilter.value = ''; refreshFilters(); });

const archive = q<HTMLButtonElement>('[data-members-archive]');
archive.addEventListener('click', () => void guard(async () => {
  const term = studentCenter.term;
  if (await confirmAction('归档本届名册', `封存 ${term} 届当前公开名册。归档后这份名单固定保存。`) === null) return;
  const { snapshot } = await api<{ snapshot: { term: string; totalCount: number } }>('/admin/roster/archive', {});
  message(status, `已归档 ${snapshot.term} 届名册 · ${snapshot.totalCount} 人。`, 'success');
}));

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


let directorySignal: AbortSignal | undefined;
async function refreshMembers(signal = directorySignal) {
  const visit = directorySignal;
  const res = await api<{ items: User[] }>('/admin/users', undefined, { signal });
  if (visit?.aborted) return;
  members = res.items.sort((a, b) => (a.realName || a.nickname).localeCompare(b.realName || b.nickname, 'zh-CN') || a.id.localeCompare(b.id));
  refreshFilters();
  renderManagedMembers();
}

export function renderManagedMembers() {
  if (!current || directorySignal?.aborted) return;
  const isOwner = !preview && current.user.role === 'owner';
  const term = q<HTMLInputElement>('[data-members-search]').value.trim().normalize('NFKC').toLowerCase();
  const department = deptFilter.value;
  const scope = orgFilter.value || studentCenter.id;
  const affiliation = (user: User) => user.memberships?.find(row => row.organizationId === scope);
  const roleFilter = q<HTMLSelectElement>('[data-manage-role-filter]').value;
  const visible = members.filter((user) => {
    const belongs = affiliation(user);
    if (orgFilter.value && !belongs) return false;
    if (department === '__other__' && belongs?.department) return false;
    if (department && department !== '__other__' && belongs?.department !== department) return false;
    // Role and position are independent: this filter is the role alone; the department filter covers position.
    if (roleFilter && user.role !== roleFilter) return false;
    const groups = user.memberships?.flatMap(row => [row.organizationName, row.department, row.position]) ?? [];
    return [user.studentId, user.realName, user.qq, user.nickname, ...groups].join(' ').normalize('NFKC').toLowerCase().includes(term);
  });

  q('[data-members-count]').textContent = `${visible.length} / ${members.length} 人`;
  const head = q<HTMLTableSectionElement>('[data-members-list] thead');
  const body = q<HTMLTableSectionElement>('[data-members-list] tbody');
  const headings = el('tr');
  for (const label of ['成员', '学号', 'QQ 号', '部门', '职务', '管理权限', '操作']) {
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
    const mayManage = !preview && (isOwner || user.role === 'user');
    const openRecord = (focusEdit: boolean) => openMemberRecord(user, mayManage, updated => {
      members = members.map(member => member.id === updated.id ? updated : member);
      refreshFilters();
      renderManagedMembers();
    }, focusEdit);

    const nameCell = el('td');
    const userBox = el('div', undefined, 'p-user-cell');
    const img = avatarImg({ realName: user.realName, nickname: user.nickname, avatarUrl: `/api/platform/members/${user.id}/avatar` }, { width: 42, height: 42, className: 'p-user-avatar', lazy: true });
    const avatar = button('', () => openRecord(false), 'record-avatar');
    avatar.setAttribute('aria-label', `查看${display}的档案`);
    avatar.append(img);

    const infoBox = el('div', undefined, 'p-user-info');
    const nameBtn = el('button', undefined, 'p-user-name-btn');
    nameBtn.type = 'button';
    nameBtn.append(el('strong', display));
    nameBtn.addEventListener('click', () => openRecord(false));
    infoBox.append(nameBtn);
    const groups = user.memberships?.map(group => group.organizationName).join(' · ');
    if (groups) infoBox.append(el('small', groups, 'p-muted'));
    userBox.append(avatar, infoBox);
    nameCell.append(userBox);

    const studentCell = el('td', undefined, 'p-member-student');
    studentCell.append(valueButton('学号', user.studentId, status));
    const qqCell = el('td', undefined, 'p-member-student');
    qqCell.append(valueButton('QQ 号', user.qq, status));
    const group = affiliation(user);
    const deptCell = el('td', group?.department || unassigned, group?.department ? undefined : 'p-muted');
    const titleCell = el('td', group?.position || unassigned, group?.position ? undefined : 'p-muted');
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

    if (mayManage) controls.append(button('编辑档案', () => openRecord(true)));

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
    const cells = [nameCell, studentCell, qqCell, deptCell, titleCell, roleCell, actionsCell];
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
  'identity.roster.synced': '更新本届名册',
  'identity.roster.archived': '归档本届名册',
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
  if (typeof d.count === 'number') parts.push(`${d.count} 人`);
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
