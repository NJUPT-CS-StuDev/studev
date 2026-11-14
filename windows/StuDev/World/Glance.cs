// What a glance outside the app shows: the desktop widgets here and the home-screen widgets on Android read the same
// line through the same rules as src/campus/world/glance.ts, locked by the parity golden. The calendar glance shows a
// day, a week or the term; the list glance shows what is due and the exams ahead.
namespace StuDev.World;

public sealed record GlanceDay(DateOnly Date, List<LineEvent> Events);
public sealed record GlanceTermDay(DateOnly Date, int Lessons, bool Exam, bool Off);
public sealed record GlanceTermWeek(int Week, DateOnly Start, List<GlanceTermDay> Days);
public sealed record GlanceExamDay(DateOnly Date, int Days, List<LineEvent> Events);

public static class Glance
{
    public const int Horizon = 30, DueDays = 7, ExamDays = 14;

    private static bool Open(LineEvent e) => e.Kind != "run" && e.Task?.Done is null;

    /** The rest of today, or the next day that has something. */
    public static GlanceDay Day(CampusLine line, Moment now)
    {
        var left = line.On(now.Date).Where(e => Open(e) && e.End > now.Min).ToList();
        if (left.Count > 0) return new(now.Date, left);
        for (var offset = 1; offset <= Horizon; offset++)
        {
            var date = now.Date.AddDays(offset);
            var events = line.On(date).Where(Open).ToList();
            if (events.Count > 0) return new(date, events);
        }
        return new(now.Date, []);
    }

    /** The week shown, Monday to Sunday, the weekend only when something happens on it. */
    public static List<GlanceDay> Week(CampusLine line, Moment now)
    {
        var monday = line.WeekShown(now);
        return Enumerable.Range(0, 7).Select(i => monday.AddDays(i)).Select(date => new GlanceDay(date, line.On(date).Where(Open).ToList()))
            .Where(day => Clock.Weekday(day.Date) <= 5 || day.Events.Count > 0).ToList();
    }

    /** The term as weeks of days: lessons on each, an exam, a day off. */
    public static List<GlanceTermWeek> Term(CampusLine line) => line.Term.Weeks.Select(week =>
    {
        var start = Clock.WeekStart(Clock.Parse(week.Start));
        return new GlanceTermWeek(week.Week, start, Enumerable.Range(0, 7).Select(i => start.AddDays(i)).Select(date =>
        {
            var events = line.On(date);
            return new GlanceTermDay(date, events.Count(e => e.Kind is "class" or "lab"), events.Any(e => e.Kind == "exam"), line.Holidays.ContainsKey(date));
        }).ToList());
    }).ToList();

    /** Open tasks due soon or already late, in the order they are due, the more important first on the same day. */
    public static List<PersonalTask> Due(CampusLine line, Moment now)
    {
        var last = Clock.Text(now.Date.AddDays(DueDays));
        return line.Tasks.Where(t => t.Parent is null && t.Deleted != true && t.Done is null && t.Due is { } d && string.CompareOrdinal(d.Date, last) <= 0)
            .OrderBy(t => t.Due!.Date, StringComparer.Ordinal).ThenBy(t => t.Due!.Time ?? 1440).ThenByDescending(t => t.Priority ?? 0).ThenBy(t => t.Id, StringComparer.Ordinal).ToList();
    }

    /** Exams in the next two weeks, after today. */
    public static List<GlanceExamDay> Exams(CampusLine line, Moment now) => line.Exams.Select(e => Clock.Parse(e.Date)).Distinct().Order()
        .Select(date => (date, away: date.DayNumber - now.Date.DayNumber)).Where(x => x.away >= 1 && x.away <= ExamDays)
        .Select(x => new GlanceExamDay(x.date, x.away, line.On(x.date).Where(e => e.Kind == "exam").ToList())).ToList();

    /** The next moment a glance reads differently: something starting or ending today, else the next midnight. */
    public static Moment NextChange(CampusLine line, Moment now)
    {
        var minutes = line.On(now.Date).SelectMany(e => new[] { e.Start, e.End }).Where(m => m > now.Min).ToList();
        return minutes.Count > 0 ? new Moment(now.Date, minutes.Min()) : new Moment(now.Date.AddDays(1), 0);
    }
}
