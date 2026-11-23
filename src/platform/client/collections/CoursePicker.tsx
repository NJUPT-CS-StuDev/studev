import { useEffect, useId, useState } from 'react';
import { SearchClient } from 'wasm-search';
import { DATA_RELEASE, latestCampusRelease } from '../../../campus/world/config';

export interface CollectionCourse {
    id: string | null;
    code: string;
    name: string;
}

type SearchState = {
    query: string;
    items: CollectionCourse[];
    error?: string;
};

let courseClient: Promise<SearchClient> | undefined;
function courseSearch() {
    return courseClient ??= latestCampusRelease().then(release =>
        new SearchClient({ baseUrl: `${(release ?? DATA_RELEASE).base}/entities/course-search` }));
}

export default function CollectionCoursePicker({ value, onChange }: {
    value: CollectionCourse | null;
    onChange: (course: CollectionCourse | null) => void;
}) {
    const inputId = useId();
    const [input, setInput] = useState('');
    const [state, setState] = useState<SearchState>();
    const query = input.normalize('NFKC').trim();

    useEffect(() => {
        if (value || !query) return;
        let active = true;
        let requestId: number | undefined;
        let client: SearchClient | undefined;
        const timer = window.setTimeout(async () => {
            try {
                client = await courseSearch();
                await client.initialize();
                if (!active) return;
                const request = client.search({ query, sort: 'relevance', limit: 12, filters: {} });
                requestId = request.requestId;
                const response = await request.response;
                if (!active) return;
                const items = response.results.flatMap(result => result.section && result.id === `information/course-plan/${result.section}`
                    ? [{ id: result.id, code: result.section, name: result.title }] : []);
                setState({ query, items });
            } catch {
                if (active) setState({ query, items: [], error: '课程搜索暂不可用。可先发布，之后补充课程。' });
            }
        }, 160);
        return () => {
            active = false;
            window.clearTimeout(timer);
            if (requestId !== undefined) client?.cancel(requestId);
        };
    }, [query, value]);

    const result = state?.query === query ? state : undefined;
    return <div className="collection-course-picker">
        {value ? <>
            <span className="collection-course-selected">{value.name} · {value.code}</span>
            <button type="button" onClick={() => onChange(null)}>移除课程</button>
        </> : <>
            <label htmlFor={inputId}>课程（选填）</label>
            <input id={inputId} type="search" value={input} placeholder="搜索课程编号或名称" autoComplete="off"
                onFocus={() => void courseSearch().then(client => client.initialize()).catch(() => undefined)}
                onChange={event => setInput(event.target.value)} />
            {query && <div aria-live="polite" aria-busy={!result}>
                {result?.error || (!result ? '正在查找课程…' : !result.items.length ? '未找到课程。' : '')}
                {!!result?.items.length && <ul className="collection-course-results" aria-label="匹配课程">
                    {result.items.map(course => <li key={course.id}>
                        <button type="button" onClick={() => { setInput(''); onChange(course); }}>
                            {course.name} <span>{course.code}</span>
                        </button>
                    </li>)}
                </ul>}
            </div>}
        </>}
    </div>;
}
