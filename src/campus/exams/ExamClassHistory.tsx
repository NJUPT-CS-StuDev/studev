import type { ExamHistoryClient } from './model/ExamHistoryClient';
import { useExamHistory } from './model/useExamHistory';
import { ExamHistoryPanel } from './ui/ExamHistoryPanel';

interface ExamClassHistoryProps {
    client: ExamHistoryClient;
    className: string;
}

export function ExamClassHistory({ client, className }: ExamClassHistoryProps) {
    const history = useExamHistory(client, className);
    return (
        <ExamHistoryPanel
            changes={history.classChanges}
            sources={history.sources}
            className={className}
            loading={history.loading}
            error={history.error}
        />
    );
}
