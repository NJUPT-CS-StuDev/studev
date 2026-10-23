import { api, busy, errorText, message, q, safeNext, type Session } from './platform-client';
const status = q<HTMLElement>('[data-auth-status]');
const login = q<HTMLFormElement>('[data-login-form]');
const register = q<HTMLFormElement>('[data-register-form]');
let mfaStudentId = '';
let authRevision = 0;
function resetLoginFactor() {
    authRevision++;
    mfaStudentId = '';
    const input = q<HTMLInputElement>('#login-totp');
    input.value = '';
    input.required = false;
    q('[data-login-totp]').hidden = true;
}
function showTab(name: string) { resetLoginFactor(); login.hidden = name !== 'login'; register.hidden = name !== 'register'; document.querySelectorAll<HTMLButtonElement>('[data-auth-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.authTab === name))); message(status); }
document.querySelectorAll<HTMLButtonElement>('[data-auth-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.authTab || 'login')));
q<HTMLInputElement>('#login-student-id').addEventListener('input', resetLoginFactor);
q<HTMLInputElement>('#login-student-id').addEventListener('change', resetLoginFactor);
q<HTMLInputElement>('#register-qq').addEventListener('input', () => {
  const qq = q<HTMLInputElement>('#register-qq').value.trim();
  q('[data-qq-email]').textContent = /^[1-9]\d{4,11}$/.test(qq)
    ? `联系邮箱：${qq}@qq.com`
    : '用于重要通知联系';
});
login.addEventListener('submit', async (e) => { e.preventDefault(); const b = q<HTMLButtonElement>('button[type=submit]', login); const studentId = q<HTMLInputElement>('#login-student-id').value.trim().toUpperCase(); if (mfaStudentId !== studentId) resetLoginFactor(); const revision = authRevision; try {
    await busy(b, async () => { const data = await api<Session & {
        mfaRequired?: boolean;
    }>('/auth/login', { studentId, password: q<HTMLInputElement>('#login-password').value, totp: mfaStudentId === studentId ? q<HTMLInputElement>('#login-totp').value.trim() || undefined : undefined }); if (revision !== authRevision) return; if (data.mfaRequired) {
        mfaStudentId = studentId;
        q('[data-login-totp]').hidden = false;
        q<HTMLInputElement>('#login-totp').required = true;
        q<HTMLInputElement>('#login-totp').focus();
        message(status, '密码已验证，请输入验证器动态码或恢复码。');
        return;
      }
      login.reset();
      try {
        if (data.user) {
          localStorage.setItem('studev_auth_user', JSON.stringify({
            nickname: data.user.nickname || data.user.studentId,
            role: data.user.role || 'member',
            verifiedAt: Date.now()
          }));
        }
      } catch {}
      location.assign(data.enrollmentRequired || data.passwordChangeRequired || data.profileRequired ? '/account/?setup=1' : safeNext(new URLSearchParams(location.search).get('next')));
    });
}
catch (e) {
    if (revision !== authRevision) return;
    const code = (e as {
        code?: string;
    }).code;
    if (code === 'MFA_REQUIRED' || code === 'TOTP_REQUIRED') {
        mfaStudentId = studentId;
        q('[data-login-totp]').hidden = false;
        q<HTMLInputElement>('#login-totp').required = true;
        q<HTMLInputElement>('#login-totp').focus();
    }
    message(status, errorText(e), 'error');
} });
register.addEventListener('submit', async (e) => { e.preventDefault(); const b = q<HTMLButtonElement>('button[type=submit]', register); try {
    if (q<HTMLInputElement>('#register-password').value !== q<HTMLInputElement>('#register-confirm').value)
        throw new Error('两次输入的密码不一致。');
    await busy(b, async () => { const qq = q<HTMLInputElement>('#register-qq').value.trim();const studentId=q<HTMLInputElement>('#register-student-id').value.trim().toUpperCase(); await api('/auth/register', { qq, studentId, realName: q<HTMLInputElement>('#register-real-name').value.trim(), password: q<HTMLInputElement>('#register-password').value, inviteCode: q<HTMLInputElement>('#register-invite').value.trim().toUpperCase() }); register.reset(); showTab('login'); q<HTMLInputElement>('#login-student-id').value = studentId; q<HTMLInputElement>('#login-password').focus(); message(status, '账号注册成功，请使用学号和新密码登录。', 'success'); });
}
catch (e) {
    message(status, errorText(e), 'error');
} });
void api<{
    registrationEnabled: boolean;
}>('/auth/config').then(c => { if (!c.registrationEnabled) {
    q<HTMLButtonElement>('[data-auth-tab=register]').hidden = true;
    register.hidden = true;
} }).catch(e => message(status, errorText(e), 'error'));

q<HTMLInputElement>('#register-student-id').addEventListener('blur',event=>{const input=event.currentTarget as HTMLInputElement;input.value=input.value.trim().toUpperCase();});

q<HTMLInputElement>('#login-student-id').addEventListener('blur',event=>{const input=event.currentTarget as HTMLInputElement;input.value=input.value.trim().toUpperCase();});

q<HTMLInputElement>('#register-invite')?.addEventListener('blur', event => {
  const input = event.currentTarget as HTMLInputElement;
  input.value = input.value.trim().toUpperCase();
});

const urlParams = new URLSearchParams(location.search);
const inviteParam = urlParams.get('invite') || urlParams.get('code');
const tabParam = urlParams.get('tab');
if (inviteParam) {
  const inviteInput = q<HTMLInputElement>('#register-invite');
  if (inviteInput) {
    inviteInput.value = inviteParam.trim().toUpperCase();
    showTab('register');
    message(status, '已自动填入社团邀请码', 'success');
  }
} else if (tabParam === 'register') {
  showTab('register');
}
