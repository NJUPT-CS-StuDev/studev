import { useEffect, useState } from 'react';
import { errorText, PlatformError, read } from '../api';
import { badge } from './Submission';
import type { ProgressCounts, ProgressGroup, RoundProgress } from './model';

export function ProgressSummary({ label, selected, counts }: { label: string; selected: boolean; counts?: ProgressCounts }) {
    return <div className="cw-stats" role="group" aria-label={label}>
        {selected && <div><span>应交人数</span><strong>{counts?.total ?? '—'}</strong></div>}
        <div><span>{selected ? '已交人数' : '参与人数'}</span><strong>{counts?.submitted ?? '—'}</strong></div>
        {selected ? <div><span>未交人数</span><strong>{counts?.missing ?? '—'}</strong></div>
            : <div><span>提交份数</span><strong>{counts?.records ?? '—'}</strong></div>}
        {(selected || !!counts?.late) && <div><span>补交人数</span><strong>{counts?.late ?? '—'}</strong></div>}
    </div>;
}

export function GroupProgress({ group }: { group: ProgressGroup }) {
    return <>
        <span className="cw-board-group-name">{group.label}</span>
        {group.total ? <>
            <span className="cw-board-group-ratio"><strong>{group.submitted}</strong> / {group.total} 人已交</span>
            <progress aria-label={`${group.label}提交进度`} max={group.total} value={group.submitted} />
            <span className="cw-board-group-meta"><span>未交 {group.missing}</span><span>补交 {group.late}</span></span>
        </> : <span className="cw-board-group-ratio">{group.records} 份提交</span>}
    </>;
}

export function ParticipantProgress({ path, selected, version }: { path: string; selected: boolean; version: number }) {
    const [progress, setProgress] = useState<RoundProgress>();
    const [error, setError] = useState('');
    const [attempt, retry] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        read<{ progress: RoundProgress }>(path + '/submissions', result => { setProgress(result.progress); setError(''); }, controller.signal)
            .catch(failure => {
                if (controller.signal.aborted) return;
                const unavailable = failure instanceof PlatformError && [401, 403, 404].includes(failure.status);
                if (unavailable) setProgress(undefined);
                setError(unavailable ? '这项收集的提交进度暂未开放。' : errorText(failure));
            });
        return () => controller.abort();
    }, [path, version, attempt]);
    if (error) return <div className="cw-panel cw-board-empty cw-inline">
        <p role="alert" className="cw-failure">{error}</p>
        <button type="button" className="cw-button" onClick={() => { setError(''); retry(value => value + 1); }}>重试</button>
    </div>;
    if (!progress) return <p className="cw-panel cw-board-empty cw-muted" role="status">正在加载提交进度…</p>;
    const hasGroups = progress.groups.some(group => group.id);
    return <section className="cw-board">
        <div className="cw-participant-progress-head"><h2>提交进度</h2>
            {progress.ownStatus && <div className="cw-inline"><span className="cw-muted">我的状态</span>{badge(progress.ownStatus, progress.ownLate)}</div>}
        </div>
        <ProgressSummary label="批次汇总" counts={progress} selected={selected} />
        {hasGroups && <div className="cw-board-groups">
            <h3>各组织进度</h3>
            <div className="cw-board-group-list">{progress.groups.map(group => <div key={group.id} className="cw-board-group-card">
                <GroupProgress group={group} />
            </div>)}</div>
        </div>}
    </section>;
}
