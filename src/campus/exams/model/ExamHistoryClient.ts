import type { ExamClassHistory, ExamHistoryEvents, ExamHistoryManifest } from '@/academics/exam/history';
import type { ExamSnapshotClient } from './ExamSnapshotClient';

export interface LoadedExamHistoryIndex {
    manifest: ExamHistoryManifest;
    events: ExamHistoryEvents;
}

/** Exam timetable changes; the data travels inside the exam index and class files. */
export class ExamHistoryClient {
    readonly #examClient: ExamSnapshotClient;

    constructor(examClient: ExamSnapshotClient) {
        this.#examClient = examClient;
    }

    get historyId(): string {
        return this.#examClient.snapshotId;
    }

    async initialize(signal?: AbortSignal): Promise<LoadedExamHistoryIndex> {
        const { index } = await this.#examClient.initialize(signal);
        return index.history;
    }

    async loadClass(className: string, signal?: AbortSignal): Promise<ExamClassHistory | null> {
        const { index } = await this.#examClient.initialize(signal);
        if (!index.classes.some(item => item.class_name === className)) return null;
        return (await this.#examClient.classFile(className, signal)).history;
    }

    dispose(): void {}
}
