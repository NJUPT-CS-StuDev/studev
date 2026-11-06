import { useEffect, useMemo, useState } from 'react';
import type { TeachingClass } from '@/world/facts';
import { writePreferences } from '@/world/preferences';
import { loadClasses } from '@/world/data';
import { Magnifier } from '@/world/ui';

const fold = (value: string) => value.normalize('NFKC').toUpperCase().replace(/\s+/g, '');

/** The first thing a new visitor sees: their class is all the timetable needs. */
export function ClassPicker({ onPicked }: { onPicked?: () => void }) {
    const [classes, setClasses] = useState<TeachingClass[]>([]);
    const [query, setQuery] = useState('');
    useEffect(() => { void loadClasses().then(setClasses); }, []);
    const matches = useMemo(() => {
        const needle = fold(query);
        if (!needle) return [];
        return classes.filter(item => fold(`${item.name} ${item.major ?? ''}`).includes(needle)).slice(0, 30);
    }, [classes, query]);
    return (
        <div className="wrap narrow picker">
            <h1>你在哪个班？</h1>
            <p>输入班号或专业，课表、考试和校历就都有了。</p>
            <div className="sfield"><Magnifier /><input value={query} autoFocus placeholder="比如 B240402" aria-label="班号或专业" enterKeyHint="search" onChange={event => setQuery(event.target.value)} /></div>
            {matches.map(item => (
                <button key={item.id} className="res" onClick={() => { writePreferences(current => ({ ...current, class: item.name })); onPicked?.(); }}>
                    <span className="m"><span className="a">{item.name}</span><span className="b">{[item.major, item.campus, item.students ? `${item.students} 人` : ''].filter(Boolean).join(' · ')}</span></span>
                </button>
            ))}
            {query && classes.length > 0 && !matches.length && <p className="empty">没有找到这个班</p>}
        </div>
    );
}
