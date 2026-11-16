// Email goes out through Resend's free plan (100 a day, 3000 a month, refused past that, never billed). The platform
// sends only account mail: a password-reset link, an account-deletion confirmation, and a note that a password has
// changed. A day's sending is capped below Resend's own limit, so a flood of requests is refused here first.
import { fail } from './common.mjs';

const FROM = 'StuDev <noreply@hicancan.top>';
export const DAILY_LIMIT = 90;

export function createMailer({ env, repo, send = resendSend }) {
  const enabled = typeof env.RESEND_API_KEY === 'string' && env.RESEND_API_KEY.length > 10;
  async function deliver({ to, subject, text, html }) {
    if (!enabled) fail(503, 'EMAIL_UNAVAILABLE', '邮件服务尚未配置，请联系管理员。');
    await repo.throttle('mail-day', 'all', DAILY_LIMIT, 86400);
    await send(env.RESEND_API_KEY, { from: FROM, to: [to], subject, text, html });
  }
  return { enabled, deliver };
}

async function resendSend(key, message) {
  const answer = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(15000),
  });
  if (!answer.ok) fail(503, 'EMAIL_FAILED', '邮件暂时发不出去，请稍后重试。');
}

const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** One plain message: a greeting, a few lines, an optional button, and a footer saying why it came. */
export function letter({ greeting, lines, action, footer }) {
  const text = [greeting, '', ...lines, ...(action ? ['', `${action.label}：${action.url}`] : []), '', footer].join('\n');
  const html = `<div style="font:15px/1.7 -apple-system,'PingFang SC','Microsoft YaHei',sans-serif;color:#1f2933;max-width:520px">
<p>${escape(greeting)}</p>${lines.map((line) => `<p>${escape(line)}</p>`).join('')}
${action ? `<p style="margin:24px 0"><a href="${escape(action.url)}" style="background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${escape(action.label)}</a></p><p style="color:#52606d;font-size:13px">按钮打不开时，复制这个链接到浏览器：<br>${escape(action.url)}</p>` : ''}
<p style="color:#7b8794;font-size:13px;margin-top:28px">${escape(footer)}</p></div>`;
  return { text, html };
}
