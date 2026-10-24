import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SearchSection } from './ui/SearchSection';
import { SEARCH_SCOPES } from './searchScopes';
import { buildScopedFilterOptions } from './scopedFilterOptions';

const noop = () => undefined;
const communitySourceId = SEARCH_SCOPES.community.sourceId;
const materialsSourceId = SEARCH_SCOPES.materials.sourceId;
if (!communitySourceId || !materialsSourceId) {
    throw new Error('repository search scopes must pin a source');
}

describe('route-owned search scopes', () => {
    it('uses source-local facet counts for repository routes', () => {
        const options = buildScopedFilterOptions({
            sources: [
                { id: 'site', label: '网站', count: 1000 },
                { id: communitySourceId, label: '南邮生存手册', count: 67 },
            ],
            categories: [
                { id: 'notice_article', label: 'notice_article', count: 900 },
                { id: 'workflow', label: 'workflow', count: 682 },
            ],
            categoriesBySource: {
                site: [{ id: 'notice_article', label: 'notice_article', count: 900 }],
                [communitySourceId]: [
                    { id: 'notice_article', label: 'notice_article', count: 12 },
                    { id: 'workflow', label: 'workflow', count: 55 },
                ],
            },
        }, SEARCH_SCOPES.community, { sourceId: SEARCH_SCOPES.community.sourceId });

        expect(options?.categories).toEqual([
            { id: 'notice_article', label: 'notice_article', count: 12 },
            { id: 'workflow', label: 'workflow', count: 55 },
        ]);
    });

    it('aggregates only visible website sources', () => {
        const options = buildScopedFilterOptions({
            sources: [
                { id: 'site-a', label: '网站A', count: 10 },
                { id: communitySourceId, label: '社区', count: 20 },
                { id: materialsSourceId, label: '资料', count: 30 },
            ],
            categories: [],
            categoriesBySource: {
                'site-a': [{ id: 'news', label: 'news', count: 10 }],
                [communitySourceId]: [{ id: 'notice_article', label: 'notice_article', count: 20 }],
                [materialsSourceId]: [{ id: 'download', label: 'download', count: 30 }],
            },
        }, SEARCH_SCOPES.search, {});

        expect(options?.categories).toEqual([
            { id: 'news', label: 'news', count: 10 },
        ]);
    });

    it('keeps repository sources out of website search', () => {
        expect(SEARCH_SCOPES.search.excludedSourceIds).toEqual([
            SEARCH_SCOPES.community.sourceId,
            SEARCH_SCOPES.materials.sourceId,
        ]);
    });

    it('keeps a fixed repository source out of user-clearable filters', () => {
        const html = renderToStaticMarkup(
            <SearchSection
                query="高等数学"
                response={null}
                searching={false}
                documentCount={1049}
                sortMode="relevance"
                filters={{ sourceId: SEARCH_SCOPES.materials.sourceId }}
                scope={SEARCH_SCOPES.materials}
                datePreset="all"
                filterOptions={null}
                fixedSourceId={SEARCH_SCOPES.materials.sourceId}
                fixedSourceName={SEARCH_SCOPES.materials.sourceName}
                supportsDates={false}
                canLoadMore={false}
                onSortModeChange={noop}
                onFiltersChange={noop}
                onScopeChange={noop}
                onDatePresetChange={noop}
                onLoadMore={noop}
            />,
        );
        expect(html).toContain('aria-label="搜索范围"');
        expect(html).toContain('aria-label="具体来源"');
        expect(html).toContain('南邮历年资料');
        expect(html).not.toContain('aria-label="时间筛选"');
        expect(html).toContain('aria-label="类型筛选"');
        expect(html).not.toContain('筛选后');
    });
});
