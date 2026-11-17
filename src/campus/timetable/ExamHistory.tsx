import { useState } from 'react';
import type { ExamRecord } from '@/world/data';
import type { ExamSource } from '@/world/facts';
import { CHANGE_NAMES, changeLines, examFileName, examHistory, examImpact, examTime, examVersionTime } from '@/world/exams';
import { courseName } from '@/world/names';

export function ExamSources({ files }: { files: ExamSource[] }) {
    const groups = new Map<string, ExamSource[]>();
    for (const source of files) groups.set(source.notice, [...(groups.get(source.notice) ?? []), source]);
    return <div className="xsources">{[...groups].map(([notice, adopted]) => {
        const first = adopted[0]!;
        const attachments = new Map<string, number>();
        for (const source of adopted) if (source.url && source.url !== notice) attachments.set(source.url, (attachments.get(source.url) ?? 0) + 1);
        return <div className="xsource-group" key={notice}>
            <a className="xsource-notice" href={notice} target="_blank" rel="noreferrer" aria-label={`官方公告：${first.title || '考试安排'}`}>
                <span>{first.title || '官方公告'} <span aria-hidden="true">↗</span></span>
                {first.published && <small>{examTime(first.published.slice(0, 10))} 官方发布</small>}
            </a>
            <ul className="xsource-files">{adopted.map(source => <li data-exam-file={source.file} key={source.file}>
                {attachments.get(source.url) === 1
                    ? <a href={source.url} target="_blank" rel="noreferrer" aria-label={`官方附件：${examFileName(source.file)}`}>{examFileName(source.file)} <span aria-hidden="true">↗</span></a>
                    : <span>{examFileName(source.file)}</span>}
            </li>)}{[...attachments].filter(([, count]) => count > 1).map(([url]) => <li key={url}><a href={url} target="_blank" rel="noreferrer">官方附件 <span aria-hidden="true">↗</span></a></li>)}</ul>
        </div>;
    })}</div>;
}

/** A single, truthful version spine; viewing history never changes which version is current. */
export function ExamHistory({ record }: { record: ExamRecord }) {
    const versions = examHistory(record);
    const latest = versions[0];
    const [chosen, choose] = useState<{ record: ExamRecord; id: string } | null>(null);
    const selected = chosen?.record === record && versions.some(version => version.id === chosen.id) ? chosen.id : latest?.id;
    const lastChanged = versions.find(version => version.changes.length > 0);
    const affected = versions.filter(version => version.changes.length > 0).length;
    return <div className="xtrust">
        {record.checked && <p>最近核对 {examTime(record.checked)}</p>}
        {lastChanged && <p>本班最近变更 · {examVersionTime(lastChanged)}</p>}
        <h3 className="xhistory-title">更新记录 <small>{versions.length} 版{affected > 0 ? ` · ${affected} 次影响本班` : ''}</small></h3>
        <ol className="xversions">{versions.map(version => {
            const current = version.id === latest?.id;
            const open = version.id === selected;
            return <li className={`xversion${current ? ' current' : ''}${open ? ' selected' : ''}`} data-exam-version={version.id} key={version.id}>
                <span className="xversion-node" aria-hidden="true" />
                <div className="xversion-card">
                    <button className="xversion-head" aria-expanded={open} onClick={() => choose({ record, id: version.id })}>
                        <span><strong>{examVersionTime(version)}</strong>{current && <span className="xcurrent">当前版本</span>}<small>{examImpact(version.baseline, version.changes)}</small></span>
                        <span className="xversion-chevron" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
                    </button>
                    {open && <div className="xversion-detail">
                        {version.changes.length > 0 && <section><h4>对本班的影响</h4>{version.changes.map((change, at) => <div key={at} className="xchange">
                            <span className={`xk ${change.change}`}>{CHANGE_NAMES[change.change]}</span>
                            <span className="m">{courseName(change.course.name)}{changeLines(change).map(text => <small key={text}>{text}</small>)}</span>
                        </div>)}</section>}
                        <section><h4>本版采用的文件 <small>{version.files.length} 份</small></h4><ExamSources files={version.files} /></section>
                    </div>}
                </div>
            </li>;
        })}</ol>
    </div>;
}
