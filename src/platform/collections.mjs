import product from '../../product.json' with { type: 'json' };

export const pinnedCollections = [product.forms.place, product.forms.feedback, product.forms.data];

export function isSemester(value) {
  const parts = typeof value === 'string' && /^(\d{4})-(\d{4})-([12])$/.exec(value);
  return Boolean(parts && Number(parts[2]) === Number(parts[1]) + 1);
}

export function semesterLabel(id) {
  const [start, end, number] = id.split('-');
  return `${start}–${end} 学年第${number === '1' ? '一' : '二'}学期`;
}
