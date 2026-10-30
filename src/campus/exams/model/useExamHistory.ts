import { useEffect, useState } from 'react';
import type { ExamChange, ExamSource } from '@/academics/facts';
import type { ExamHistoryClient } from './ExamHistoryClient';
interface ExamHistoryState {
    sources: ExamSource[]; changes: ExamChange[]; classChanges: ExamChange[] | null;
    loading: boolean; error: string | null; requestKey: string;
}
const initialState: ExamHistoryState = {sources: [], changes: [], classChanges: null, loading: false, error: null, requestKey: ''};
export function useExamHistory(client: ExamHistoryClient, className: string | null = null): ExamHistoryState {
    const [state, setState] = useState<ExamHistoryState>(initialState);
    const requestKey = className ?? '';
    useEffect(() => {
        const controller = new AbortController();
        void (async () => {
            // A class history reads just its class shard and sources; the landing reads all changes.
            const loaded = className ? null : await client.initialize(controller.signal);
            const classChanges = className ? await client.loadClass(className, controller.signal) : null;
            const sources = loaded?.sources ?? await client.sources(controller.signal);
            setState({sources, changes: loaded?.changes ?? [], classChanges, loading: false, error: null, requestKey});
        })().catch(error => {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            setState({...initialState, error: '更新记录暂时无法显示，考试查询不受影响。', requestKey});
        });
        return () => controller.abort();
    }, [className, client, requestKey]);
    return state.requestKey === requestKey ? state : {...initialState, loading: Boolean(className), requestKey};
}
