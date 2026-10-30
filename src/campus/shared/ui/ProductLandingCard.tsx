import type { ReactNode } from 'react';

interface ProductLandingCardProps {
    icon: ReactNode;
    title: string;
    description: string;
    children?: ReactNode;
}

export function ProductLandingCard({ icon, title, description, children }: ProductLandingCardProps) {
    return (
        <section className="mx-auto w-full max-w-[692px] rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-5 py-7 text-center shadow-sm dark:border-[var(--line)] dark:bg-[var(--surface)] sm:px-8 sm:py-9">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--mark)] text-[var(--brand)] dark:bg-[var(--mark)] dark:text-[var(--brand)]">
                {icon}
            </span>
            <h1 className="mt-5 text-[26px] font-semibold leading-tight tracking-tight text-[var(--ink)] dark:text-[var(--ink)]">
                {title}
            </h1>
            <p className="mx-auto mt-2 max-w-xl text-[14px] leading-6 text-[var(--muted)] dark:text-[var(--muted)] sm:text-[15px]">
                {description}
            </p>
            {children}
        </section>
    );
}
