import { mapConcurrent } from './records.mjs';

function csvCell(value) {
  let safe = Array.isArray(value) ? value.join('；') : String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+\-@]|^[\t\r\n]/.test(safe)) safe = "'" + safe;
  return '"' + safe.replace(/"/g, '""') + '"';
}

export function collectionCsv(item, round, records) {
  // Include earlier field labels and types so a schema edit does not erase
  // a historical answer from the export.
  const signature = ({ id, type, label }) => JSON.stringify([id, type, label]);
  const columns = new Map(round.fields.map((field) => [signature(field), field]));
  for (const record of records) {
    for (const field of record.fields) columns.set(signature(field), field);
  }
  const getLabels = () => {
    const totals = new Map(), seen = new Map();
    for (const { label } of columns.values()) totals.set(label, (totals.get(label) || 0) + 1);
    return [...columns.values()].map(({ label }) => {
      const part = (seen.get(label) || 0) + 1;
      seen.set(label, part);
      return totals.get(label) > 1 ? label + '（版本 ' + part + '）' : label;
    });
  };
  const rows = [['提交编号', '学号', '姓名', '提交时间', '状态', '审核说明', ...getLabels()]];
  for (const record of records) {
    const known = new Set(record.fields.map(signature));
    rows.push([record.id, record.studentId, record.studentName, record.submittedAt, record.status, record.review?.comment,
      ...[...columns].map(([key, field]) => {
        if (!known.has(key)) return '';
        if (field.type === 'file') return record.files.filter((file) => file.fieldId === field.id).map((file) => file.name).join('；');
        return record.answers[field.id];
      }),
    ]);
  }
  return new Response('\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="studev-' + item.id + '-' + round.id + '.csv"',
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function fileManifest(records, download) {
  return mapConcurrent(records.flatMap((record) => record.files.map((file) => ({ record, file }))), 16, async ({record, file}) => {
    const { id, fieldId, name, size, type } = file;
    return { id, fieldId, name, size, type, studentId: record.studentId, studentName: record.studentName, submissionId: record.id,
      download: await download(file, 600) };
  });
}
