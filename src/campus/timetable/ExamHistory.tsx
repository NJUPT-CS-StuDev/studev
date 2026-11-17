import type { ExamRecord } from '@/world/data';
import type { ExamSource } from '@/world/facts';
import { CHANGE_NAMES, changeLines, examFileName, examHistory, examImpact, examTime, examVersionTime } from '@/world/exams';
import { courseName } from '@/world/names';

export function ExamSources({ files }: { files: ExamSource[] }) {
    return <ul className="xsources">{files.map(source => <li key={`${source.notice}:${source.url}`}>
        <span>{examFileName(source.file)}</span>
        {source.published && <small>{examTime(source.published.slice(0, 10))} 官方发布</small>}
        <span className="btns"><a href={source.notice} target="_blank" rel="noreferrer">官方公告</a><a href={source.url} target="_blank" rel="noreferrer">官方附件</a></span>
    </li>)}<li className="meta">历史公告可能撤回，部分附件需连接校园网。</li></ul>;
}

/** Latest arrangements lead the page; history and source lists open only when needed. */
export function ExamHistory({ record }: { record: ExamRecord }) {
    const versions = examHistory(record);
    const latest = versions[0];
    const lastChanged = versions.find(version => version.changes.length > 0);
    const affected = versions.filter(version => version.changes.length > 0).length;
    return <div className="xtrust">
        {record.checked && <p>最近核对 {examTime(record.checked)}</p>}
        {lastChanged && <p>本班最近变更 · {examVersionTime(lastChanged)}</p>}
        {latest && !latest.baseline && <p>{examImpact(false, latest.changes)}</p>}
        <details className="xhist">
            <summary>更新记录 · {versions.length} 版{affected > 0 ? ` · ${affected} 次影响本班` : ''}</summary>
            {versions.map(version => <details className="xversion" data-exam-version={version.id} key={version.id}>
                <summary>{examVersionTime(version)} · {examImpact(version.baseline, version.changes)}</summary>
                {version.changes.map((change, at) => <div key={at} className="xchange">
                    <span className={`xk ${change.change}`}>{CHANGE_NAMES[change.change]}</span>
                    <span className="m">{courseName(change.course.name)}{changeLines(change).map(text => <small key={text}>{text}</small>)}</span>
                </div>)}
                <details className="xhist"><summary>采用的文件 · {version.files.length} 份</summary><ExamSources files={version.files} /></details>
            </details>)}
        </details>
        {record.sources.length > 0 && <details className="xhist"><summary>当前官方来源 · {record.sources.length} 份</summary><ExamSources files={record.sources} /></details>}
    </div>;
}
