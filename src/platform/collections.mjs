import product from '../../product.json' with { type: 'json' };

export const pinnedCollectionLinks = [
  { id: product.forms.place, title: '地点拍照' },
  { id: product.forms.feedback, title: '意见反馈' },
  { id: product.forms.data, title: '补充校园数据' },
];

export const pinnedCollections = pinnedCollectionLinks.map(({ id }) => id);

export const attachmentNameTokens = /** @type {const} */ (['学号', '姓名', '班级', '批次', '收集名称', '附件项', '原文件名']);
const attachmentNameToken = /\{([^{}]+)\}/g;
const knownNameTokens = new Set(attachmentNameTokens);

/** @param {string} pattern */
export function validAttachmentNamePattern(pattern) {
  const literals = pattern.replace(attachmentNameToken, (match, token) => knownNameTokens.has(token) ? '' : match);
  return !/[{}\/\\<>:"|?*\u0000-\u001f\u007f]/u.test(literals);
}

/** @param {string} value */
export function zipSegment(value) {
  const name = [...value.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_')
    .replace(/^[. ]+|[. ]+$/g, '')].slice(0, 75).join('').replace(/[. ]+$/g, '') || '未填写';
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? '_' + name : name;
}

/** @param {string} name */
export function splitAttachmentName(name) {
  const index = name.lastIndexOf('.');
  return index > 0 && index < name.length - 1 ? { stem: name.slice(0, index), extension: name.slice(index + 1) } : { stem: name, extension: '' };
}

/**
 * @param {string} pattern
 * @param {string} name
 * @param {(token: string) => string | undefined} valueForToken
 */
export function formatAttachmentName(pattern, name, valueForToken) {
  const { stem, extension } = splitAttachmentName(name);
  const result = pattern.replace(attachmentNameToken, (_match, token) => token === '原文件名' ? stem : valueForToken(token) ?? '');
  return zipSegment(result.trim() || stem) + (extension ? zipSegment('file.' + extension).slice(4) : '');
}

/** The original attachment stays intact. Both the student's record and the archive show this name. */
export function archiveAttachmentName(item, round, record, file) {
  const pattern = item?.attachmentNamePattern;
  if (!pattern) return;
  return formatAttachmentName(pattern, file.name, (token) => {
    switch (token) {
      case '学号': return record.studentId;
      case '姓名': return record.studentName;
      case '班级': return item.recipients.find(row => row.studentId === record.studentId)?.groupLabel || '待核对';
      case '批次': return round?.label;
      case '收集名称': return item.name;
      case '附件项': return record.fields.find(field => field.id === file.fieldId)?.label || '附件';
    }
  });
}

export function isSemester(value) {
  const parts = typeof value === 'string' && /^(\d{4})-(\d{4})-([12])$/.exec(value);
  return Boolean(parts && Number(parts[2]) === Number(parts[1]) + 1);
}

export function semesterLabel(id) {
  const [start, end, number] = id.split('-');
  return `${start}–${end} 学年第${number === '1' ? '一' : '二'}学期`;
}

export function deadlineReached(deadline, now) {
  return Boolean(deadline && Date.parse(deadline) <= now);
}

export function roundAcceptsSubmissions(item, round, now) {
  return item.status === 'published' && round.policy !== 'closed' &&
    (round.policy === 'allow-late' || !deadlineReached(round.deadline, now));
}

/**
 * @template {{id: string}} Round
 * @param {ReadonlyArray<Round>} rounds
 * @param {string} id
 * @param {(round: Round) => boolean} isOpen
 */
export function selectCollectionRound(rounds, id, isOpen) {
  return rounds.find(round => round.id === id) || rounds.find(isOpen) || rounds[0];
}

/**
 * A participant can have several effective submissions, but counts once in
 * progress. Their latest effective submission determines timeliness.
 * @template {{id: string, studentId?: string, personId?: string, expected: boolean, submissionId?: string, submittedAt?: string, complete?: boolean, status: string, late: boolean}} Row
 * @param {ReadonlyArray<Row>} rows
 * @param {boolean} selected
 */
export function collectionProgress(rows, selected) {
  const expected = new Map();
  const submissions = new Set();
  const latest = new Map();
  for (const row of rows) {
    const person = row.studentId || row.personId || row.id;
    if (row.expected && !expected.has(person)) expected.set(person, row);
    const complete = row.complete ?? (row.status !== 'missing' && row.status !== 'uploading');
    if (!complete || !row.submissionId) continue;
    submissions.add(row.submissionId);
    if (selected && !row.expected) continue;
    const previous = latest.get(person);
    const time = row.submittedAt || '';
    const previousTime = previous?.submittedAt || '';
    if (!previous || time > previousTime || (time === previousTime && row.submissionId > previous.submissionId)) {
      latest.set(person, row);
    }
  }
  return {
    counts: {
      total: selected ? expected.size : null,
      submitted: latest.size,
      missing: selected ? expected.size - latest.size : null,
      late: [...latest.values()].filter(row => row.late).length,
      records: submissions.size,
    },
    missingRows: selected ? [...expected].filter(([person]) => !latest.has(person)).map(([, row]) => row) : [],
  };
}
