import { api, avatarImg, avatarUrl, busy, button, copy, el, empty, errorText, formatTime, initPasswordToggles, labels, message, nameNode, nicknameOf, pill, q, saveBlob, session, type Session, type User } from './api';
import { isWithin, studentCenter } from '../organizations.mjs';

const status = q<HTMLElement>('[data-account-status]');
let current: Session | null = null;
let secret = '';
let recoveryCodes: string[] = [];
let avatarCacheBust = '';

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
  const url = new URL(location.href);
  if (name === 'profile') url.searchParams.delete('tab'); else url.searchParams.set('tab', name);
  history.replaceState(history.state, '', url);
  document.dispatchEvent(new CustomEvent('studev:account-tab', { detail: name }));
}

function renderIdCard(user: User) {
  const card = q('[data-account-id-card]');
  card.replaceChildren();

  const top = el('div', undefined, 'p-id-top');
  const img = avatarImg(user, { size: 0, width: 72, height: 72, className: 'p-id-avatar', cacheBust: avatarCacheBust });
  if (user.qq) {
    img.style.cursor = 'zoom-in';
    img.title = '点击查看 1080×1080 原图头像';
    img.addEventListener('click', () => window.open(avatarUrl(user, 0, avatarCacheBust), '_blank', 'noopener'));
  }

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
  for (const group of user.memberships ?? []) {
    const orgLine = el('div', undefined, 'p-actions');
    orgLine.style.gap = '8px';
    orgLine.append(el('span', group.organizationName, 'p-user-dept'));
    if (group.position) orgLine.append(el('span', group.position, 'p-id-org'));
    body.append(orgLine);
  }

  if (user.signature) {
    body.append(el('p', `“${user.signature}”`, 'p-id-sig'));
  }

  const linksRow = el('div', undefined, 'p-actions');
  linksRow.style.gap = '14px';
  linksRow.style.marginTop = '8px';
  if (user.memberships?.some(row => row.title && isWithin(row.organizationId, studentCenter.id))) {
    const archiveLink = el('a', '查看本届名册 ↗', 'p-link');
    const anchor = `#member-${user.id}`;
    archiveLink.href = `/history/${anchor}`;
    linksRow.append(archiveLink);
  }
  if (user.qq) {
    const refreshAvatarBtn = el('button', '刷新 QQ 头像', 'p-link');
    refreshAvatarBtn.type = 'button';
    refreshAvatarBtn.style.background = 'none';
    refreshAvatarBtn.style.border = '0';
    refreshAvatarBtn.style.padding = '0';
    refreshAvatarBtn.style.cursor = 'pointer';
    refreshAvatarBtn.style.fontFamily = 'inherit';
    refreshAvatarBtn.title = '刚在手机 QQ 换过头像？点击穿透缓存立即同步最新高清原图';
    refreshAvatarBtn.addEventListener('click', () => {
      avatarCacheBust = String(Date.now());
      renderIdCard(user);
      message(status, '已从腾讯官方 CDN 同步最新 1080P 高清头像。', 'success');
    });
    linksRow.append(refreshAvatarBtn);
  }
  if (linksRow.childNodes.length) {
    body.append(linksRow);
  }

  card.append(top, body);
}

function render() {
  q('[data-delete-email]').textContent = current?.user.email || '';
  q('[data-account-delete]').hidden = current?.user.role === 'owner';
  if (!current) return;
  const user = current.user;
  const incomplete = current.profileRequired || !user.profileComplete;
  renderIdCard(user);

  const info = q('[data-account-info]');
  info.replaceChildren();
  // The card above already says who one is (name, nickname, student ID, position, role); here only what it does not.
  const metaRows: [string, string][] = [
    ...(user.studentId ? [] : [['学号', '待补充'] as [string, string]]),
    ...(user.realName ? [] : [['姓名', '待补充'] as [string, string]]),
    ['QQ 号', user.qq],
    ['联系邮箱', user.email || `${user.qq}@qq.com`],
    ['账号状态', labels[user.status] ?? user.status],
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
  q('[data-account-mfa]').hidden = false;
  if (user.role === 'owner') {
    document.querySelectorAll<HTMLElement>('[data-owner-only]').forEach((n) => (n.hidden = false));
  }
  q('[data-password-totp]').hidden = !user.totpEnabled;
  q('[data-mfa-state]').textContent = user.totpEnabled
    ? '已开启双重验证（登录与修改密码时校验 6 位动态码）。'
    : user.role === 'owner'
      ? '平台所有者账号须绑定动态验证器。'
      : '可绑定认证器，登录时使用动态验证码或恢复码。';
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


document.querySelectorAll<HTMLButtonElement>('[data-account-tab]').forEach((b) =>
  b.addEventListener('click', () => {
    if (!current) return;
    const tab = b.dataset.accountTab || 'profile';
    switchTab(tab);
  })
);


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
        localStorage.removeItem(`studev_roster_${studentCenter.term}`);
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

q<HTMLFormElement>('[data-delete-request]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget as HTMLFormElement;
  try {
    await busy(q<HTMLButtonElement>('button[type=submit]', form), async () => {
      await api('/auth/account/delete', { password: q<HTMLInputElement>('#delete-password').value });
      form.reset();
      message(status, `注销确认信已发到 ${current?.user.email || '你的 QQ 邮箱'}，30 分钟内点信里的按钮完成注销。`, 'success');
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

async function loadAccount() {
  q('[data-account-retry]').hidden = true;
  message(status, '正在读取账号…');
  try {
    current = await session(false);
    if (!current) {
      try {
        localStorage.removeItem('studev_auth_user');
      } catch {}
      location.replace('/login/?next=' + encodeURIComponent(location.pathname + location.search));
      return;
    }
    document.querySelectorAll<HTMLElement>('[data-signed-in]').forEach((n) => (n.hidden = false));
    document.querySelectorAll<HTMLElement>('[data-staff-only]').forEach(n => n.hidden = current!.user.role === 'user');
    document.dispatchEvent(new CustomEvent('studev:account', { detail: { nickname: nicknameOf(current.user), role: current.user.role } }));
    render();
    message(status);
    initPasswordToggles();
    const tabParam = new URLSearchParams(location.search).get('tab');
    const setupBlocked = !!current.passwordChangeRequired || !!current.enrollmentRequired || !!current.mfaRequired || !!current.profileRequired || !current.user.profileComplete;
    const initialTab = current.profileRequired || !current.user.profileComplete ? 'profile'
      : setupBlocked ? 'security'
      : tabParam === 'security' || tabParam === 'devices' ? tabParam : 'profile';
    switchTab(initialTab);
    q<HTMLButtonElement>('[data-account-tab=devices]').hidden = setupBlocked;
  } catch (e) {
    message(status, errorText(e), 'error');
    q('[data-account-retry]').hidden = false;
  }
}
q('[data-account-retry]').addEventListener('click', () => { void loadAccount(); });
void loadAccount();
