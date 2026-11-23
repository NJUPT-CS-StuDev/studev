import { api, avatarImg, button, el, empty, errorText, formatTime, labels, message, pill, q, type AcademicYear, type OrganizationNode, type Session, type User } from './api';
import { addDays } from '../../campus/world/time';
import { isWithin, namedOrganizations, organizationName, studentCenter } from '../organizations.mjs';
import { openMemberRecord, periodFields, valueButton } from './member-record';

// Staff columns and actions for the shared member directory.
const status = q<HTMLElement>('[data-members-status]');
let current: Session | null = null;
let members: User[] = [];
let organizations: OrganizationNode[] = [];
let academicYear: AcademicYear | undefined;
const unassigned = '暂未分配';
const orgFilter = q<HTMLSelectElement>('[data-manage-org-filter]');

function orgSelectLabel(org: OrganizationNode): string {
  return `${'　'.repeat(org.depth)}${org.depth ? '└ ' : ''}${org.name}`;
}

function refreshFilters() {
  const then = orgFilter.value;
  const options: HTMLOptionElement[] = [new Option('全部组织', '')];
  const seen = new Set<string>();
  for (const org of organizations) {
    seen.add(org.id);
    options.push(new Option(orgSelectLabel(org), org.id));
  }
  for (const user of members) {
    for (const group of user.memberships || []) {
      if (!seen.has(group.organizationId)) {
        seen.add(group.organizationId);
        options.push(new Option(group.organizationName, group.organizationId));
      }
    }
  }
  orgFilter.replaceChildren(...options);
  orgFilter.value = seen.has(then) ? then : '';
}

// Organization Tree Manager modal (owner only)
const orgModal = q<HTMLDialogElement>('[data-org-manager-modal]');
const orgListBox = q<HTMLElement>('[data-org-tree-list]');
const orgParentSelect = q<HTMLSelectElement>('[data-org-parent]');
const orgNameInput = q<HTMLInputElement>('[data-org-name]');
const orgKindSelect = q<HTMLSelectElement>('[data-org-kind]');
const orgTitlesInput = q<HTMLInputElement>('[data-org-titles]');
const orgModalStatus = q<HTMLElement>('[data-org-manager-status]');
const orgCreateForm = q<HTMLFormElement>('[data-org-create-form]');
q('[data-org-manager-close]').addEventListener('click', () => orgModal.close());

function renderOrgManager() {
  orgParentSelect.replaceChildren(
    new Option('作为顶级组织（无上级）', ''),
    ...organizations.map(org => new Option(orgSelectLabel(org), org.id))
  );
  const builtinIds = new Set(namedOrganizations.map(o => o.id));
  const list = el('div');
  for (const org of organizations) {
    const row = el('div', undefined, 'p-record-row');
    const nameWrap = el('span');
    nameWrap.style.paddingLeft = `${org.depth * 18}px`;
    nameWrap.textContent = `${org.depth ? '└ ' : ''}${org.name}`;
    const meta = el('span', org.titles.length ? org.titles.join(' / ') : (org.kind === 'academic' ? '教学与班级' : org.kind === 'club' ? '社团组织' : '组织'), 'p-muted');
    meta.style.fontSize = '0.8rem';
    row.append(nameWrap, meta);
    const hasChildren = organizations.some(o => o.parentId === org.id);
    if (!builtinIds.has(org.id) && !hasChildren) {
      row.append(button('删除', async () => {
        try {
          const res = await api<{ items: OrganizationNode[] }>(`/admin/organizations/${encodeURIComponent(org.id)}/delete`, {});
          organizations = res.items;
          renderOrgManager();
          refreshFilters();
          renderManagedMembers();
          message(orgModalStatus, `已删除组织「${org.name}」。`, 'success');
        } catch (e) {
          message(orgModalStatus, errorText(e), 'error');
        }
      }, 'danger small'));
    } else {
      row.append(el('span', builtinIds.has(org.id) ? '内置' : '', 'p-muted'));
    }
    list.append(row);
  }
  orgListBox.replaceChildren(list);
}

q('[data-members-orgs]').addEventListener('click', () => {
  message(orgModalStatus);
  renderOrgManager();
  orgModal.showModal();
});

orgCreateForm.addEventListener('submit', event => {
  event.preventDefault();
  void (async () => {
    try {
      const res = await api<{ organization: OrganizationNode; items: OrganizationNode[] }>('/admin/organizations', {
        name: orgNameInput.value.trim(),
        parentId: orgParentSelect.value || null,
        kind: orgKindSelect.value,
        titles: orgTitlesInput.value.trim(),
      });
      organizations = res.items;
      orgNameInput.value = '';
      orgTitlesInput.value = '';
      renderOrgManager();
      refreshFilters();
      message(orgModalStatus, `已添加组织「${res.organization.fullName}」。`, 'success');
    } catch (e) {
      message(orgModalStatus, errorText(e), 'error');
    }
  })();
});

// Batch Import Members modal (owner only)
const importModal = q<HTMLDialogElement>('[data-batch-import-modal]');
const batchOrgSelect = q<HTMLSelectElement>('[data-batch-org]');
const batchTitle = q<HTMLSelectElement>('[data-batch-title]');
const batchTitleField = q('[data-batch-title-field]');
const batchPeriod = q('[data-batch-period]');
const batchLinesInput = q<HTMLTextAreaElement>('[data-batch-lines]');
const batchStatus = q<HTMLElement>('[data-batch-import-status]');
const batchForm = q<HTMLFormElement>('[data-batch-import-form]');
q('[data-batch-import-close]').addEventListener('click', () => importModal.close());
const dates = periodFields();
batchPeriod.append(dates.start.wrapper, dates.end.wrapper);

function updateBatchPeriod() {
  const hasTitle = Boolean(batchTitle.value);
  batchPeriod.hidden = !hasTitle;
  const dated = hasTitle && isWithin(batchOrgSelect.value, studentCenter.id, organizations);
  dates.start.input.required = dates.end.input.required = dated;
  dates.start.input.value = dated && academicYear ? academicYear.startsOn : '';
  dates.end.input.value = dated && academicYear ? addDays(academicYear.endsBefore, -1) : '';
  dates.clearValidation();
}

function updateBatchTitles() {
  const titles = organizations.find(org => org.id === batchOrgSelect.value)?.titles ?? [];
  batchTitle.replaceChildren(new Option('仅添加组织归属', ''), ...titles.map(title => new Option(title, title)));
  batchTitleField.hidden = !titles.length;
  updateBatchPeriod();
}

batchOrgSelect.addEventListener('change', updateBatchTitles);
batchTitle.addEventListener('change', updateBatchPeriod);

q('[data-members-import]').addEventListener('click', () => {
  message(batchStatus);
  batchOrgSelect.replaceChildren(
    new Option('请选择归属组织', ''),
    ...organizations.map(org => new Option(orgSelectLabel(org), org.id))
  );
  updateBatchTitles();
  batchLinesInput.value = '';
  importModal.showModal();
});

batchForm.addEventListener('submit', event => {
  event.preventDefault();
  const interval = dates.interval();
  if (!interval) return;
  void (async () => {
    try {
      const res = await api<{ created: number; updated: number; skipped: number; total: number }>('/admin/users/batch', {
        organizationId: batchOrgSelect.value,
        title: batchTitle.value,
        lines: batchLinesInput.value,
        ...interval,
      });
      batchLinesInput.value = '';
      await refreshMembers();
      message(batchStatus, `导入完成：新建 ${res.created} 人，追加归属 ${res.updated} 人，已在组织内 ${res.skipped} 人。`, 'success');
    } catch (e) {
      message(batchStatus, errorText(e), 'error');
    }
  })();
});

async function guard(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    message(status, errorText(e), 'error');
    status.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

async function confirmAction(title: string, description: string, { password = false, factor = false } = {}) {
  if (factor && !current?.user.totpEnabled) {
    throw new Error('请先在「账号安全」中绑定验证器，再进行此操作。');
  }
  const dialog = q<HTMLDialogElement>('[data-platform-confirm]');
  q('[data-confirm-title]').textContent = title;
  q('[data-confirm-description]').textContent = description;
  q('[data-confirm-password-field]').hidden = !password;
  const input = q<HTMLInputElement>('#confirm-user-password');
  const code = q<HTMLInputElement>('#confirm-operator-factor');
  q('[data-confirm-factor-field]').hidden = !factor;
  input.value = '';
  input.required = password;
  code.value = '';
  code.required = factor;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise<{ password: string; totp: string } | null>((resolve) =>
    dialog.addEventListener(
      'close',
      () => {
        const result = { password: input.value, totp: code.value.trim() };
        input.value = '';
        code.value = '';
        resolve(dialog.returnValue === 'confirm' ? result : null);
      },
      { once: true }
    )
  );
}


let directorySignal: AbortSignal | undefined;
async function refreshMembers(signal = directorySignal) {
  const visit = directorySignal;
  const [res, orgRes] = await Promise.all([
    api<{ items: User[] }>('/admin/users', undefined, { signal }),
    api<{ items: OrganizationNode[]; academicYear: AcademicYear }>('/organizations', undefined, { signal }),
  ]);
  if (visit?.aborted) return;
  organizations = orgRes.items;
  academicYear = orgRes.academicYear;
  members = res.items.sort((a, b) => (a.realName || a.nickname).localeCompare(b.realName || b.nickname, 'zh-CN') || a.id.localeCompare(b.id));
  refreshFilters();
  renderManagedMembers();
}

export function renderManagedMembers() {
  if (!current || directorySignal?.aborted) return;
  const isOwner = current.user.role === 'owner';
  const term = q<HTMLInputElement>('[data-members-search]').value.trim().normalize('NFKC').toLowerCase();
  const scope = orgFilter.value;
  const orgList = organizations.length ? organizations : namedOrganizations;
  const affiliations = (user: User) => (user.memberships ?? []).filter(row => !scope || isWithin(row.organizationId, scope, orgList));
  const roleFilter = q<HTMLSelectElement>('[data-manage-role-filter]').value;
  const visible = members.filter((user) => {
    if (scope && !affiliations(user).length) return false;
    if (roleFilter && user.role !== roleFilter) return false;
    const groups = user.memberships?.flatMap(row => [row.organizationName, row.position]) ?? [];
    return [user.studentId, user.realName, user.qq, user.nickname, ...groups].join(' ').normalize('NFKC').toLowerCase().includes(term);
  });

  q('[data-members-count]').textContent = `${visible.length} / ${members.length} 人`;
  const head = q<HTMLTableSectionElement>('[data-members-list] thead');
  const body = q<HTMLTableSectionElement>('[data-members-list] tbody');
  const headings = el('tr');
  for (const label of ['成员', '学号', 'QQ 号', '组织与职务', '管理权限', '操作']) {
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
    const mayManage = isOwner || user.role === 'user';
    const openRecord = (focusEdit: boolean) => openMemberRecord(user, mayManage, updated => {
      members = members.map(member => member.id === updated.id ? updated : member);
      refreshFilters();
      renderManagedMembers();
    }, focusEdit, organizations, isOwner, academicYear);

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
    userBox.append(avatar, infoBox);
    nameCell.append(userBox);

    const studentCell = el('td', undefined, 'p-member-student');
    studentCell.append(valueButton('学号', user.studentId, status));
    const qqCell = el('td', undefined, 'p-member-student');
    qqCell.append(valueButton('QQ 号', user.qq, status));
    const titleCell = el('td', undefined, 'p-member-appointments');
    const assignments = el('ul', undefined, 'p-appointments');
    for (const group of affiliations(user).sort((a, b) => a.organizationName.localeCompare(b.organizationName, 'zh-CN'))) {
      const item = el('li');
      item.append(el('span', group.organizationName, 'p-muted'), el('span', group.position || unassigned, group.position ? undefined : 'p-muted'));
      if (group.startsOn && group.endsBefore) {
        item.append(el('span', `${group.startsOn} 至 ${addDays(group.endsBefore, -1)}`, 'p-muted p-appointment-dates'));
      }
      assignments.append(item);
    }
    titleCell.append(assignments.childElementCount ? assignments : el('span', unassigned, 'p-muted'));
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
          const verification = await confirmAction('调整成员角色', `将 ${display}（${ref}）设为${labels[next]}？`, { factor: true });
          if (!verification) return;
          await api(`/admin/users/${encodeURIComponent(user.id)}`, { revision: user.revision, role: next, totp: verification.totp });
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
        const verification = await confirmAction('激活账号', `核实 ${display}（${ref}）的身份后设置临时密码。对方首次登录必须修改密码。`, { password: true, factor: true });
        if (!verification) return;
        await api(`/admin/users/${encodeURIComponent(user.id)}/reset-password`, verification);
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
                if ((await confirmAction(user.status === 'active' ? '停用账号' : '启用账号', `${display}（${ref}）${user.status === 'active' ? '将无法登录，已登录的设备也会退出。' : '可以重新登录。'}`)) === null) return;
                await api(`/admin/users/${encodeURIComponent(user.id)}`, { revision: user.revision, status: user.status === 'active' ? 'disabled' : 'active' });
                await refreshMembers();
                message(status, '账号状态已更新。', 'success');
              }),
            user.status === 'active' ? 'danger small' : 'secondary small'
          ),
          button('重置密码', () =>
            guard(async () => {
              const verification = await confirmAction('重置成员密码', `为 ${display}（${ref}）设置临时密码。对方下次登录须修改密码。`, { password: true, factor: true });
              if (!verification) return;
              await api(`/admin/users/${encodeURIComponent(user.id)}/reset-password`, verification);
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
                const verification = await confirmAction('重置验证器', `确认重置 ${display} 的验证器？`, { factor: true });
                if (!verification) return;
                await api(`/admin/users/${encodeURIComponent(user.id)}/reset-totp`, { totp: verification.totp });
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
    const cells = [nameCell, studentCell, qqCell, titleCell, roleCell, actionsCell];
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
  'identity.trust.revoked': '取消设备信任',
  'identity.user.updated': '调整成员档案与权限',
  'identity.user.deleted': '删除账号',
  'identity.user.seeded': '预录在编成员',
  'identity.users.batch_imported': '批量导入成员',
  'organization.saved': '更新组织树',
  'organization.deleted': '删除组织',
  'collection.created': '发布收集',
  'collection.recipients.updated': '调整收集名单',
  'collection.deleted': '删除收集',
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

export async function showManagement(who: Session, signal: AbortSignal, visit: AbortSignal) {
  current = who;
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
