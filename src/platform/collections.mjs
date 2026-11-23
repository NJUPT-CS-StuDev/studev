import product from '../../product.json' with { type: 'json' };

export const pinnedCollectionLinks = [
  { id: product.forms.place, title: '地点拍照' },
  { id: product.forms.feedback, title: '意见反馈' },
  { id: product.forms.data, title: '补充校园数据' },
];

export const pinnedCollections = pinnedCollectionLinks.map(({ id }) => id);

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
