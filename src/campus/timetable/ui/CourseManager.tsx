import { catalogId } from '../model/courseCatalog';
import { Eye, EyeOff, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TeachingMeeting } from '@/academics/timetable';
import { searchCatalog, type CatalogCourse } from '../model/courseCatalog';
import { CourseResults, meetingLine, suspensionNote } from './CourseResults';

export interface TimetableCourse extends CatalogCourse {
    source: 'class' | 'added';
    hidden: boolean;
}

interface CourseManagerProps {
    className: string;
    courses: TimetableCourse[];
    loadCatalog: () => Promise<CatalogCourse[]>;
    initialQuery: string;
    onHide: (id: string) => void;
    onShow: (id: string) => void;
    onAdd: (course: CatalogCourse) => void;
    onRemoveAdded: (id: string) => void;
    onClose: () => void;
}

/** The visitor's own timetable: hide class courses they skip, add retakes and electives. */
export function CourseManager({ className, courses, loadCatalog, initialQuery, onHide, onShow, onAdd, onRemoveAdded, onClose }: CourseManagerProps) {
    const panelRef = useRef<HTMLElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState(initialQuery);
    const [catalog, setCatalog] = useState<CatalogCourse[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        loadCatalog().then(list => { if (alive) setCatalog(list); }).catch(reason => {
            if (alive) setError(reason instanceof Error ? reason.message : '课程目录加载失败');
        });
        return () => { alive = false; };
    }, [loadCatalog]);

    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        inputRef.current?.focus({ preventScroll: true });
        const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
        document.addEventListener('keydown', keydown);
        return () => {
            document.removeEventListener('keydown', keydown);
            document.body.style.overflow = previousOverflow;
        };
    }, [onClose]);

    const results = useMemo(() => catalog && query.trim() ? searchCatalog(catalog, query) : [], [catalog, query]);
    const present = useMemo(() => new Set(courses.filter(course => !course.hidden).map(course => catalogId(course))), [courses]);
    const classCourses = courses.filter(course => course.source === 'class');
    const added = courses.filter(course => course.source === 'added');
    const remove = (course: CatalogCourse) => {
        const existing = courses.find(item => catalogId(item) === catalogId(course));
        if (existing?.source === 'added') onRemoveAdded(catalogId(course));
        else onHide(catalogId(course));
    };
    const add = (course: CatalogCourse) => {
        const existing = courses.find(item => catalogId(item) === catalogId(course));
        if (existing?.source === 'class') onShow(catalogId(course));
        else onAdd(course);
    };

    return (
        <div className="course-detail-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
            <aside ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="course-manager-title" className="course-detail-panel course-manager">
                <div className="course-detail-handle" aria-hidden="true" />
                <header className="course-manager-header">
                    <div><p>{className} · 我的课表</p><h2 id="course-manager-title">管理课程</h2></div>
                    <button type="button" onClick={onClose} aria-label="关闭课程管理"><X aria-hidden="true" /></button>
                </header>
                <div className="course-manager-search">
                    <Search aria-hidden="true" />
                    <input
                        ref={inputRef}
                        type="search"
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        placeholder="搜索课程、教师、课程号或教室，加入重修与选修"
                        aria-label="搜索课程"
                        enterKeyHint="search"
                    />
                </div>
                <div className="course-detail-body">
                    {query.trim() ? (
                        <section>
                            <h3>{catalog ? `找到 ${results.length}${results.length === 60 ? '+' : ''} 个教学班` : error ?? '正在加载全校课程…'}</h3>
                            {catalog && !results.length ? <p className="course-manager-empty">没有匹配的课程。可以试试只输入课程名中的几个字，或教师姓名。</p> : null}
                            <CourseResults courses={results} inTimetable={present} onAdd={add} onRemove={remove} />
                        </section>
                    ) : null}
                    {added.length ? (
                        <section>
                            <h3>自己加入的课程</h3>
                            <ul className="course-manager-list">
                                {added.map(course => (
                                    <li key={catalogId(course)}>
                                        <div><strong>{course.meetings[0]!.course.name}</strong><span>{[...new Set(course.meetings.map(m => m.teachers.map(t => t.name).join(',')).filter(Boolean))].join('、')}</span>{course.meetings.map(meeting => <small key={meeting.id}>{meetingLine(meeting)}</small>)}{suspensionNote(course.meetings) ? <em>{suspensionNote(course.meetings)}</em> : null}</div>
                                        <button type="button" onClick={() => onRemoveAdded(catalogId(course))} aria-label={`移出 ${course.meetings[0]!.course.name}`}><Trash2 aria-hidden="true" />移出</button>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ) : null}
                    <section>
                        <h3>班级课表中的课程</h3>
                        <p className="course-manager-hint">没有选的课点「不上」，它就不再出现在你的课表里；随时可以恢复。</p>
                        <ul className="course-manager-list">
                            {classCourses.map(course => (
                                <li key={catalogId(course)} className={course.hidden ? 'is-hidden' : ''}>
                                    <div><strong>{course.meetings[0]!.course.name}</strong><span>{[...new Set(course.meetings.map(m => m.teachers.map(t => t.name).join(',')).filter(Boolean))].join('、')}</span>{course.meetings.map(meeting => <small key={meeting.id}>{meetingLine(meeting)}</small>)}{suspensionNote(course.meetings) ? <em>{suspensionNote(course.meetings)}</em> : null}</div>
                                    {course.hidden
                                        ? <button type="button" onClick={() => onShow(catalogId(course))} aria-label={`恢复 ${course.meetings[0]!.course.name}`}><Eye aria-hidden="true" />恢复</button>
                                        : <button type="button" onClick={() => onHide(catalogId(course))} aria-label={`不上 ${course.meetings[0]!.course.name}`}><EyeOff aria-hidden="true" />不上</button>}
                                </li>
                            ))}
                        </ul>
                    </section>
                </div>
            </aside>
        </div>
    );
}
