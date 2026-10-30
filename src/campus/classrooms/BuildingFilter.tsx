import { ChevronDown, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { selectedBuilding, toggleBuilding } from './model/buildingSelection';

export function BuildingFilter({ buildings, allBuildings, selected, onChange }: {
    buildings: string[]; allBuildings: string[]; selected: string[] | null; onChange: (ids: string[] | null) => void;
}) {
    const ref = useRef<HTMLDetailsElement>(null);
    const chosen = buildings.filter(id => selectedBuilding(selected, id));
    useEffect(() => {
        const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) ref.current?.removeAttribute('open'); };
        const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && ref.current?.open) { ref.current.removeAttribute('open'); ref.current.querySelector('summary')?.focus(); } };
        document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
        return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
    }, []);
    const toggle = (id: string) => onChange(toggleBuilding(selected, allBuildings, id));
    return <div className="building-filter">
        <details ref={ref}>
            <summary>楼栋 · {selected === null ? '全部' : chosen.length ? `已选 ${chosen.length}` : '未选择'}<ChevronDown size={16} /></summary>
            <div className="building-filter-menu" role="group" aria-label="筛选楼栋">
                <div className="building-filter-actions"><button type="button" onClick={() => onChange(null)}>全选</button><button type="button" onClick={() => onChange([])}>全不选</button><button type="button" onClick={() => { ref.current?.removeAttribute('open'); ref.current?.querySelector('summary')?.focus(); }}>完成</button></div>
                <div className="building-filter-options">{buildings.map(id => <label key={id}><input type="checkbox" checked={selectedBuilding(selected, id)} onChange={() => toggle(id)} /><span>{id}</span></label>)}</div>
            </div>
        </details>
        {selected !== null && chosen.length ? <div className="building-filter-chips" aria-label="已选楼栋">{chosen.slice(0, 3).map(id => <button key={id} type="button" onClick={() => toggle(id)} aria-label={`取消选择${id}`}>{id}<X size={13} /></button>)}{chosen.length > 3 ? <span>+{chosen.length - 3}</span> : null}</div> : null}
    </div>;
}
