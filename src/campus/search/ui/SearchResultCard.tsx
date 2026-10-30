import type { SearchCategory } from './searchLabels';
import { Download, ExternalLink, FileText } from 'lucide-react';
import type { SearchResult } from 'wasm-search';
import { CATEGORY_LABELS } from './searchLabels';

const isExternalUrl = (url: string): boolean => /^https?:\/\//.test(url);

interface MatchHighlight {
    start: number;
    end: number;
}

function highlightRangesFromTerms(text: string, terms: string[]): MatchHighlight[] {
    const uniqueTerms = Array.from(new Set(terms.filter(term => term.length >= 2)))
        .sort((a, b) => b.length - a.length);
    if (uniqueTerms.length === 0) return [];

    const lowerText = text.toLocaleLowerCase('zh-CN');
    const ranges: MatchHighlight[] = [];
    for (const term of uniqueTerms) {
        const lowerTerm = term.toLocaleLowerCase('zh-CN');
        let index = lowerText.indexOf(lowerTerm);
        while (index >= 0) {
            const end = index + term.length;
            const overlaps = ranges.some(range => index < range.end && end > range.start);
            if (!overlaps) ranges.push({ start: index, end });
            index = lowerText.indexOf(lowerTerm, index + 1);
        }
    }
    return ranges.sort((a, b) => a.start - b.start);
}

function highlightedSegments(
    text: string,
    terms: string[]
): Array<{ text: string; highlighted: boolean }> {
    const ranges = highlightRangesFromTerms(text, terms)
        .filter(range => Number.isInteger(range.start)
            && Number.isInteger(range.end)
            && range.start >= 0
            && range.end > range.start
            && range.end <= text.length)
        .sort((a, b) => a.start - b.start);
    if (ranges.length === 0) return [{ text, highlighted: false }];

    const segments: Array<{ text: string; highlighted: boolean }> = [];
    let cursor = 0;
    for (const range of ranges) {
        if (range.start < cursor) continue;
        if (range.start > cursor) {
            segments.push({ text: text.slice(cursor, range.start), highlighted: false });
        }
        segments.push({ text: text.slice(range.start, range.end), highlighted: true });
        cursor = range.end;
    }
    if (cursor < text.length) {
        segments.push({ text: text.slice(cursor), highlighted: false });
    }
    return segments.filter(segment => segment.text.length > 0);
}

function HighlightedText({ text, terms }: { text: string; terms: string[] }) {
    return (
        <>
            {highlightedSegments(text, terms).map((segment, index) => segment.highlighted ? (
                <mark
                    key={`${segment.text}-${index}`}
                    data-testid="collection-result-highlight"
                    className="rounded bg-[var(--highlight)] px-0.5 text-inherit dark:bg-[var(--highlight)]"
                >
                    {segment.text}
                </mark>
            ) : (
                <span key={`${segment.text}-${index}`}>{segment.text}</span>
            ))}
        </>
    );
}

interface SearchResultCardProps {
    document: SearchResult;
}

export function SearchResultCard({ document }: SearchResultCardProps) {
    const date = document.updatedAt || document.publishedAt;
    const wrapperProps = {
        href: document.url,
        target: isExternalUrl(document.url) ? '_blank' : undefined,
        rel: isExternalUrl(document.url) ? 'noopener noreferrer' : undefined,
    };

    return (
        <a {...wrapperProps} className="block w-full text-left py-3 group border-b border-[var(--line)] dark:border-[var(--line)] last:border-b-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[var(--muted)] dark:text-[var(--muted)]">
                <span className="font-medium text-[var(--ink)] dark:text-[var(--muted)]">{CATEGORY_LABELS[(document.category ?? 'notice_article') as SearchCategory]}</span>
                <span>{document.sourceName}</span>
                <span>›</span>
                <span>{document.section || '其他'}</span>
                {date ? <><span>›</span><span>{date.slice(0, 10)}</span></> : null}
            </div>

            <h3 className="mt-1 text-[20px] leading-snug font-medium text-[var(--brand)] dark:text-[var(--brand)] group-hover:underline break-words">
                {document.title}
            </h3>

            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[var(--success)] dark:text-[var(--success)]">
                <span className="truncate max-w-full">{document.url}</span>
                {document.kind === 'link' ? (
                    <span className="inline-flex items-center gap-1 text-[var(--muted)] dark:text-[var(--muted)]">
                        <ExternalLink size={13} />
                        站外页面
                    </span>
                ) : null}
                {document.kind === 'file' ? (
                    <span className="inline-flex items-center gap-1 text-[var(--muted)] dark:text-[var(--muted)]">
                        <Download size={13} />
                        附件
                    </span>
                ) : null}
            </div>

            {document.snippet ? (
                <p
                    data-testid="search-result-snippet"
                    className="mt-2 text-[14px] text-[var(--muted)] dark:text-[var(--muted)] line-clamp-3 sm:line-clamp-2 break-words"
                >
                    <HighlightedText
                        text={document.snippet}
                        terms={document.matchedTerms}
                    />
                </p>
            ) : (
                <div
                    data-testid="search-result-snippet-loading"
                    className="mt-2 h-4 w-4/5 animate-pulse rounded bg-[var(--surface-sunken)] dark:bg-[var(--surface)]"
                />
            )}

            {document.attachments.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex h-6 items-center gap-1 rounded bg-[var(--mark)] px-2 text-[12px] text-[var(--brand)] dark:bg-[var(--mark)] dark:text-[var(--brand)]">
                        <FileText size={12} />
                        {document.attachments.length} 个附件
                    </span>
                    {document.attachments.slice(0, 4).map(attachment => (
                        <span
                            key={attachment.url}
                            className="inline-flex items-center gap-1 max-w-full h-6 px-2 rounded bg-[var(--alert-note)] dark:bg-[var(--surface)] text-[12px] text-[var(--ink)] dark:text-[var(--ink)]"
                        >
                            <FileText size={12} className="shrink-0" />
                            <span className="truncate">{attachment.name}</span>
                            {attachment.extension ? <span className="uppercase text-[var(--muted)] dark:text-[var(--muted)]">{attachment.extension}</span> : null}
                        </span>
                    ))}
                </div>
            ) : null}

        </a>
    );
}
