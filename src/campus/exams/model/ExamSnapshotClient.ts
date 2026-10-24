import type { ExamClassFile, ExamIndexFile } from '@/academics/exam';
import { getClassNameSearchResult } from '@/academics/exam/query';
import type { ClassLookupResult } from '@/academics/exam/query';
import { DATA_RELEASE } from '@/app/config/constants';
import { forwardAbort, waitForAbort } from '@/shared/lib/abort';
import { fetchJson } from '@/shared/lib/fetch';

export interface ExamSearchResult {
    classMode: ClassLookupResult;
    sourceUrl: string | null;
    sourceTitle: string | null;
    sourceUpdatedAt: string | null;
    snapshotId: string;
    examPeriodId: string;
}

export interface LoadedExamIndex {
    index: ExamIndexFile;
}

/** Reads the exam timetable: one index plus one file per class. */
export class ExamSnapshotClient {
    readonly #baseUrl: string;
    #indexPromise: Promise<LoadedExamIndex> | null = null;
    #activeSearchController: AbortController | null = null;
    #classFiles = new Map<string, Promise<ExamClassFile>>();

    constructor(baseUrl: string) {
        this.#baseUrl = baseUrl.replace(/\/+$/, '');
    }

    get snapshotId(): string {
        return DATA_RELEASE.version;
    }

    initialize(signal?: AbortSignal): Promise<LoadedExamIndex> {
        this.#indexPromise ??= fetchJson<ExamIndexFile>(`${this.#baseUrl}/index.json`)
            .then(index => ({ index }))
            .catch(error => {
                this.#indexPromise = null;
                throw error;
            });
        return waitForAbort(this.#indexPromise, signal);
    }

    /** The class file, shared with ExamHistoryClient. */
    classFile(className: string, signal?: AbortSignal): Promise<ExamClassFile> {
        let file = this.#classFiles.get(className);
        if (!file) {
            file = fetchJson<ExamClassFile>(`${this.#baseUrl}/classes/${encodeURIComponent(className)}.json`);
            file.catch(() => this.#classFiles.delete(className));
            this.#classFiles.set(className, file);
        }
        return waitForAbort(file, signal);
    }

    async search(inputValue: string, manualSelection: string | null, signal?: AbortSignal): Promise<ExamSearchResult> {
        this.#activeSearchController?.abort();
        const controller = new AbortController();
        this.#activeSearchController = controller;
        const detach = forwardAbort(signal, controller);
        try {
            const { index } = await this.initialize(controller.signal);
            let classMode = getClassNameSearchResult(index.classes.map(item => item.class_name), inputValue, manualSelection);
            if (classMode.mode === 'DETAIL') {
                const className = classMode.classes[0] as string;
                const file = await this.classFile(className, controller.signal);
                classMode = { mode: 'DETAIL', classes: [className], exams: file.exams };
            }
            return {
                classMode,
                sourceUrl: index.source_url,
                sourceTitle: index.source_title,
                sourceUpdatedAt: index.source_updated_at,
                snapshotId: this.snapshotId,
                examPeriodId: index.exam_period.id,
            };
        } finally {
            detach();
            if (this.#activeSearchController === controller) this.#activeSearchController = null;
        }
    }

    dispose(): void {
        this.#activeSearchController?.abort();
        this.#classFiles.clear();
    }
}
