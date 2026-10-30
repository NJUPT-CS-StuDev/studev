import type { SearchCategory } from './searchLabels';
import { ArrowDownWideNarrow, CalendarDays, Filter, ListFilter, RotateCcw } from 'lucide-react';
import type {
    FilterOption,
    FilterOptions,
    SearchFilters,
    SortMode,
} from 'wasm-search';
import {
    DATE_FILTER_LABELS,
    CATEGORY_LABELS,
    dateFilters,
    type SearchDatePreset,
} from './searchLabels';
import { SEARCH_SCOPE_OPTIONS, type SearchScope } from '../searchScopes';

interface SearchControlsProps {
    activeFilters: boolean;
    facetOptions: Array<FilterOption & { id: SearchCategory }>;
    filterOptions: FilterOptions | null;
    filters: SearchFilters;
    scope: SearchScope;
    fixedSourceId?: string;
    fixedSourceName?: string;
    supportsDates?: boolean;
    datePreset: SearchDatePreset;
    sortMode: SortMode;
    onFiltersChange: (patch: SearchFilters) => void;
    onScopeChange: (route: SearchScope['route']) => void;
    onDatePresetChange: (preset: SearchDatePreset) => void;
    onSortModeChange: (sortMode: SortMode) => void;
}

export function SearchControls({
    activeFilters,
    facetOptions,
    filterOptions,
    filters,
    scope,
    fixedSourceId,
    fixedSourceName,
    supportsDates = true,
    datePreset,
    sortMode,
    onFiltersChange,
    onScopeChange,
    onDatePresetChange,
    onSortModeChange,
}: SearchControlsProps) {
    const sourceOptions = filterOptions?.sources || [];

    return (
        <div className="mb-2 flex flex-wrap items-center gap-2">
            <label className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--line)] dark:border-[var(--line)] bg-[var(--paper)] dark:bg-[var(--paper)] px-2 text-sm text-[var(--muted)] dark:text-[var(--muted)]">
                <Filter size={14} aria-hidden="true" />
                <span className="sr-only">搜索范围</span>
                <select
                    id="search-scope-filter"
                    name="search-scope-filter"
                    value={scope.route}
                    onChange={event => onScopeChange(event.target.value as SearchScope['route'])}
                    className="max-w-[150px] bg-transparent text-sm outline-none"
                    aria-label="搜索范围"
                >
                    {SEARCH_SCOPE_OPTIONS.map(option => (
                        <option key={option.route} value={option.route}>{option.title}</option>
                    ))}
                </select>
            </label>
            <div className="inline-flex h-9 items-center rounded-md border border-[var(--line)] dark:border-[var(--line)] bg-[var(--paper)] dark:bg-[var(--paper)] p-0.5" aria-label="排序方式">
                <button
                    type="button"
                    aria-pressed={sortMode === 'relevance'}
                    onClick={() => onSortModeChange('relevance')}
                    className={`inline-flex h-7 items-center gap-1 rounded px-2.5 text-sm ${sortMode === 'relevance' ? 'bg-[var(--mark)] text-[var(--brand)] dark:bg-[var(--mark)] dark:text-[var(--brand)]' : 'text-[var(--muted)] hover:bg-[var(--surface-sunken)] dark:text-[var(--muted)] dark:hover:bg-[var(--surface)]'}`}
                >
                    <ArrowDownWideNarrow size={14} aria-hidden="true" />
                    相关性
                </button>
                {supportsDates ? <button
                    type="button"
                    aria-pressed={sortMode === 'date_desc'}
                    onClick={() => onSortModeChange('date_desc')}
                    className={`inline-flex h-7 items-center gap-1 rounded px-2.5 text-sm ${sortMode === 'date_desc' ? 'bg-[var(--mark)] text-[var(--brand)] dark:bg-[var(--mark)] dark:text-[var(--brand)]' : 'text-[var(--muted)] hover:bg-[var(--surface-sunken)] dark:text-[var(--muted)] dark:hover:bg-[var(--surface)]'}`}
                >
                    <CalendarDays size={14} aria-hidden="true" />
                    时间
                </button> : null}
            </div>
            <label className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--line)] dark:border-[var(--line)] bg-[var(--paper)] dark:bg-[var(--paper)] px-2 text-sm text-[var(--muted)] dark:text-[var(--muted)]">
                <Filter size={14} aria-hidden="true" />
                <span className="sr-only">具体来源</span>
                <select
                    id="search-source-filter"
                    name="search-source-filter"
                    value={filters.sourceId || ''}
                    onChange={event => onFiltersChange({ sourceId: event.target.value || undefined })}
                    disabled={Boolean(fixedSourceId)}
                    className="max-w-[210px] bg-transparent text-sm outline-none"
                    aria-label="具体来源"
                >
                    {fixedSourceId ? (
                        <option value={fixedSourceId}>{fixedSourceName ?? '当前来源'}</option>
                    ) : <option value="">全部网站</option>}
                    {!fixedSourceId ? sourceOptions.map(source => (
                        <option key={source.id} value={source.id}>{source.label} ({source.count})</option>
                    )) : null}
                </select>
            </label>
            <label className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--line)] dark:border-[var(--line)] bg-[var(--paper)] dark:bg-[var(--paper)] px-2 text-sm text-[var(--muted)] dark:text-[var(--muted)]">
                <ListFilter size={14} aria-hidden="true" />
                <span className="sr-only">类型筛选</span>
                <select
                    id="search-facet-filter"
                    name="search-facet-filter"
                    value={filters.category || ''}
                    onChange={event => onFiltersChange({
                        category: (event.target.value || undefined) as SearchCategory | undefined,
                    })}
                    className="bg-transparent text-sm outline-none"
                    aria-label="类型筛选"
                >
                    <option value="">全部类型</option>
                    {facetOptions.map(facet => (
                        <option key={facet.id} value={facet.id}>{CATEGORY_LABELS[facet.id]} ({facet.count})</option>
                    ))}
                </select>
            </label>
            {supportsDates ? <label className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--line)] dark:border-[var(--line)] bg-[var(--paper)] dark:bg-[var(--paper)] px-2 text-sm text-[var(--muted)] dark:text-[var(--muted)]">
                <CalendarDays size={14} aria-hidden="true" />
                <span className="sr-only">时间筛选</span>
                <select
                    id="search-date-filter"
                    name="search-date-filter"
                    value={datePreset}
                    onChange={event => onDatePresetChange(event.target.value as SearchDatePreset)}
                    className="bg-transparent text-sm outline-none"
                    aria-label="时间筛选"
                >
                    {Object.entries(DATE_FILTER_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                    ))}
                </select>
            </label> : null}
            {activeFilters ? (
                <button
                    type="button"
                    onClick={() => {
                        onFiltersChange({
                            sourceId: fixedSourceId,
                            category: undefined,
                            ...dateFilters('all'),
                        });
                        onDatePresetChange('all');
                    }}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm text-[var(--brand)] hover:bg-[var(--surface-sunken)] dark:text-[var(--brand)] dark:hover:bg-[var(--surface)]"
                >
                    <RotateCcw size={14} aria-hidden="true" />
                    清除筛选
                </button>
            ) : null}
        </div>
    );
}
