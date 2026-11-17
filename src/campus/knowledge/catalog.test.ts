import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { catalogScope, courseRelations, type CatalogCurriculum, type KnowledgeCatalog } from './catalog';
import KnowledgeApp from './KnowledgeApp';

let curriculum: CatalogCurriculum[];
let catalog: KnowledgeCatalog;
beforeAll(async () => {
    const release = JSON.parse(await readFile('src/data/campus-release.json', 'utf8'));
    curriculum = JSON.parse(await readFile(`public${release.base}/curriculum/courses.json`, 'utf8'));
    catalog = JSON.parse(await readFile(`public${release.base}/knowledge-catalog.json`, 'utf8'));
});

describe('released course relations', () => {
    it('renders the real catalogue on the server without touching personal storage or the browser URL', async () => {
        const fetch = vi.spyOn(globalThis, 'fetch');
        let html: string;
        try {
            html = renderToString(createElement(KnowledgeApp, { catalog }));
            expect(fetch).not.toHaveBeenCalled();
        } finally { fetch.mockRestore(); }
        expect(html).toContain('课程目录');
        expect(html.replaceAll(/<!--.*?-->/g, '')).toContain('2026级 · 全部专业');
        expect(html).toContain('class="kn-scope"');
        expect(html).toContain('>筛选</button>');
        expect(html).not.toContain('<select');
        expect(html).not.toContain('kn-filter-fields');
        expect(html.match(/class="kn-course"/g)?.length).toBeGreaterThanOrEqual(catalog.courses.length);
        expect(html).not.toContain('正在加载课程');
        expect(html).not.toContain('已编译');
    });
    it('takes the actual class cohort and major, while an explicit shared link wins', async () => {
        const release = JSON.parse(await readFile('src/data/campus-release.json', 'utf8'));
        const classes = JSON.parse(await readFile(`public${release.base}/teaching/${release.teaching}/classes.json`, 'utf8')) as { id: string; grade: string; major: string }[];
        const person = classes.find(item => item.id === 'B240402')!;
        expect(catalogScope(curriculum, person, {})).toEqual({ cohort: '2024', major: '计算机科学与技术' });
        expect(catalogScope(curriculum, person, { cohort: '2026', major: '软件工程' })).toEqual({ cohort: '2026', major: '软件工程' });
        expect(catalogScope(curriculum, person, { major: '全部专业' })).toEqual({ cohort: '2024', major: '全部专业' });
        expect(catalogScope(curriculum, null, {})).toEqual({ cohort: '2026', major: '全部专业' });
        for (const year of ['2024', '2026']) {
            const scope = catalogScope(curriculum, person, { cohort: year });
            const selected = curriculum.filter(course => course.plans.some(plan => plan.grade === scope.cohort && plan.major === scope.major));
            expect(selected.length).toBeGreaterThan(0);
            expect(courseRelations(curriculum, selected).edges.length).toBeGreaterThan(0);
        }
    });
    it('shows recorded relations with readable context and no isolated course boxes', () => {
        const selected = curriculum.filter(course => course.plans.some(plan => plan.grade === '2026'));
        const graph = courseRelations(curriculum, selected);
        expect(graph.edges.length).toBeGreaterThan(0);
        const ends = new Set(graph.edges.flatMap(edge => [edge.from, edge.to]));
        expect(graph.nodes.map(node => node.code).sort()).toEqual([...ends].sort());
        for (const edge of graph.edges) expect(curriculum.find(course => course.code === edge.to)?.requires).toContain(edge.from);
        expect(graph.unlinked).toBeGreaterThan(0);
    });
    it('retains prerequisites and following courses when looking at data structures alone', () => {
        const selected = curriculum.filter(course => course.code === 'JS140201S');
        expect(selected).toHaveLength(1);
        const graph = courseRelations(curriculum, selected, 'JS140201S');
        expect(graph.nodes.some(course => course.code === 'JS100101S')).toBe(true);
        expect(graph.edges.some(edge => edge.to === 'JS140201S')).toBe(true);
        expect(graph.edges.some(edge => edge.from === 'JS140201S')).toBe(true);
        expect(graph.edges.every(edge => edge.from === 'JS140201S' || edge.to === 'JS140201S')).toBe(true);
    });
    it('does not turn an absence of recorded links into a graph or invent a prerequisite', () => {
        const all = courseRelations(curriculum, curriculum);
        const connected = new Set(all.nodes.map(course => course.code));
        const isolated = curriculum.find(course => !connected.has(course.code))!;
        expect(isolated).toBeTruthy();
        expect(courseRelations(curriculum, [isolated])).toEqual({ nodes: [], edges: [], choices: [], unlinked: 1 });
        expect(courseRelations(curriculum, [])).toEqual({ nodes: [], edges: [], choices: [], unlinked: 0 });
    });
});
