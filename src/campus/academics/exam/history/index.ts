export type ExamHistoryValue = string | number | string[] | number[] | null;
export type ExamHistoryChangeType = 'added' | 'removed' | 'changed';
export type ExamClassHistoryStatus = 'first_seen' | 'changed' | 'removed' | 'reappeared';
export type ExamHistoryEventStatus = 'baseline' | 'changed' | 'unchanged';

export interface ExamHistoryManifest {
    exam_period_id: string;
    academic_year: string;
    term_number: number;
    term_label: string;
    current_source_updated_at: string;
    observed_snapshot_count: number;
}

export interface ExamHistoryGlobalEvent {
    snapshot_id: string;
    previous_snapshot_id: string | null;
    source_updated_at: string;
    status: ExamHistoryEventStatus;
    total_records: number;
    total_classes: number;
    affected_class_count: number;
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
}

export interface ExamHistoryEvents {
    exam_period_id: string;
    observed_snapshot_count: number;
    events: ExamHistoryGlobalEvent[];
}

export interface ExamHistoryFieldChange {
    field: string;
    before: ExamHistoryValue;
    after: ExamHistoryValue;
}

export interface ExamHistoryChange {
    type: ExamHistoryChangeType;
    history_key: string;
    course_name: string;
    course_code: string;
    teacher: string;
    fields: ExamHistoryFieldChange[];
}

export interface ExamClassHistoryEvent {
    snapshot_id: string;
    previous_snapshot_id: string | null;
    source_updated_at: string;
    status: ExamClassHistoryStatus;
    previous_record_count: number;
    current_record_count: number;
    changes: ExamHistoryChange[];
}

export interface ExamClassHistory {
    class_name: string;
    class_key: string;
    observed_snapshot_count: number;
    affected_event_count: number;
    current_record_count: number;
    latest_affected_at: string | null;
    events: ExamClassHistoryEvent[];
}
