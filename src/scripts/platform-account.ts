import { api, avatarUrl, busy, copy, el, errorText, initPasswordToggles, labels, message, pill, q, saveBlob, session, type Session, type User } from './platform-client';
const status = q<HTMLElement>('[data-account-status]');
let current: Session | null = null;
let secret = '';
let recoveryCodes: string[] = [];

function renderIdCard(user: User) {
    const card = q('[data-account-id-card]');
    card.replaceChildren();
    const img = el('img', undefined, 'p-id-avatar');
    img.src = avatarUrl(user);
    img.alt = `${user.realName || user.nickname}的头像`;
    img.width = 72;
    img.height = 72;
    img.referrerPolicy = 'no-referrer';

    const body = el('div', undefined, 'p-id-body');
    const head = el('div', undefined, 'p-id-head');
    head.append(el('h2', user.realName || user.nickname), pill(user.role));
    if (user.identityVerified) {
        const verified = el('span', '已实名入档', 'p-pill');
        verified.dataset.state = 'active';
        head.append(verified);
    }
    body.append(head);

    const parts: string[] = [];
    if (user.studentId) parts.push(`学号 ${user.studentId}`);
    if (user.term) parts.push(`${user.term} 届`);
    if (user.department) parts.push(user.department);
    if (user.title) parts.push(user.title);
    if (parts.length) {
        body.append(el('p', parts.join(' · '), 'p-id-sub'));
    }

    if (user.signature) {
        body.append(el('p', `“${user.signature}”`, 'p-id-sig'));
    }

    if (user.term && user.department) {
        const archiveLink = el('a', '在历届档案中查看我的名片 ↗', 'p-link');
        archiveLink.href = `/history/${encodeURIComponent(user.term)}/#people`;
        archiveLink.style.display = 'inline-block';
        archiveLink.style.marginTop = '8px';
        body.append(archiveLink);
    }

    card.append(img, body);
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
        ['所属部门', user.department ? `${user.term ? user.term + ' · ' : ''}${user.department}${user.title ? '（' + user.title + '）' : ''}` : '普通成员'],
        ['QQ 号', user.qq],
        ['联系邮箱', user.email || `${user.qq}@qq.com`],
        ['角色', labels[user.role]],
        ['账号状态', labels[user.status]],
    ];
    for (const [key, value] of metaRows) {
        info.append(el('dt', key), el('dd', value));
    }
    q<HTMLInputElement>('#account-nickname').value = user.nickname;
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
    q('[data-account-admin]').hidden = !staff || !!incomplete || !!current.passwordChangeRequired || !!current.enrollmentRequired || !!current.mfaRequired;
    q('[data-password-totp]').hidden = !user.totpEnabled;
    q('[data-mfa-state]').textContent = user.totpEnabled
        ? '已开启双重验证（登录与修改密码时校验 6 位动态码）。'
        : user.role === 'owner'
            ? '平台所有者账号须绑定动态验证器。'
            : '可选安全增强：管理员可按需绑定动态验证器（非强制），日常表单管理无需动态码即可直接进入。';
    q('[data-totp-setup]').hidden = user.totpEnabled || !!current.passwordChangeRequired;
    if (!user.totpEnabled && current.passwordChangeRequired) q('[data-mfa-state]').textContent = '请先修改密码并重新登录，再绑定验证器。';
    const required = q('[data-account-required]');
    required.hidden = !current.enrollmentRequired && !current.passwordChangeRequired && !current.mfaRequired && !incomplete;
    required.textContent = current.passwordChangeRequired ? '当前使用临时密码，请先修改密码。' : current.enrollmentRequired ? '所有者账号请先绑定动态验证器。' : current.mfaRequired ? '请使用验证码重新登录。' : incomplete ? '请完善学号与姓名。' : '请完成安全设置。';
    required.dataset.kind = 'info';
    if (current.mfaRequired) {
        const login = el('a', '重新登录并验证', 'p-button secondary small');
        login.href = '/login/?next=%2Faccount%2F';
        required.append(el('br'), login);
    }
}
q<HTMLFormElement>('[data-profile-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = q<HTMLButtonElement>('button[type=submit]', e.currentTarget as HTMLFormElement);
    if (!current) return;
    try {
        await busy(b, async () => {
            const result = await api<{ user: User }>('/auth/profile', {
                nickname: q<HTMLInputElement>('#account-nickname').value.trim() || undefined,
                signature: q<HTMLInputElement>('#account-signature').value.trim(),
                ...(!current!.user.profileComplete ? {
                    studentId: q<HTMLInputElement>('#account-student-id').value.trim().toUpperCase(),
                    realName: q<HTMLInputElement>('#account-real-name').value.trim(),
                } : {}),
                revision: current!.user.revision,
            });
            current!.user = result.user;
            current = await session(true);
            render();
            message(status, '个人资料与签名已保存，并已同步至历届档案。', 'success');
        });
    } catch (e) {
        message(status, errorText(e), 'error');
    }
});
q<HTMLFormElement>('[data-password-form]').addEventListener('submit', async (e) => { e.preventDefault(); const b = q<HTMLButtonElement>('button[type=submit]', e.currentTarget as HTMLFormElement); try {
    await busy(b, async () => { await api('/auth/password', { currentPassword: q<HTMLInputElement>('#current-password').value, newPassword: q<HTMLInputElement>('#new-password').value, totp: q<HTMLInputElement>('#password-totp').value.trim() || undefined }); q<HTMLFormElement>('[data-password-form]').reset(); location.assign('/login/?next=%2Faccount%2F'); });
}
catch (e) {
    message(status, errorText(e), 'error');
} });
q<HTMLButtonElement>('[data-account-logout]').addEventListener('click', async (e) => { try {
    await busy(e.currentTarget as HTMLButtonElement, async () => { await api('/auth/logout', {}); try { localStorage.removeItem('studev_auth_user'); } catch {} location.assign('/login/'); });
}
catch (e) {
    message(status, errorText(e), 'error');
} });
q<HTMLFormElement>('[data-totp-setup]').addEventListener('submit', async (e) => { e.preventDefault(); const b = q<HTMLButtonElement>('button[type=submit]', e.currentTarget as HTMLFormElement); try {
    await busy(b, async () => { const data = await api<{
        secret: string;
        otpauthUrl: string;
    }>('/auth/totp/setup', { password: q<HTMLInputElement>('#setup-password').value }); q<HTMLFormElement>('[data-totp-setup]').reset(); secret = data.secret; q('[data-totp-secret]').textContent = secret; q('[data-totp-enrollment]').hidden = false; q('[data-totp-setup]').hidden = true; try {
        const QRCode = await import('qrcode');
        await QRCode.toCanvas(q<HTMLCanvasElement>('[data-totp-qr]'), data.otpauthUrl, { width: 220, margin: 2 });
    }
    catch {
        q('[data-totp-qr]').hidden = true;
    } q<HTMLInputElement>('#confirm-totp').focus(); message(status, '请添加验证器，然后输入动态码完成绑定。'); });
}
catch (e) {
    message(status, errorText(e), 'error');
} });
q<HTMLButtonElement>('[data-copy-secret]').addEventListener('click', () => { void copy(secret, status); });
q<HTMLFormElement>('[data-totp-confirm]').addEventListener('submit', async (e) => { e.preventDefault(); const b = q<HTMLButtonElement>('button[type=submit]', e.currentTarget as HTMLFormElement); try {
    await busy(b, async () => { const result = await api<{
        recoveryCodes: string[];
    }>('/auth/totp/confirm', { code: q<HTMLInputElement>('#confirm-totp').value.trim() }); recoveryCodes = result.recoveryCodes; secret = ''; q('[data-totp-secret]').replaceChildren(); const canvas = q<HTMLCanvasElement>('[data-totp-qr]'); canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height); q<HTMLFormElement>('[data-totp-confirm]').reset(); q('[data-totp-enrollment]').hidden = true; q('[data-recovery-codes]').textContent = recoveryCodes.join('\n'); q('[data-totp-recovery]').hidden = false; current = await session(true); render(); message(status, '验证器已绑定，请立即保存恢复码。', 'success'); });
}
catch (e) {
    message(status, errorText(e), 'error');
} });
q('[data-copy-recovery]').addEventListener('click', () => { void copy(`StuDev 恢复码\n${recoveryCodes.join('\n')}\n每枚仅可使用一次，请安全保管。`, status); });
q('[data-save-recovery]').addEventListener('click', () => saveBlob(new Blob([`StuDev 恢复码\n${recoveryCodes.join('\n')}\n每枚仅可使用一次，请安全保管。`], { type: 'text/plain;charset=utf-8' }), 'StuDev-恢复码.txt'));
q('[data-recovery-done]').addEventListener('click', () => { recoveryCodes = []; q('[data-recovery-codes]').replaceChildren(); q('[data-totp-recovery]').hidden = true; message(status, '已完成安全设置。', 'success'); });
window.addEventListener('pagehide', () => { secret = ''; recoveryCodes = []; q('[data-totp-secret]').replaceChildren(); q('[data-recovery-codes]').replaceChildren(); });
void (async () => { try {
    current = await session(true);
    if (current) {
        render();
        initPasswordToggles();
        message(status);
    }
}
catch (e) {
    message(status, errorText(e), 'error');
} })();
