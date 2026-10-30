import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ExamChange, ExamSource, ExamSlot } from '@/academics/facts';
import { ExamHistoryPanel } from './ExamHistoryPanel';
import { ExamHistorySummary } from './ExamHistorySummary';
const sources: ExamSource[] = ['2026-06-10','2026-06-11','2026-06-12'].map(date => ({file: date + '-安排.xlsx', url: 'https://example.test/exams.xlsx', notice: 'https://example.test/', title: '考试安排'}));
const slot: ExamSlot = {date: '2026-07-01', start: '08:00', end: '09:50', location: '教2-313', campus: '仙林', teacher: '张三', students: 30};
const change: ExamChange = {observed: '2026-06-12', class: 'B240402', course: {code: 'JS101', name: '算法'}, change: 'changed', before: [slot], after: [{...slot, location: '教2-314'}]};
describe('exam history', () => {
    it('shows the baseline from published sources without engineering terminology', () => {
        const html = renderToStaticMarkup(<ExamHistorySummary sources={sources.slice(0,1)} changes={[]} loading={false} error={null} />);
        expect(html).toContain('已记录 1 次更新');
        expect(html).toContain('从本次考试安排开始记录后续变化');
        expect(html).not.toMatch(/snapshot|artifact|identity|manifest|diff|Git|hydration/);
    });
    it('reads observed, course, change, before and after directly and expands the newest date first', () => {
        const removed: ExamChange = {...change, observed: '2026-06-11', change: 'removed', after: null};
        const html = renderToStaticMarkup(<ExamHistoryPanel changes={[removed,change]} sources={sources} className="B240402" loading={false} error={null} />);
        expect(html).toContain('系统共更新 3 次，其中 2 次影响本班');
        expect(html).toContain('考试地点由教2-313调整为教2-314');
        expect(html.indexOf('6月12日')).toBeLessThan(html.lastIndexOf('6月11日'));
        expect(html).not.toContain('考试取消');
        const onlyRemoved = renderToStaticMarkup(<ExamHistoryPanel changes={[removed]} sources={sources} className="B240402" loading={false} error={null} />);
        expect(onlyRemoved).toContain('记录已移除');
    });
    it('shows added and removed classes without inventing old exam counts', () => {
        const added: ExamChange = {...change, change: 'added', before: null};
        const html = renderToStaticMarkup(<ExamHistoryPanel changes={[added]} sources={sources} className="B240402" loading={false} error={null} />);
        expect(html).toContain('新增');
        expect(html).toContain('算法');
    });
    it('uses every slot when rendering a multi-sitting change and retains absent values', () => {
        const multiple: ExamChange = {...change, before: [slot,{...slot,location: '教3-201'}], after: [{...slot,location: null}]};
        const html = renderToStaticMarkup(<ExamHistoryPanel changes={[multiple]} sources={sources} className="B240402" loading={false} error={null} />);
        expect(html).toContain('考试地点由教2-313、教3-201调整为未填写');
    });
    it('keeps history failure separate from exam querying', () => {
        const html = renderToStaticMarkup(<ExamHistoryPanel changes={null} sources={[]} className="B240402" loading={false} error="更新记录暂时无法显示，考试查询不受影响。" />);
        expect(html).toContain('考试查询不受影响');
    });
    it('summarizes the producer changes on the latest observation', () => {
        const html = renderToStaticMarkup(<ExamHistorySummary sources={sources} changes={[change]} loading={false} error={null} />);
        expect(html).toContain('涉及 1 个班级：新增 0 门、调整 1 门、移除 0 条记录');
    });
});
