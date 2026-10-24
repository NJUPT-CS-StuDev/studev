import { api, avatarUrl, busy, button, copy, el, empty, errorText, formatTime, initPasswordToggles, labels, message, nameNode, nicknameOf, pill, q, saveBlob, session, type Session, type User } from './platform-client';

const status = q<HTMLElement>('[data-account-status]');
let current: Session | null = null;
let members: User[] = [];
let secret = '';
let recoveryCodes: string[] = [];

async function guard(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    message(status, errorText(e), 'error');
    status.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function switchTab(name: string) {
  document.querySelectorAll<HTMLElement>('[data-account-panel]').forEach((p) => {
    p.hidden = p.dataset.accountPanel !== name;
  });
  document.querySelectorAll<HTMLButtonElement>('[data-account-tab]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.accountTab === name));
  });
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

async function editRosterModal(user: User): Promise<{ nickname: string; term: string; department: string; title: string; signature: string; order: number } | null> {
  const dialog = q<HTMLDialogElement>('[data-roster-edit-modal]');
  q('[data-roster-edit-title]').textContent = `编辑档案 · ${user.realName || user.nickname}`;
  const termInput = q<HTMLInputElement>('#roster-edit-term');
  const orderInput = q<HTMLInputElement>('#roster-edit-order');
  const deptInput = q<HTMLInputElement>('#roster-edit-department');
  const titleInput = q<HTMLInputElement>('#roster-edit-role-title');
  const nickInput = q<HTMLInputElement>('#roster-edit-nickname');
  const sigInput = q<HTMLInputElement>('#roster-edit-signature');
  termInput.value = user.term || '2026-2027';
  orderInput.value = String(user.order ?? 999);
  deptInput.value = user.department || '';
  titleInput.value = user.title || '';
  nickInput.value = nicknameOf(user);
  sigInput.value = user.signature || '';
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        if (dialog.returnValue !== 'confirm') {
          resolve(null);
          return;
        }
        const parsedOrder = Number.parseInt(orderInput.value, 10);
        resolve({
          nickname: nickInput.value.trim(),
          term: termInput.value.trim(),
          department: deptInput.value.trim(),
          title: titleInput.value.trim(),
          signature: sigInput.value.trim(),
          order: Number.isSafeInteger(parsedOrder) && parsedOrder >= 0 && parsedOrder <= 9999 ? parsedOrder : 999,
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
  const img = el('img', undefined, 'p-id-avatar');
  img.src = avatarUrl(user);
  img.alt = `${user.realName || user.nickname}的头像`;
  img.width = 68;
  img.height = 68;
  img.referrerPolicy = 'no-referrer';

  const titleWrap = el('div', undefined, 'p-id-title-wrap');
  const head = el('div', undefined, 'p-id-head');
  head.append(nameNode('h2', user), pill(user.role));
  if (user.department) {
    head.append(el('span', user.department, 'p-user-dept'));
  }
  titleWrap.append(head);
  if (user.title) {
    titleWrap.append(el('p', user.title, 'p-id-sub'));
  }
  top.append(img, titleWrap);
  body.append(top);

  if (user.signature) {
    const sig = el('p', `“${user.signature}”`, 'p-id-sig');
    sig.style.marginBottom = '16px';
    body.append(sig);
  }

  const meta = el('dl', undefined, 'p-meta');
  const rows: [string, string][] = [
    ['学号', user.studentId || '待补充'],
    ['所属部门', user.department || '暂未分配'],
    ['职务分工', user.title || (user.department ? '部门成员' : '—')],
    ['所属届别', user.term ? `${user.term} 届` : '—'],
    ['QQ 号', user.qq],
    ['联系邮箱', user.email || `${user.qq}@qq.com`],
    ['群内角色', labels[user.role] || user.role],
  ];
  for (const [k, v] of rows) {
    meta.append(el('dt', k), el('dd', v));
  }
  body.append(meta);

  const quickActions = el('div', undefined, 'p-actions');
  quickActions.style.marginTop = '18px';
  quickActions.append(
    button('复制 QQ 号', () => copy(user.qq, status)),
    button('复制邮箱', () => copy(user.email || `${user.qq}@qq.com`, status))
  );
  if (user.term && user.department) {
    const anchor = user.realName ? `#member-${encodeURIComponent(user.realName)}` : '#people';
    const archiveLink = el('a', '在历届档案中定位名片 ↗', 'p-button secondary small');
    archiveLink.href = `/history/${encodeURIComponent(user.term)}/${anchor}`;
    quickActions.append(archiveLink);
  }
  body.append(quickActions);

  dialog.showModal();
}

function renderIdCard(user: User) {
  const card = q('[data-account-id-card]');
  card.replaceChildren();

  const top = el('div', undefined, 'p-id-top');
  const img = el('img', undefined, 'p-id-avatar');
  img.src = avatarUrl(user);
  img.alt = `${user.realName || user.nickname}的头像`;
  img.width = 72;
  img.height = 72;
  img.referrerPolicy = 'no-referrer';

  const titleWrap = el('div', undefined, 'p-id-title-wrap');
  const head = el('div', undefined, 'p-id-head');
  head.append(nameNode('h2', user), pill(user.role));
  if (user.identityVerified) {
    const verified = el('span', '已实名入档', 'p-pill');
    verified.dataset.state = 'active';
    head.append(verified);
  }
  titleWrap.append(head);
  if (user.studentId) {
    titleWrap.append(el('p', `学号 ${user.studentId}`, 'p-id-sub'));
  }
  top.append(img, titleWrap);

  const body = el('div', undefined, 'p-id-body');
  if (user.department || user.title) {
    const orgLine = el('div', undefined, 'p-actions');
    orgLine.style.gap = '8px';
    if (user.department) {
      orgLine.append(el('span', user.department, 'p-user-dept'));
    }
    if (user.title) {
      orgLine.append(el('span', user.title, 'p-id-org'));
    }
    body.append(orgLine);
  }

  if (user.signature) {
    body.append(el('p', `“${user.signature}”`, 'p-id-sig'));
  }

  if (user.term && user.department) {
    const archiveLink = el('a', '在历届档案中查看我的名片 ↗', 'p-link');
    const anchor = user.realName ? `#member-${encodeURIComponent(user.realName)}` : '#people';
    archiveLink.href = `/history/${encodeURIComponent(user.term)}/${anchor}`;
    archiveLink.style.display = 'inline-block';
    archiveLink.style.marginTop = '8px';
    body.append(archiveLink);
  }

  card.append(top, body);
}

function render() {
  if (!current) return;
  const user = current.user;
  const incomplete = current.profileRequired || !user.profileComplete;
  renderIdCard(user);

  const info = q('[data-account-info]');
  info.replaceChildren();
  const metaRows: [string, string][] = [
    ['学号', user.studentId || '待补充'],
    ['姓名', user.realName || '待补充'],
    ['昵称', nicknameOf(user) || '未设置'],
    ['所属部门', user.department || '暂未分配'],
    ['职务分工', user.title || (user.department ? '部门成员' : '—')],
    ['QQ 号', user.qq],
    ['联系邮箱', user.email || `${user.qq}@qq.com`],
    ['群内角色', labels[user.role]],
    ['账号状态', labels[user.status]],
  ];
  for (const [key, value] of metaRows) {
    info.append(el('dt', key), el('dd', value));
  }
  q<HTMLInputElement>('#account-nickname').value = nicknameOf(user);
  q<HTMLInputElement>('#account-signature').value = user.signature || '';
  q('[data-profile-identity]').hidden = !incomplete;
  const studentId = q<HTMLInputElement>('#account-student-id');
  studentId.value = user.studentId || '';
  studentId.required = !!incomplete;
  studentId.readOnly = !!user.studentId;
  const realName = q<HTMLInputElement>('#account-real-name');
  realName.value = user.realName || '';
  realName.required = !!incomplete;
  realName.readOnly = !!user.realName;
  const profileBlocked = !!current.passwordChangeRequired || !!current.enrollmentRequired || !!current.mfaRequired;
  q<HTMLButtonElement>('[data-profile-save]').textContent = incomplete ? '确认并绑定身份' : '保存个人资料';
  q<HTMLButtonElement>('[data-profile-save]').disabled = profileBlocked;
  q('[data-account-content]').hidden = false;
  q('[data-account-logout]').hidden = false;
  const staff = user.role !== 'member';
  q('[data-account-mfa]').hidden = !staff && !user.totpEnabled;
  if (user.role === 'owner') {
    document.querySelectorAll<HTMLElement>('[data-owner-only]').forEach((n) => (n.hidden = false));
  }
  q('[data-password-totp]').hidden = !user.totpEnabled;
  q('[data-mfa-state]').textContent = user.totpEnabled
    ? '已开启双重验证（登录与修改密码时校验 6 位动态码）。'
    : user.role === 'owner'
      ? '平台所有者账号须绑定动态验证器。'
      : '可选安全增强：管理员可按需绑定动态验证器（非强制），日常管理无需动态码即可直接进入。';
  q('[data-totp-setup]').hidden = user.totpEnabled || !!current.passwordChangeRequired;
  if (!user.totpEnabled && current.passwordChangeRequired) q('[data-mfa-state]').textContent = '请先修改密码并重新登录，再绑定验证器。';
  const required = q('[data-account-required]');
  required.hidden = !current.enrollmentRequired && !current.passwordChangeRequired && !current.mfaRequired && !incomplete;
  required.textContent = current.passwordChangeRequired
    ? '当前使用临时密码，请先修改密码。'
    : current.enrollmentRequired
      ? '所有者账号请先绑定动态验证器。'
      : current.mfaRequired
        ? '请使用验证码重新登录。'
        : incomplete
          ? '请完善学号与姓名。'
          : '请完成安全设置。';
  required.dataset.kind = 'info';
  if (current.mfaRequired) {
    const login = el('a', '重新登录并验证', 'p-button secondary small');
    login.href = '/login/?next=%2Faccount%2F';
    required.append(el('br'), login);
  }
}

async function refreshMembers() {
  const res = await api<{ items: User[] }>('/members');
  members = res.items;
  members.sort((a, b) => ((a.order ?? 999) - (b.order ?? 999)) || String(a.studentId || '').localeCompare(String(b.studentId || '')));
  renderMembers();
}

function renderMembers() {
  const isOwner = current?.user.role === 'owner';
  const isStaff = current?.user.role === 'owner' || current?.user.role === 'admin';
  const rosterCount = members.filter((u) => u.department).length;
  q('[data-members-summary]').textContent = `中心共有 ${rosterCount} 位在编成员，点击任意成员可查看完整档案名片与联系方式。`;

  const term = q<HTMLInputElement>('[data-members-search]').value.trim().toLowerCase();
  const deptFilter = q<HTMLSelectElement>('[data-members-dept-filter]').value;
  const visible = members.filter((user) => {
    if (deptFilter === '__other__' && user.department) return false;
    if (deptFilter && deptFilter !== '__other__' && user.department !== deptFilter) return false;
    return [user.studentId, user.realName, user.qq, user.nickname, user.department, user.title, user.signature].join(' ').toLowerCase().includes(term);
  });

  q('[data-members-count]').textContent = `${visible.length} / ${members.length} 人`;
  const root = q('[data-members-list]');
  root.replaceChildren();
  if (!visible.length) {
    root.append(empty('没有匹配成员', '尝试调整部门筛选或使用姓名、昵称、学号、QQ 号查找。'));
    return;
  }

  const wrap = el('div', undefined, 'p-table-wrap');
  const table = el('table', undefined, 'p-table');
  const head = el('thead');
  const headings = el('tr');
  for (const label of ['成员', '部门与职务', '角色', '联系方式', '操作']) {
    headings.append(el('th', label));
  }
  head.append(headings);

  const body = el('tbody');
  for (const user of visible) {
    const display = user.realName || user.nickname;
    const ref = user.studentId || user.qq;
    const isSelf = user.id === current?.user.id;
    const row = el('tr');

    // 1. 成员与签名
    const nameCell = el('td');
    const userBox = el('div', undefined, 'p-user-cell');
    const img = el('img', undefined, 'p-user-avatar');
    img.src = avatarUrl(user);
    img.alt = `${display}的头像`;
    img.width = 42;
    img.height = 42;
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.style.cursor = 'pointer';
    img.addEventListener('click', () => openMemberCardModal(user));

    const infoBox = el('div', undefined, 'p-user-info');
    const nameBtn = el('button', undefined, 'p-user-name-btn');
    nameBtn.type = 'button';
    nameBtn.append(nameNode('strong', user));
    nameBtn.addEventListener('click', () => openMemberCardModal(user));
    infoBox.append(nameBtn);
    infoBox.append(el('small', user.studentId ? `学号 ${user.studentId}` : '待补全学号'));
    if (user.signature) {
      infoBox.append(el('div', `“${user.signature}”`, 'p-user-sig'));
    }
    userBox.append(img, infoBox);
    nameCell.append(userBox);

    // 2. 部门与职务（清晰分层，不拼接长串）
    const deptCell = el('td');
    if (user.department) {
      deptCell.append(el('span', user.department, 'p-user-dept'));
      if (user.title) {
        deptCell.append(el('div', user.title, 'p-user-title'));
      }
    } else {
      deptCell.append(el('span', '暂未分配', 'p-muted'));
    }

    // 3. 群内角色
    const roleCell = el('td');
    if (isOwner && !isSelf && user.role !== 'owner') {
      const select = el('select', undefined, 'p-input');
      select.style.minWidth = '104px';
      select.style.padding = '6px 9px';
      select.style.minHeight = '34px';
      select.setAttribute('aria-label', `${display}的角色`);
      for (const roleValue of ['member', 'admin']) {
        const option = el('option', labels[roleValue]);
        option.value = roleValue;
        select.append(option);
      }
      select.value = user.role;
      select.addEventListener('change', () => {
        const next = select.value;
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

    // 4. 联系方式
    const contactCell = el('td', `QQ ${user.qq}`);
    contactCell.append(el('small', user.email || `${user.qq}@qq.com`));

    // 5. 操作
    const actionsCell = el('td');
    const controls = el('div', undefined, 'p-actions');
    controls.append(button('查看档案', () => openMemberCardModal(user)));

    if (isStaff) {
      controls.append(
        button('编辑档案', () =>
          guard(async () => {
            const nextProfile = await editRosterModal(user);
            if (!nextProfile) return;
            await api(`/members/${encodeURIComponent(user.id)}/profile`, {
              revision: user.revision,
              ...nextProfile,
            });
            try {
              localStorage.removeItem('studev_roster_2026-2027');
            } catch {}
            await refreshMembers();
            if (isSelf) {
              current = await session(true);
              render();
            }
            message(status, '成员档案已保存并实时同步至历届档案。', 'success');
          })
        )
      );
    }

    if (isOwner && !isSelf) {
      const isPending = user.status === 'pending';
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
    row.append(nameCell, deptCell, roleCell, contactCell, actionsCell);
    body.append(row);
  }

  table.append(head, body);
  wrap.append(table);
  root.append(wrap);
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
    !members.length ? refreshMembers().catch(() => {}) : Promise.resolve(),
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

document.querySelectorAll<HTMLButtonElement>('[data-account-tab]').forEach((b) =>
  b.addEventListener('click', () => {
    const tab = b.dataset.accountTab || 'profile';
    switchTab(tab);
    if (tab === 'members') void guard(refreshMembers);
    if (tab === 'audit') void guard(refreshAudit);
  })
);

q('[data-members-search]').addEventListener('input', renderMembers);
q('[data-members-dept-filter]').addEventListener('change', renderMembers);
q('[data-members-refresh]').addEventListener('click', () => {
  void guard(refreshMembers);
});
q('[data-audit-refresh]').addEventListener('click', () => {
  void guard(refreshAudit);
});

q<HTMLFormElement>('[data-profile-form]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const b = q<HTMLButtonElement>('button[type=submit]', e.currentTarget as HTMLFormElement);
  if (!current) return;
  try {
    await busy(b, async () => {
      const result = await api<{ user: User }>('/auth/profile', {
        nickname: q<HTMLInputElement>('#account-nickname').value.trim(),
        signature: q<HTMLInputElement>('#account-signature').value.trim(),
        ...(!current!.user.profileComplete
          ? {
              studentId: q<HTMLInputElement>('#account-student-id').value.trim().toUpperCase(),
              realName: q<HTMLInputElement>('#account-real-name').value.trim(),
            }
          : {}),
        revision: current!.user.revision,
      });
      current!.user = result.user;
      try {
        localStorage.removeItem(`studev_roster_${result.user.term || '2026-2027'}`);
      } catch {}
      current = await session(true);
      render();
      message(status, '个人资料与签名已保存，并已同步至历届档案与成员名录。', 'success');
    });
  } catch (e) {
    message(status, errorText(e), 'error');
  }
});

q<HTMLFormElement>('[data-password-form]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const b = q<HTMLButtonElement>('button[type=submit]', e.currentTarget as HTMLFormElement);
  try {
    await busy(b, async () => {
      await api('/auth/password', {
        currentPassword: q<HTMLInputElement>('#current-password').value,
        newPassword: q<HTMLInputElement>('#new-password').value,
        totp: q<HTMLInputElement>('#password-totp').value.trim() || undefined,
      });
      q<HTMLFormElement>('[data-password-form]').reset();
      location.assign('/login/?next=%2Faccount%2F');
    });
  } catch (e) {
    message(status, errorText(e), 'error');
  }
});

q<HTMLButtonElement>('[data-account-logout]').addEventListener('click', async (e) => {
  try {
    await busy(e.currentTarget as HTMLButtonElement, async () => {
      await api('/auth/logout', {});
      try {
        localStorage.removeItem('studev_auth_user');
      } catch {}
      location.assign('/login/');
    });
  } catch (e) {
    message(status, errorText(e), 'error');
  }
});

q<HTMLFormElement>('[data-totp-setup]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const b = q<HTMLButtonElement>('button[type=submit]', e.currentTarget as HTMLFormElement);
  try {
    await busy(b, async () => {
      const data = await api<{
        secret: string;
        otpauthUrl: string;
      }>('/auth/totp/setup', { password: q<HTMLInputElement>('#setup-password').value });
      q<HTMLFormElement>('[data-totp-setup]').reset();
      secret = data.secret;
      q('[data-totp-secret]').textContent = secret;
      q('[data-totp-enrollment]').hidden = false;
      q('[data-totp-setup]').hidden = true;
      try {
        const QRCode = await import('qrcode');
        await QRCode.toCanvas(q<HTMLCanvasElement>('[data-totp-qr]'), data.otpauthUrl, { width: 220, margin: 2 });
      } catch {
        q('[data-totp-qr]').hidden = true;
      }
      q<HTMLInputElement>('#confirm-totp').focus();
      message(status, '请添加验证器，然后输入动态码完成绑定。');
    });
  } catch (e) {
    message(status, errorText(e), 'error');
  }
});

q<HTMLButtonElement>('[data-copy-secret]').addEventListener('click', () => {
  void copy(secret, status);
});

q<HTMLFormElement>('[data-totp-confirm]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const b = q<HTMLButtonElement>('button[type=submit]', e.currentTarget as HTMLFormElement);
  try {
    await busy(b, async () => {
      const result = await api<{
        recoveryCodes: string[];
      }>('/auth/totp/confirm', { code: q<HTMLInputElement>('#confirm-totp').value.trim() });
      recoveryCodes = result.recoveryCodes;
      secret = '';
      q('[data-totp-secret]').replaceChildren();
      const canvas = q<HTMLCanvasElement>('[data-totp-qr]');
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      q<HTMLFormElement>('[data-totp-confirm]').reset();
      q('[data-totp-enrollment]').hidden = true;
      q('[data-recovery-codes]').textContent = recoveryCodes.join('\n');
      q('[data-totp-recovery]').hidden = false;
      current = await session(true);
      render();
      message(status, '验证器已绑定，请立即保存恢复码。', 'success');
    });
  } catch (e) {
    message(status, errorText(e), 'error');
  }
});

q('[data-copy-recovery]').addEventListener('click', () => {
  void copy(`StuDev 恢复码\n${recoveryCodes.join('\n')}\n每枚仅可使用一次，请安全保管。`, status);
});
q('[data-save-recovery]').addEventListener('click', () =>
  saveBlob(new Blob([`StuDev 恢复码\n${recoveryCodes.join('\n')}\n每枚仅可使用一次，请安全保管。`], { type: 'text/plain;charset=utf-8' }), 'StuDev-恢复码.txt')
);
q('[data-recovery-done]').addEventListener('click', () => {
  recoveryCodes = [];
  q('[data-recovery-codes]').replaceChildren();
  q('[data-totp-recovery]').hidden = true;
  message(status, '已完成安全设置。', 'success');
});

window.addEventListener('pagehide', () => {
  secret = '';
  recoveryCodes = [];
  q('[data-totp-secret]').replaceChildren();
  q('[data-recovery-codes]').replaceChildren();
});

void (async () => {
  try {
    current = await session(true);
    if (current) {
      render();
      initPasswordToggles();
      message(status);
      const setupBlocked = !!current.passwordChangeRequired || !!current.enrollmentRequired || !!current.mfaRequired || !!current.profileRequired || !current.user.profileComplete;
      if (!setupBlocked) {
        void refreshMembers().catch(() => {});
        const tabParam = new URLSearchParams(location.search).get('tab');
        if (tabParam === 'members' || (tabParam === 'audit' && current.user.role === 'owner')) {
          switchTab(tabParam);
          if (tabParam === 'audit') void guard(refreshAudit);
        }
      }
    }
  } catch (e) {
    message(status, errorText(e), 'error');
  }
})();
