import { archiveAttachmentName } from '../../collections.mjs';
import { fail } from '../common.mjs';
import { mapConcurrent } from './records.mjs';
import { submissionWasLate } from './submissions.mjs';

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
  const rows = [['提交编号', '学号', '姓名', '提交时间', '状态', '是否补交', '审核说明', ...getLabels()]];
  for (const record of records) {
    const known = new Set(record.fields.map(signature));
    rows.push([record.id, record.studentId, record.studentName, record.submittedAt, record.status, submissionWasLate(record) ? '是' : '否', record.review?.comment,
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

export function fileManifest(item, round, records, answerFields) {
  return records.flatMap(record => {
    if (!record.files.length) return [];
    const labels = new Map(record.fields.map(({ id, label }) => [id, label]));
    const answers = answerFields.size
      ? Object.fromEntries(Object.entries(record.answers).filter(([id]) => answerFields.has(id))) : undefined;
    return record.files.map(({ id, fieldId, name, size, type }) => ({
      id, fieldId, name, size, type, studentId: record.studentId, studentName: record.studentName, submissionId: record.id,
      revision: record.revision, fieldLabel: labels.get(fieldId), archiveName: archiveAttachmentName(item, round, record, { fieldId, name }),
      ...(answers ? { answers } : {}),
    }));
  });
}

export function signAttachments(item, round, records, selection, download) {
  const bySubmission = new Map(records.map(record => [record.id, {
    record, files: new Map(record.files.map(file => [file.id, file])),
  }]));
  const picked = selection.map(({ id, submissionId, revision }) => {
    const current = bySubmission.get(submissionId);
    const file = current?.record.revision === revision && current.files.get(id);
    if (!file) fail(409, 'EXPORT_CHANGED', '提交记录或附件已有变动，请重新查看打包预览。');
    return { id, submissionId, revision, record: current.record, file, archiveName: archiveAttachmentName(item, round, current.record, file) };
  });
  return mapConcurrent(picked, 16, async ({ record, file, ...ref }) => ({ ...ref, download: await download(record, file, 600) }));
}
