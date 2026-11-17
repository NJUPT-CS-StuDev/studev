import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import release from '../../data/campus-release.json';
import type { ExamVersion } from '@/world/facts';
import { examFileName } from '@/world/exams';
import { ExamSources } from './ExamHistory';

const index = JSON.parse(readFileSync(new URL(`../../../public${release.base}/exams/${release.exams}/index.json`, import.meta.url), 'utf8')) as { history: ExamVersion[] };

describe('official exam sources', () => {
    it('groups actual adopted files under one link to each official announcement', () => {
        for (const version of index.history) {
            const html = renderToStaticMarkup(<ExamSources files={version.files} />);
            expect((html.match(/aria-label="官方公告：/g) ?? []).length).toBe(new Set(version.files.map(file => file.notice)).size);
            for (const source of version.files) {
                expect(html).toContain(`href="${source.notice}"`);
                expect(html).toContain(`href="${source.url}"`);
                expect(html).toContain(examFileName(source.file));
            }
        }
    });

    it('keeps two adopted filenames when their source URL is shared, without inventing two attachment links', () => {
        const version = index.history.at(-1)!;
        expect(version.files.length).toBeGreaterThan(1);
        const first = version.files[0]!;
        const files = version.files.map(file => ({ ...file, url: first.url }));
        const html = renderToStaticMarkup(<ExamSources files={files} />);
        expect(html.split(`href="${first.url}"`).length - 1).toBe(1);
        for (const file of files) expect(html).toContain(examFileName(file.file));
        const inherited = renderToStaticMarkup(<ExamSources files={files.map(file => ({ ...file, url: file.notice }))} />);
        expect((inherited.match(/<a /g) ?? []).length).toBe(new Set(files.map(file => file.notice)).size);
    });
});
