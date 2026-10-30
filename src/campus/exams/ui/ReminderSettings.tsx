import { Bell } from 'lucide-react';

interface ReminderSettingsProps {
    selected: number[];
    onChange: (reminders: number[]) => void;
}

export function ReminderSettings({ selected, onChange }: ReminderSettingsProps) {
    const options = [
        { value: 15, label: '15分钟前' },
        { value: 30, label: '30分钟前' },
        { value: 60, label: '1小时前' },
        { value: 1440, label: '1天前' },
        { value: 2880, label: '2天前' },
        { value: 10080, label: '1周前' },
    ];

    const toggleOption = (val: number) => {
        if (selected.includes(val)) {
            onChange(selected.filter(v => v !== val));
        } else {
            onChange([...selected, val].sort((a, b) => a - b));
        }
    };

    return (
        <div className="mb-6 rounded-lg border border-[var(--line)] dark:border-[var(--line)] bg-[var(--surface)] dark:bg-[var(--paper)] p-4">
            <div className="flex items-center gap-2 mb-3">
                <Bell className="w-5 h-5 text-[var(--warning)]" aria-hidden="true" />
                <h3 className="font-medium text-[var(--ink)] dark:text-[var(--ink)] text-[14px]">考前提醒</h3>
            </div>
            <div className="flex flex-wrap gap-2">
                {options.map(opt => {
                    const isActive = selected.includes(opt.value);
                    return (
                        <button
                            type="button"
                            key={opt.value}
                            onClick={() => toggleOption(opt.value)}
                            className={`px-4 py-1.5 rounded-full text-[13px] font-medium transition-all border
                                ${isActive
                                    ? 'bg-[var(--mark)] dark:bg-[var(--brand)]/20 text-[var(--color-google-blue)] dark:text-[var(--brand)] border-transparent'
                                    : 'bg-[var(--paper)] dark:bg-[var(--surface)] text-[var(--muted)] dark:text-[var(--muted)] border-[var(--line)] dark:border-[var(--line)] hover:bg-[var(--surface)] dark:hover:bg-[var(--surface-raised)]'
                                }`}
                        >
                            {opt.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

