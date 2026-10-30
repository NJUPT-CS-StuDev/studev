interface SearchStatusProps {
    documentCount: number;
    statusText: string;
}

export function SearchStatus({
    documentCount,
    statusText,
}: SearchStatusProps) {
    return (
        <div className="mt-1 flex max-w-[880px] flex-col gap-1 text-sm text-[var(--muted)] dark:text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between">
            <p>{statusText}</p>
            {documentCount > 0 ? (
                <p className="shrink-0 text-[12px]">
                    已收录 {documentCount.toLocaleString('zh-CN')} 条信息
                </p>
            ) : null}
        </div>
    );
}
