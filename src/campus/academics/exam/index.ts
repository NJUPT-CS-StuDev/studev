import type { Exam } from './records';
import type { ExamClassHistory, ExamHistoryEvents, ExamHistoryManifest } from './history';

// Exam data as studev serves it: data/<release>/exams/.

export interface ExamPeriod {
    id: string;
    academic_year: string;
    term_number: number;
    term_label: string;
}

/** exams/index.json */
export interface ExamIndexFile {
    exam_period: ExamPeriod;
    source_url: string | null;
    source_title: string | null;
    source_updated_at: string;
    classes: Array<{ class_name: string; record_count: number }>;
    history: { manifest: ExamHistoryManifest; events: ExamHistoryEvents };
}

/** exams/classes/<class>.json */
export interface ExamClassFile {
    class_name: string;
    exams: Exam[];
    history: ExamClassHistory | null;
}
