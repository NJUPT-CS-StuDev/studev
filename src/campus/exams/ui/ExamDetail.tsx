import { examTimestamp } from '@/exams/ui/examDateTime';
import { lazy, Suspense, useState } from 'react';
import { Download, Share2 } from 'lucide-react';
import { buildExamCalendarFilename } from '../downloadFilename';
import { generateICSContent } from '@/academics/exam/calendar';
import type { Exam } from '@/academics/exam/records';
import type { ExamExportStatus } from '../model/examSelection';
import { ExamCard } from './ExamCard';

const ReminderSettings = lazy(() => import('./ReminderSettings').then(module => ({ default: module.ReminderSettings })));

type Notice = {
    message: string;
} | null;

interface ExamDetailProps {
    className: string;
    exams: Exam[];
    selectedIds: Set<string>;
    onToggleSelection: (id: string) => void;
    onSelectAll: () => void;
    onClearSelection: () => void;
    onExportComplete: (exams: Exam[]) => void;
    getExamStatus: (exam: Exam) => ExamExportStatus;
    reminders: number[];
    onRemindersChange: (reminders: number[]) => void;
    sourceUrl?: string | null;
    sourceTitle?: string | null;
    sourceUpdatedAt?: string | null;
    /** Course codes of the visitor's own timetable this term; null shows the class list as it is. */
    ownCodes?: Set<string> | null;
    /** Exams of courses the visitor added (retakes, electives), from other classes' lists. */
    addedIds?: Set<string>;
}

export function ExamDetail({
    className,
    exams,
    selectedIds,
    onToggleSelection,
    onSelectAll,
    onClearSelection,
    onExportComplete,
    getExamStatus,
    reminders,
    onRemindersChange,
    sourceUrl,
    sourceTitle,
    sourceUpdatedAt,
    ownCodes = null,
    addedIds = new Set(),
}: ExamDetailProps) {
    const [copyState, setCopyState] = useState<boolean>(false);
    const [notice, setNotice] = useState<Notice>(null);
    const allSelected = exams.length > 0 && selectedIds.size === exams.length;
    const noneSelected = selectedIds.size === 0;
    const sourceTime = sourceUpdatedAt;
    // With the visitor's timetable known, the class list splits into their own
    // exams and the ones other classmates sit (retakes, electives, language levels).
    const isOwn = (exam: Exam) => !ownCodes || addedIds.has(exam.id) || ownCodes.has(exam.course.code ?? '');
    const classExams = exams.filter(isOwn);
    const fewExams = exams.filter(exam => !isOwn(exam));
    const now = new Date().toISOString();
    const allPast = exams.length > 0 && exams.every(exam => examTimestamp(exam, 'end') && new Date(examTimestamp(exam, 'end')).toISOString() < now);
    const card = (exam: Exam, idx: number, list: Exam[]) => (
        <div key={exam.id || idx} className={idx !== list.length - 1 ? 'border-b border-[var(--line)] dark:border-[var(--line)]' : ''}>
            <ExamCard exam={exam} isSelected={selectedIds.has(exam.id)} exportStatus={getExamStatus(exam)} onToggle={() => onToggleSelection(exam.id)} />
        </div>
    );

    const showErrorNotice = (nextNotice: NonNullable<Notice>) => {
        setNotice(nextNotice);
        window.setTimeout(() => {
            setNotice(current => current?.message === nextNotice.message ? null : current);
        }, 3000);
    };

    const copyShareLink = () => {
        const url = window.location.href;
        if (!navigator.clipboard) {
            showErrorNotice({ message: '复制失败，请手动复制地址栏链接。' });
            return;
        }

        navigator.clipboard.writeText(url)
            .then(() => {
                setCopyState(true);
                setTimeout(() => setCopyState(false), 2000);
            })
            .catch(() => {
                showErrorNotice({ message: '复制失败，请手动复制地址栏链接。' });
            });
    };

    const downloadICS = () => {
        const selectedExams = exams.filter(e => selectedIds.has(e.id));
        const validExams = selectedExams.filter(e => examTimestamp(e, 'start') && examTimestamp(e, 'end'));

        if (validExams.length === 0) {
            showErrorNotice({ message: '至少选择一门有考试时间的课程。' });
            return;
        }

        try {
            const content = generateICSContent(validExams, className, reminders);
            const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = buildExamCalendarFilename(className);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
            onExportComplete(validExams);
        } catch (err) {
            console.error('ICS generation failed:', err);
            showErrorNotice({ message: '日历导出失败，请稍后重试。' });
        }
    };

    return (
        <div className="fade-in w-full">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
                <div>
                    <h2 className="text-[28px] font-normal text-[var(--ink)] dark:text-[var(--ink)] leading-tight mb-2">
                        {className} 考试安排
                    </h2>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-[var(--muted)] dark:text-[var(--muted)]">
                        <span>已选 {selectedIds.size} 门，共 {exams.length} 门</span>
                        <span>•</span>
                        <button
                            onClick={onSelectAll}
                            type="button"
                            disabled={allSelected}
                            className={`hover:underline transition-colors ${allSelected ? 'text-[var(--muted)] cursor-not-allowed no-underline' : 'text-[var(--color-google-blue)] dark:text-[var(--color-google-blue-dark)]'}`}
                        >
                            全选
                        </button>
                        <button
                            onClick={onClearSelection}
                            type="button"
                            disabled={noneSelected}
                            className={`hover:underline transition-colors ${noneSelected ? 'text-[var(--muted)] cursor-not-allowed no-underline' : 'text-[var(--color-google-blue)] dark:text-[var(--color-google-blue-dark)]'}`}
                        >
                            取消全选
                        </button>
                        <span>•</span>
                        <button
                            onClick={copyShareLink}
                            type="button"
                            className={`flex items-center gap-1 hover:underline transition-colors ${copyState ? 'text-[var(--success)]' : 'text-[var(--color-google-blue)] dark:text-[var(--color-google-blue-dark)]'}`}
                        >
                            <Share2 className="w-4 h-4" aria-hidden="true" />
                            {copyState ? '链接已复制' : '复制分享链接'}
                        </button>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[var(--muted)] dark:text-[var(--muted)]">
                        {sourceTitle ? (
                            sourceUrl ? (
                                <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--brand)] dark:text-[var(--brand)] hover:underline">
                                    来源：{sourceTitle}
                                </a>
                            ) : (
                                <span>来源：{sourceTitle}</span>
                            )
                        ) : null}
                        {sourceTime ? <span>{sourceTitle ? '• ' : ''}更新时间：{sourceTime.slice(0, 19).replace('T', ' ')}</span> : null}
                    </div>
                </div>
                <button
                    onClick={downloadICS}
                    disabled={selectedIds.size === 0}
                    aria-label="导出 ICS 日历文件"
                    className={`
                        inline-flex items-center justify-center gap-2 px-6 py-2 rounded-full text-[14px] font-medium transition-all shrink-0
                        ${selectedIds.size > 0
                            ? 'bg-[var(--color-google-blue)] hover:bg-[var(--brand)] text-[var(--on-brand)] shadow-sm'
                            : 'bg-[var(--surface)] dark:bg-[var(--surface)] text-[var(--muted)] cursor-not-allowed border border-[var(--line)] dark:border-[var(--line)]'}
                    `}
                >
                    <Download className="w-4 h-4" aria-hidden="true" />
                    导出日历
                </button>
            </div>

            {allPast ? (
                <div className="mb-4 rounded-xl border border-[var(--warning-line)] bg-[var(--warning-bg)] px-4 py-3 text-[14px] leading-relaxed text-[var(--warning-ink)] dark:border-[var(--warning-line)] dark:bg-[var(--warning-bg)] dark:text-[var(--warning-ink)]">
                    这些考试都已结束{sourceTitle ? `（${sourceTitle.replace(/^【[^】]*】/, '')}）` : ''}。本学期的考试安排公布后，这里会自动更新。
                </div>
            ) : null}

            {notice ? (
                <div className="mb-4 rounded-md border border-[var(--danger-line)] bg-[var(--danger-bg)] px-4 py-2 text-sm text-[var(--danger)] dark:border-[var(--danger-line)] dark:bg-[var(--danger-bg)] dark:text-[var(--danger)]">
                    {notice.message}
                </div>
            ) : null}

            <Suspense fallback={null}>
                <ReminderSettings selected={reminders} onChange={onRemindersChange} />
            </Suspense>

            <div className="space-y-0 border border-[var(--line)] dark:border-[var(--line)] rounded-lg overflow-hidden bg-[var(--paper)] dark:bg-[var(--paper)]">
                {classExams.map((exam, idx) => card(exam, idx, classExams))}
            </div>

            {fewExams.length ? (
                <details className="mt-5 group">
                    <summary className="cursor-pointer select-none text-[14px] font-medium text-[var(--brand)] dark:text-[var(--brand)]">
                        不在你课表里的考试（本班其他同学的重修、选修等）· {fewExams.length} 门
                    </summary>
                    <div className="mt-3 space-y-0 border border-[var(--line)] dark:border-[var(--line)] rounded-lg overflow-hidden bg-[var(--paper)] dark:bg-[var(--paper)]">
                        {fewExams.map((exam, idx) => card(exam, idx, fewExams))}
                    </div>
                </details>
            ) : null}

        </div>
    );
}
