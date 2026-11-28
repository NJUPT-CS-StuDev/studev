// Everything the platform does with a password, all of it in the Node function: the rule for choosing one and the
// scrypt hash that checks it. The edge never sees a password, so the edge build replaces this module with
// ./password.edge.mjs and the list of common passwords stays out of the edge bundle.
import { scrypt as scryptCallback } from 'node:crypto';
import { fail } from './common.mjs';
import common from './common-passwords.mjs';

const COMMON = new Set(common.split('\n'));

/** scrypt(N=16384, r=8, p=1) of a password and salt, as 64 hex digits. */
export function scrypt(password, salt) {
  return new Promise((resolve, reject) => scryptCallback(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
    (error, key) => error ? reject(error) : resolve(key.toString('hex'))));
}

// A guesser tries what people pick first: dates and phone numbers, runs and repeats, their own student ID or QQ, and
// the passwords that top leaked lists. Past those, eight characters already cost more guesses than the login limit and
// scrypt allow, so length beyond eight buys little and only makes people write passwords down.
function weakShape(password) {
  if (new Set(password).size <= 3) return true;
  const codes = [...password].map(char => char.codePointAt(0));
  const step = codes[1] - codes[0];
  return Math.abs(step) <= 1 && codes.every((code, i) => i === 0 || code - codes[i - 1] === step);
}

/** Why this password would be guessed early, or '' when it is fine. */
export function passwordProblem(password, owner = {}) {
  if (password.length < 8) return '密码至少需要 8 位。';
  if (password.length > 256) return '密码最多 256 位。';
  const lower = password.toLowerCase();
  if (/^\d+$/.test(password) && password.length < 12) return '纯数字密码容易被猜到（比如生日、手机号），加几个字母，或者用 12 位以上的数字。';
  if (weakShape(lower)) return '这个密码规律太明显（重复或连续的字符），换一个吧。';
  for (const own of [owner.studentId, owner.qq]) if (own && lower.includes(String(own).toLowerCase())) return '密码里不要包含学号或 QQ 号。';
  if (COMMON.has(lower)) return '这个密码太常见，很容易被猜到，换一个吧。';
  return '';
}

export function validatePassword(value, owner) {
  if (typeof value !== 'string') fail(400, 'PASSWORD_POLICY', '请填写密码。');
  const problem = passwordProblem(value, owner);
  if (problem) fail(400, 'PASSWORD_POLICY', problem);
  return value;
}
