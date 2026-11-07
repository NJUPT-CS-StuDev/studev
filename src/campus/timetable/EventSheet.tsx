import { runTally, type CampusEvent, type RunPlan } from '@/world/events';
import { courseName, isRoom, roomLabel, unplaced } from '@/world/names';
import { dateLabel, hm, momentText, WEEKDAYS, weekdayOf } from '@/world/time';
import { Chevron, Sheet } from '@/world/ui';

const whoLink = (type: string, id: string) => `/?who=${type}:${encodeURI(id)}&scale=week`;

export function EventSheet({ event, isMe, run, onClose, onHide, onSkipExam, onRan, onPlan }: { event: CampusEvent; isMe: boolean; run: RunPlan | null; onClose: () => void; onHide: (event: CampusEvent) => void; onSkipExam: (event: CampusEvent) => void; onRan: () => void; onPlan: () => void }) {
    const when = `${WEEKDAYS[weekdayOf(event.date)]} ${dateLabel(event.date)} · ${hm(event.start)}–${hm(event.end)}`;
    if (event.kind === 'run' && run) {
        const place = run.rule.xianlin;
        return (
            <Sheet title="早锻炼" onClose={onClose}>
                <div className="meta">{when}</div>
                <div className="btns"><button className="btn" onClick={onRan}>{event.runMark === 'done' ? '已记为跑过' : '记为跑过'}</button>{place && <a className="btn go" href={`/map/?nav=${encodeURI(`仙林/${place.route[0]}`)}`}>去起点</a>}</div>
                {place && <div className="kv"><span className="k">路线</span><span className="v">{place.route.join(' ↔ ')}，约 {place.metres} 米</span></div>}
                {place && <div className="kv"><span className="k">刷脸</span><span className="v">起点 {place.start_scan_end} 前，终点 {place.end_scan_end} 前<small>{place.male_minutes === place.female_minutes ? `${place.male_minutes} 分钟内` : `男生 ${place.male_minutes} 分钟内，女生 ${place.female_minutes} 分钟内`}，超时无效</small></span></div>}
                <button className="kv" onClick={onPlan}><span className="k">次数</span><span className="v">{runTally(run).count} / {run.rule.required}<small>编排整个学期</small></span><Chevron /></button>
            </Sheet>
        );
    }
    const placed = !unplaced(event.room);
    const name = event.room ? roomLabel(event.room) : null;
    return (
        <Sheet title={<>{event.kind === 'exam' && <span className="tag">考试</span>}{event.name}</>} onClose={onClose}>
            <div className="meta">{when}{name ? ` · ${name}` : ' · 教室未排定'}</div>
            {placed ? <div className="btns">
                <a className="btn" href={`/map/?place=${encodeURI(event.room!)}&t=${momentText({ date: event.date, min: event.start })}`}>在地图上看</a>
                <a className="btn go" href={`/map/?nav=${encodeURI(event.room!)}`}>去这里</a>
            </div> : <div style={{ height: 12 }} />}
            {isRoom(event.room) && <a className="kv" href={whoLink('room', event.room!)}><span className="k">教室</span><span className="v">{name} 的课表</span><Chevron /></a>}
            {event.teachers.map(teacher => <a key={teacher} className="kv" href={whoLink('teacher', teacher)}><span className="k">老师</span><span className="v">{teacher} 的课表</span><Chevron /></a>)}
            <a className="kv" href={whoLink('course', courseName(event.name))}><span className="k">课程</span><span className="v">这门课的全部时段</span><Chevron /></a>
            {isMe && event.kind === 'exam' && <button className="kv" onClick={() => onSkipExam(event)}><span className="k" /><span className="v danger">不参加这场考试</span></button>}
            {isMe && event.kind === 'class' && <button className="kv" onClick={() => onHide(event)}><span className="k" /><span className="v danger">从我的课表移除</span></button>}
        </Sheet>
    );
}
