import type { ExamHistoryClient } from './model/ExamHistoryClient';
import { useExamHistory } from './model/useExamHistory';
import { ExamHistorySummary } from './ui/ExamHistorySummary';

export function ExamHistoryLanding({ client }: { client: ExamHistoryClient }) {
    const history = useExamHistory(client);
    return (
        <ExamHistorySummary
            sources={history.sources}
            changes={history.changes}
            loading={history.loading}
            error={history.error}
        />
    );
}
