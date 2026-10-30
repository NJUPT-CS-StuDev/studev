export const formatExamDisplayDate = (isoString?: string | null): string => {
  if (!isoString) return "";
  const date = new Date(isoString);
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "short",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const examTimestamp = (exam: {date: string; start: string; end: string}, edge: 'start' | 'end'): string => exam.date + 'T' + exam[edge] + ':00+08:00';
export const examDuration = (exam: {start: string; end: string}): number => {
    const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
    return minutes(exam.end) - minutes(exam.start);
};
