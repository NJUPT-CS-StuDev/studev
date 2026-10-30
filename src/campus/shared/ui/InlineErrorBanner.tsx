import { AlertCircle } from 'lucide-react';

interface InlineErrorBannerProps {
    message: string | null;
}

export function InlineErrorBanner({ message }: InlineErrorBannerProps) {
    if (!message) return null;

    return (
        <div className="max-w-6xl mx-auto w-full px-4 pt-4">
            <div className="border border-[var(--danger-line)] dark:border-[var(--danger-line)] bg-[var(--danger-bg)] dark:bg-[var(--danger-bg)] text-[var(--danger)] dark:text-[var(--danger)] rounded-md p-3 text-sm flex gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{message}</span>
            </div>
        </div>
    );
}
