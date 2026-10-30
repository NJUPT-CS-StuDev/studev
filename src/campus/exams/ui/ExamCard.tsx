import { examTimestamp, examDuration } from '@/exams/ui/examDateTime';
import { Check, Clock, MapPin, User, Users } from 'lucide-react';
import type { Exam } from '@/academics/exam/records';
import type { ExamExportStatus } from '../model/examSelection';
import { formatExamDisplayDate } from './examDateTime';

interface ExamCardProps {
    exam: Exam;
    isSelected: boolean;
    exportStatus: ExamExportStatus;
    onToggle: () => void;
}

const statusBadge = (status: ExamExportStatus): { text: string; description: string; className: string } | null => {
    if (status === 2) {
        return {
            text: '有更新',
            description: '相对本浏览器上次导出的日历有更新',
            className: 'bg-[var(--warning-bg)] text-[var(--warning-ink)] border-[var(--warning)] dark:bg-[var(--warning-bg)] dark:text-[var(--warning-ink)] dark:border-[var(--warning)]',
        };
    }
    if (status === 1) {
        return {
            text: '新增',
            description: '相对本浏览器上次导出的日历新增',
            className: 'bg-[var(--success-bg)] text-[var(--success)] border-[var(--success)] dark:bg-[var(--success-bg)] dark:text-[var(--success)] dark:border-[var(--success)]',
        };
    }
    return null;
};

export function ExamCard({ exam, isSelected, exportStatus, onToggle }: ExamCardProps) {
    const isValidTime = Boolean(exam.date && exam.start && exam.end);
    const badge = statusBadge(exportStatus);
    const borderClass = exportStatus === 2
        ? 'border-[var(--warning)]'
        : isSelected
            ? 'border-[var(--brand)]'
            : 'border-transparent';

    return (
        <label
            className={`
                block p-5 pl-4 transition-all duration-300 cursor-pointer group border-l-4
                hover:-translate-y-0.5 hover:shadow-[0_4px_12px_var(--shadow-soft)] dark:hover:shadow-none
                ${isSelected 
                    ? 'bg-[var(--alert-note)] dark:bg-[var(--brand)]/10 shadow-[0_1px_3px_var(--shadow-soft)]'
                    : 'opacity-70 grayscale-[0.5] hover:bg-[var(--surface)] dark:hover:bg-[var(--surface)]'
                }
                ${borderClass}
            `}
        >
            <div className="flex items-start gap-4">
                <div className="pt-1 relative">
                    <input 
                        type="checkbox" 
                        checked={isSelected}
                        onChange={onToggle}
                        className="sr-only peer"
                    />
                    <div className={`
                        w-5 h-5 rounded border flex items-center justify-center transition-colors duration-200
                        peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-[var(--color-google-blue)]
                        ${isSelected 
                            ? 'bg-[var(--color-google-blue)] border-[var(--color-google-blue)] dark:bg-[var(--color-google-blue-dark)] dark:border-[var(--color-google-blue-dark)]' 
                            : 'border-[var(--line)] dark:border-[var(--line)] bg-[var(--paper)] dark:bg-[var(--paper)] group-hover:border-[var(--muted)] dark:group-hover:border-[var(--muted)]'
                        }
                    `}>
                        {isSelected && (
                            <Check className="w-3.5 h-3.5 text-[var(--on-brand)] draw-check" aria-hidden="true" />
                        )}
                    </div>
                </div>
                
                <div className="flex-1">
                    <div className="flex justify-between items-start mb-2 gap-3">
                        <h3 className={`text-[18px] font-normal leading-snug ${isSelected ? 'text-[var(--color-google-blue)] dark:text-[var(--color-google-blue-dark)] group-hover:underline' : 'text-[var(--ink)] dark:text-[var(--ink)]'}`}>
                            {exam.course.name}
                        </h3>
                        {exam.campus && (
                            <span className="shrink-0 text-[12px] text-[var(--success)] dark:text-[var(--success)] bg-[var(--success-bg)] dark:bg-[var(--success-bg)]/20 px-2.5 py-0.5 rounded">
                                {exam.campus}
                            </span>
                        )}
                        {badge ? (
                            <span
                                aria-label={badge.description}
                                title={badge.description}
                                className={`shrink-0 rounded border px-2.5 py-0.5 text-[12px] font-medium ${badge.className}`}
                            >
                                {badge.text}
                            </span>
                        ) : null}
                    </div>
                    
                    <div className="text-[14px] text-[var(--muted)] dark:text-[var(--muted)] space-y-2.5 mt-1">
                        {isValidTime ? (
                            <div className="flex items-start gap-2">
                                <Clock className="w-4 h-4 mt-0.5 shrink-0 text-[var(--brand)] dark:text-[var(--brand)]" aria-hidden="true" />
                                <div>
                                    <span className="font-medium text-[var(--ink)] dark:text-[var(--ink)]">{formatExamDisplayDate(examTimestamp(exam, 'start'))}</span>
                                    <span className="mx-1 text-[var(--muted)]">至</span> 
                                    <span>{formatExamDisplayDate(examTimestamp(exam, 'end'))}</span>
                                    <span className="ml-2 text-[12px] px-1.5 py-0.5 bg-[var(--surface-sunken)] dark:bg-[var(--surface-raised)] rounded text-[var(--muted)] dark:text-[var(--muted)]">
                                        {examDuration(exam)} 分钟
                                    </span>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 text-[var(--danger)] dark:text-[var(--danger)]">
                                <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
                                <span><span className="font-medium">时间待定：</span> {[exam.date, exam.start + '-' + exam.end].join(' ') || '未发布'}</span>
                            </div>
                        )}
                        
                        <div className="flex items-start gap-2">
                            <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-[var(--danger)] dark:text-[var(--danger)]" aria-hidden="true" />
                            <span className="font-medium text-[var(--ink)] dark:text-[var(--ink)]">{exam.location || '待定'}</span>
                        </div>
                        
                        <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1 text-[13px] text-[var(--muted)] dark:text-[var(--muted)]">
                            {exam.course.code && (
                                <span className="flex items-center gap-1.5 bg-[var(--surface)] dark:bg-[var(--surface)] px-2 py-0.5 rounded border border-[var(--line)] dark:border-[var(--line)]">
                                    <span className="text-[var(--ink)] dark:text-[var(--ink)]">{exam.course.code}</span>
                                </span>
                            )}
                            <span className="flex items-center gap-1.5">
                                <User className="w-4 h-4 text-[var(--success)] dark:text-[var(--success)]" aria-hidden="true" />
                                {exam.teacher || '教师待定'}
                            </span>
                            <span className="flex items-center gap-1.5">
                                <Users className="w-4 h-4 text-[var(--warning-ink)] dark:text-[var(--warning-ink)]" aria-hidden="true" />
                                {exam.students == null ? '人数未公布' : `${exam.students} 人`}
                            </span>
                            {exam.note && <span className="italic">备注：{exam.note}</span>}
                        </div>
                    </div>
                </div>
            </div>
        </label>
    );
}
