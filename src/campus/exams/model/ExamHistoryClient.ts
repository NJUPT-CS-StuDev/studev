import type { ExamChange, ExamSource } from '@/academics/facts';
import type { ExamSnapshotClient } from './ExamSnapshotClient';
export class ExamHistoryClient {
    readonly #examClient: ExamSnapshotClient;
    constructor(examClient: ExamSnapshotClient) { this.#examClient = examClient; }
    async initialize(signal?: AbortSignal): Promise<{sources: ExamSource[]; changes: ExamChange[]}> {
        const [{index}, changes] = await Promise.all([this.#examClient.initialize(signal), this.#examClient.changes(signal)]);
        return {sources: index.sources, changes};
    }
    async sources(signal?: AbortSignal): Promise<ExamSource[]> { return (await this.#examClient.initialize(signal)).index.sources; }
    async loadClass(className: string, signal?: AbortSignal): Promise<ExamChange[] | null> {
        const {index} = await this.#examClient.initialize(signal);
        if (!index.classes.includes(className)) return null;
        return (await this.#examClient.classFile(className, signal)).changes;
    }
    dispose(): void {}
}
