using System.Text;

namespace StuDev.World;

public sealed record CalendarEntry(string Uid, string Summary, string Date, int? Start = null, int? End = null, string Location = "", string Description = "", List<int>? Reminders = null, bool Transparent = false, string? Last = null, string? Until = null, List<string>? Skip = null);

/** The person's selected timeline as iCalendar. A deadline marks time without reserving it. */
public static class Calendar
{
    public static List<CalendarEntry> Entries(CampusLine line, IReadOnlySet<string> kinds)
    {
        var entries = new List<CalendarEntry>();
        var first = Clock.Parse(line.Term.Weeks[0].Start); var last = Clock.Parse(line.Term.Weeks[^1].End);
        if (kinds.Contains("lessons"))
        {
            foreach (var meeting in line.Meetings)
            {
                var dates = new List<DateOnly>();
                for (var date = first; date <= last; date = date.AddDays(1))
                    if (line.On(date).Any(e => e.Meeting?.Id == meeting.Id)) dates.Add(date);
                if (dates.Count == 0) continue;
                var e = line.On(dates[0]).First(e => e.Meeting?.Id == meeting.Id); var skip = new List<string>();
                for (var date = dates[0]; date < dates[^1]; date = date.AddDays(7)) if (!dates.Contains(date)) skip.Add(Clock.Text(date));
                entries.Add(new(meeting.Id, e.Name, Clock.Text(dates[0]), e.Start, e.End, e.Room is null ? "" : Names.Room(e.Room), $"第 {line.WeekOf(dates[0])}–{line.WeekOf(dates[^1])} 周" + (e.Teachers.Count > 0 ? " · " + string.Join("、", e.Teachers) : ""), [15], Until: Clock.Text(dates[^1]), Skip: skip));
            }
            foreach (var lab in line.Labs)
            {
                var e = line.On(Clock.Parse(lab.Date)).First(e => e.Lab?.Id == lab.Id);
                entries.Add(new(e.Id, "实验 · " + e.Name, lab.Date, e.Start, e.End, Names.Room(lab.Room ?? lab.Place), string.Join(" · ", new[] { lab.Project, string.Join("、", lab.Teachers) }.Where(s => !string.IsNullOrEmpty(s))), [15]));
            }
            foreach (var day in line.Holidays.OrderBy(item => item.Key))
                entries.Add(new("off-" + Clock.Text(day.Key) + "-" + day.Value, day.Value + " · 不上课", Clock.Text(day.Key)));
        }
        if (kinds.Contains("exams")) foreach (var exam in line.Exams)
        {
            var e = line.On(Clock.Parse(exam.Date)).First(e => e.Exam?.Id == exam.Id);
            entries.Add(new(e.Id, "考试 · " + e.Name, exam.Date, e.Start, e.End, Names.Room(exam.Room ?? exam.Location), string.Join(" · ", new[] { exam.Teacher is null ? null : "任课老师 " + exam.Teacher, exam.Students is null ? null : $"本考场 {exam.Students} 人" }.Where(s => s is not null)), [e.Start + 240, 60]));
        }
        if (kinds.Contains("run") && line.Run is { } run) foreach (var date in line.RunDays)
            entries.Add(new("run-" + date, "早锻炼", date, Clock.Minutes(run.Time[0]), Clock.Minutes(run.Time[1]), Reminders: [30]));
        if (kinds.Contains("tasks")) foreach (var task in line.Tasks.Where(t => t.Parent is null && t.Done is null && t.Deleted != true))
        {
            if (task.Date is { } date && task.Start is { } start) entries.Add(new("task-" + task.Id + "-plan", task.Title, date, start, task.End ?? Math.Min(1440, start + 30), Description: task.Note ?? "", Reminders: task.Remind));
            if (task.Due is { } due) entries.Add(new("task-" + task.Id + "-due", "截止 · " + task.Title, due.Date, due.Time, due.Time is { } time ? time + 1 : null, Description: task.Note ?? "", Reminders: due.Time is null ? due.Remind?.Select(m => -m).ToList() : due.Remind, Transparent: true));
        }
        return entries;
    }
    private static string Text(string text) => text.Replace("\\", "\\\\").Replace(";", "\\;").Replace(",", "\\,").Replace("\r\n", "\n").Replace("\r", "\n").Replace("\n", "\\n");
    private static string Day(string date) => date.Replace("-", "");
    private static string Local(string date, int minutes) => Clock.Parse(date).ToDateTime(TimeOnly.MinValue).AddMinutes(minutes).ToString("yyyyMMdd'T'HHmmss");
    public static string File(string name, IEnumerable<CalendarEntry> entries, DateTimeOffset stamp)
    {
        var lines = new List<string> { "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//studev//ZH-CN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:" + Text(name), "X-WR-TIMEZONE:Asia/Shanghai", "BEGIN:VTIMEZONE", "TZID:Asia/Shanghai", "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:+0800", "TZOFFSETTO:+0800", "TZNAME:CST", "END:STANDARD", "END:VTIMEZONE" };
        foreach (var e in entries)
        {
            lines.AddRange(["BEGIN:VEVENT", "UID:" + Text(e.Uid) + "@studev", "DTSTAMP:" + stamp.UtcDateTime.ToString("yyyyMMdd'T'HHmmss'Z'")]);
            if (e.Start is { } start) lines.AddRange(["DTSTART;TZID=Asia/Shanghai:" + Local(e.Date, start), "DTEND;TZID=Asia/Shanghai:" + Local(e.Date, e.End!.Value)]);
            else lines.AddRange(["DTSTART;VALUE=DATE:" + Day(e.Date), "DTEND;VALUE=DATE:" + Day(Clock.Text(Clock.Parse(e.Last ?? e.Date).AddDays(1)))]);
            if (e.Until is not null) lines.Add("RRULE:FREQ=WEEKLY;UNTIL=" + Local(e.Until, e.End!.Value - 480) + "Z");
            if (e.Skip?.Count > 0) lines.Add("EXDATE;TZID=Asia/Shanghai:" + string.Join(",", e.Skip.Select(date => Local(date, e.Start!.Value))));
            lines.Add("SUMMARY:" + Text(e.Summary)); if (e.Transparent) lines.Add("TRANSP:TRANSPARENT");
            if (e.Location.Length > 0) lines.Add("LOCATION:" + Text(e.Location)); if (e.Description.Length > 0) lines.Add("DESCRIPTION:" + Text(e.Description));
            foreach (var reminder in e.Reminders ?? []) lines.AddRange(["BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + Text(e.Summary), "TRIGGER:" + (reminder < 0 ? "" : "-") + "PT" + Math.Abs(reminder) + "M", "END:VALARM"]);
            lines.Add("END:VEVENT");
        }
        lines.Add("END:VCALENDAR"); return string.Join("\r\n", lines.Select(Fold)) + "\r\n";
    }
    internal static string Fold(string line)
    {
        var result = new StringBuilder(); var bytes = 0; var limit = 75;
        foreach (var rune in line.EnumerateRunes())
        {
            if (bytes + rune.Utf8SequenceLength > limit) { result.Append("\r\n "); bytes = 0; limit = 74; }
            result.Append(rune.ToString()); bytes += rune.Utf8SequenceLength;
        }
        return result.ToString();
    }
}
