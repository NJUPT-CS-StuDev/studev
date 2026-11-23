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
