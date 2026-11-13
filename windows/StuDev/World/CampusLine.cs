// A person along time: lessons, labs and exams on one line, with the school calendar's days off; the same rules as
// src/campus/world/events.ts and android world/CampusLine.kt, and the same answers (the parity golden locks them).
using StuDev.Data;

namespace StuDev.World;

public sealed record LineEvent(string Kind, string Id, DateOnly Date, string Name, string Short, int Start, int End, string? Room, List<string> Teachers,
    TeachingMeeting? Meeting = null, Lab? Lab = null, Exam? Exam = null, long Layer = 0, PersonalTask? Task = null, string Avoid = "prefer");
/** An event as drawn among those it shares a time with: how many lie behind it and how many in front. */
public sealed record Layered(LineEvent Event, int Under, int Over);
public sealed record EventCluster(LineEvent Front, List<LineEvent> Events, int Start, int End);

public sealed class CampusLine(TeachingTerm term, List<TeachingPeriod> periods, List<TeachingMeeting> meetings, List<Lab> labs, List<Exam> exams, Dictionary<DateOnly, string> holidays)
{
    public TeachingTerm Term { get; } = term;
    public List<TeachingMeeting> Meetings { get; } = meetings;
    public List<Lab> Labs { get; } = labs;
    public List<Exam> Exams { get; } = exams;
    public Dictionary<DateOnly, string> Holidays { get; } = holidays;
    private readonly Dictionary<int, TeachingPeriod> byPeriod = periods.ToDictionary(period => period.Period);
    public List<TeachingPeriod> Periods { get; } = periods;
    public List<TeachingMeeting> CourseMeetings { get; init; } = meetings;
    public List<PersonalTask> Tasks { get; set; } = [];
    public Dictionary<string, string>? CourseNames { get; init; }
    public Dictionary<string, Me.EventChoice>? Preferences { get; init; }
    public IReadOnlyList<string> Order { get; init; } = LayerOrder;
    public MorningRun? Run { get; init; }
    public List<string> RunDays { get; init; } = [];
    public int RunAdjust { get; init; }

    /** Front first: an exam, then one's own task, a lab, a lesson, 早锻炼. */
    public static readonly string[] LayerOrder = ["exam", "task", "lab", "class", "run"];

    public int? WeekOf(DateOnly date)
    {
        var text = Clock.Text(date);
        return Term.Weeks.FirstOrDefault(week => string.CompareOrdinal(text, week.Start) >= 0 && string.CompareOrdinal(text, week.End) <= 0)?.Week;
    }

    public List<LineEvent> On(DateOnly date)
    {
        var events = new List<LineEvent>();
        var week = WeekOf(date); var weekday = Clock.Weekday(date); var text = Clock.Text(date);
        // The school calendar decides: nobody has lessons on a public holiday.
        if (week is { } w && !Holidays.ContainsKey(date))
            foreach (var meeting in Meetings)
            {
                if (meeting.Weekday != weekday || !meeting.Weeks.Contains(w)) continue;
                if (!byPeriod.TryGetValue(meeting.Periods[0], out var first) || !byPeriod.TryGetValue(meeting.Periods[^1], out var last)) continue;
                events.Add(new("class", $"{meeting.Id}@{text}", date, Names.Course(meeting.Course.Name), Names.CourseShort(meeting.Course.Name),
                    Clock.Minutes(first.Start), Clock.Minutes(last.End), meeting.Room ?? meeting.Location, meeting.Teachers.Select(t => t.Name).ToList(), Meeting: meeting));
            }
        // A lab is set for its date, so it stands even on a day the calendar stops lessons.
        foreach (var lab in Labs.Where(lab => lab.Date == text))
            events.Add(new("lab", lab.Id, date, Names.Course(lab.Course.Name), Names.CourseShort(lab.Course.Name), Clock.Minutes(lab.Start), Clock.Minutes(lab.End), lab.Room ?? lab.Place, lab.Teachers, Lab: lab));
        foreach (var exam in Exams.Where(exam => exam.Date == text))
            events.Add(new("exam", exam.Id, date, Names.Course(exam.Course.Name), Names.CourseShort(exam.Course.Name), Clock.Minutes(exam.Start), Clock.Minutes(exam.End), exam.Room ?? exam.Location,
                exam.Teacher is null ? [] : [exam.Teacher], Exam: exam));
        foreach (var task in Tasks.Where(t => t.Parent is null && t.Deleted != true && t.Date == text && t.Start is not null))
            events.Add(new("task", task.Id, date, task.Title, task.Title, task.Start!.Value, task.End ?? Math.Min(1440, task.Start.Value + 30), null, [], Task: task));
        if (Run is { } rule && RunDays.Contains(text)) events.Add(new("run", $"run@{text}", date, "早锻炼", "早锻炼", Clock.Minutes(rule.Time[0]), Clock.Minutes(rule.Time[1]), null, []));
        return events.Select(e =>
        {
            var choice = Me.Choices.Preference(e, Term.Term, Preferences);
            var code = e.Meeting?.Course.Code ?? e.Lab?.Course.Code ?? e.Exam?.Course.Code;
            var sourceName = e.Meeting?.Course.Name ?? e.Lab?.Course.Name ?? e.Exam?.Course.Name;
            var linked = sourceName is null ? null : CourseMeetings.FirstOrDefault(m => CourseTones.Same(m.Course.Code, m.Course.Name, code, sourceName));
            var identity = sourceName is null ? null : CourseTones.Identity(linked?.Course.Code ?? code, linked?.Course.Name ?? sourceName);
            var name = identity is null ? null : CourseNames?.GetValueOrDefault(identity);
            if (name is null && e.Meeting?.TeachingClass.Id.StartsWith("custom:") == true) name = e.Meeting.Course.Name;
            return e with { Name = name ?? e.Name, Short = name ?? e.Short, Avoid = choice.Avoid!, Layer = choice.Layer ?? 0 };
        }).OrderBy(e => e.Start).ThenBy(e => e, FrontFirst(Order)).ToList();
    }

    public List<PersonalTask> DueOn(DateOnly date) => Tasks.Where(t => t.Deleted != true && t.Parent is null && t.Due?.Date == Clock.Text(date)).ToList();
    public LineEvent? Next(Moment now, int horizon = 40)
    {
        for (var i = 0; i < horizon; i++)
            foreach (var e in On(now.Date.AddDays(i)))
                if (e.Kind is not ("run" or "task") && (i > 0 || e.End > now.Min)) return e;
        return null;
    }
    public DateOnly WeekShown(Moment now)
    {
        for (var i = 0; i < 60; i++)
        {
            var date = now.Date.AddDays(i);
            if (DueOn(date).Any(t => t.Done is null) || On(date).Any(e => e.Kind != "run" && e.Task?.Done is null && (i > 0 || e.End > now.Min))) return Clock.WeekStart(date);
        }
        return Clock.WeekStart(now.Date);
    }
    public DateOnly? LastLesson()
    {
        var start = Clock.Parse(Term.Weeks[0].Start);
        for (var date = Clock.Parse(Term.Weeks[^1].End); date >= start; date = date.AddDays(-1))
            if (On(date).Any(e => e.Kind is "class" or "lab")) return date;
        return null;
    }
    public List<TeachingMeeting> OffWeek(int week)
    {
        var kept = new List<TeachingMeeting>();
        foreach (var meeting in Meetings.Where(m => m.Weeks.Count > 0 && !m.Weeks.Contains(week) && week >= m.Weeks.Min() && week <= m.Weeks.Max())
            .OrderBy(m => m.Weekday).ThenBy(m => m.Periods[0]).ThenBy(m => m.Periods[^1]).ThenBy(m => m.Id, StringComparer.Ordinal))
            if (!kept.Any(other => other.Weekday == meeting.Weekday && other.Periods[0] <= meeting.Periods[^1] && meeting.Periods[0] <= other.Periods[^1])) kept.Add(meeting);
        return kept;
    }
    public LineEvent? Around(string meeting, DateOnly from)
    {
        for (var date = from; date <= Clock.Parse(Term.Weeks[^1].End); date = date.AddDays(1))
            if (On(date).FirstOrDefault(e => e.Meeting?.Id == meeting) is { } e) return e;
        for (var date = from.AddDays(-1); date >= Clock.Parse(Term.Weeks[0].Start); date = date.AddDays(-1))
            if (On(date).FirstOrDefault(e => e.Meeting?.Id == meeting) is { } e) return e;
        return null;
    }
    public List<DateOnly> Runnable()
    {
        var dates = new List<DateOnly>(); if (Run is not { } rule) return dates;
        for (var date = Clock.Parse(rule.Start); date <= Clock.Parse(rule.End); date = date.AddDays(1))
            if (Clock.Weekday(date) <= 5 && !Holidays.ContainsKey(date)) dates.Add(date);
        return dates;
    }
    public (int Done, int Planned, int Count, int Need) RunTally(Moment now)
    {
        var done = Run is { } rule ? RunDays.Count(day => string.CompareOrdinal(day, Clock.Text(now.Date)) < 0 || day == Clock.Text(now.Date) && now.Min >= Clock.Minutes(rule.Time[1])) : 0;
        var planned = RunDays.Count - done; var count = done + RunAdjust;
        return (done, planned, count, Math.Max(0, (Run?.Required ?? 0) - count - planned));
    }
    public List<string> PlanRuns(Moment now)
    {
        if (Run is not { } rule) return [];
        var from = now.Min < Clock.Minutes(rule.Time[0]) ? now.Date : now.Date.AddDays(1);
        var days = RunDays.Where(day => string.CompareOrdinal(day, Clock.Text(from)) < 0).ToList();
        var open = Runnable().Where(date => date >= from).ToList();
        var done = days.Count; var need = Math.Min(open.Count, Math.Max(0, rule.Required - done - RunAdjust));
        DateOnly? last = null;
        for (var part = 0; part < need; part++)
        {
            var start = part * open.Count / need; var stretch = open.Skip(start).Take((part + 1) * open.Count / need - start).ToList();
            var middle = (stretch.Count - 1) / 2.0;
            double Score(DateOnly date, int position) => (On(date).Any(e => e.Kind is "class" or "lab" && e.Start <= 480) ? 4 : 0)
                + (last is { } prior && date.DayNumber - prior.DayNumber < 2 ? -3 : 0) - Math.Abs(position - middle) / Math.Max(1, stretch.Count);
            var best = 0;
            for (var at = 0; at < stretch.Count; at++) if (Score(stretch[at], at) > Score(stretch[best], best)) best = at;
            last = stretch[best]; days.Add(Clock.Text(last.Value));
        }
        return days.Order(StringComparer.Ordinal).ToList();
    }

    private static bool Clash(LineEvent left, LineEvent right) => !ReferenceEquals(left, right) && left.Date == right.Date && left.Start < right.End && right.Start < left.End;
    private static IComparer<LineEvent> FrontFirst(IReadOnlyList<string> order) => Comparer<LineEvent>.Create((a, b) =>
    {
        var c = b.Layer.CompareTo(a.Layer); if (c != 0) return c;
        c = IndexOf(order, a.Kind).CompareTo(IndexOf(order, b.Kind)); if (c != 0) return c;
        c = a.Start.CompareTo(b.Start); if (c != 0) return c;
        return string.CompareOrdinal(a.Id, b.Id);
    });
    private static int IndexOf(IReadOnlyList<string> order, string kind) { for (var i = 0; i < order.Count; i++) if (order[i] == kind) return i; return -1; }

    /** A day's events as layers, back to front, the order they are drawn in. */
    public static List<Layered> Layers(List<LineEvent> events, IReadOnlyList<string>? order = null)
    {
        var front = events.OrderBy(e => e, FrontFirst(order ?? LayerOrder)).ToList();
        var layers = front.Select((e, rank) => new Layered(e, front.Skip(rank + 1).Count(o => Clash(o, e)), front.Take(rank).Count(o => Clash(o, e)))).ToList();
        layers.Reverse();
        return layers;
    }
    public static List<EventCluster> Clusters(List<LineEvent> events, IReadOnlyList<string>? order = null)
    {
        var groups = new List<List<LineEvent>>();
        foreach (var e in events.OrderBy(e => e.Start).ThenBy(e => e.End))
        {
            if (groups.LastOrDefault() is { } last && e.Start < last.Max(o => o.End)) last.Add(e);
            else groups.Add([e]);
        }
        return groups.Select(g => new EventCluster(g.Order(FrontFirst(order ?? LayerOrder)).First(), g, g[0].Start, g.Max(e => e.End))).ToList();
    }

    /** The days without lessons: public holidays, and the school events that stop lessons by custom. */
    public static Dictionary<DateOnly, string> HolidaysOf(List<CalendarTerm> terms)
    {
        var days = new Dictionary<DateOnly, string>();
        foreach (var t in terms)
            foreach (var item in (t.Holidays ?? []).Concat(t.Events ?? []))
                for (var d = Clock.Parse(item.Start); d <= Clock.Parse(item.End); d = d.AddDays(1))
                    days[d] = days.TryGetValue(d, out var before) ? $"{before}、{item.Name}" : item.Name;
        return days;
    }

    /** The span of the day a week view shows: from the first start to the last end, at least 08:00–21:08. */
    public static (int From, int To) TimeBounds(IEnumerable<LineEvent> events)
    {
        var list = events.ToList();
        return (Math.Max(0, Math.Min(480, list.Count > 0 ? list.Min(e => e.Start) : 480) - 4), Math.Min(1440, Math.Max(1268, list.Count > 0 ? list.Max(e => e.End + 4) : 1268)));
    }
}
