// What a person's own line suggests they write down, as src/campus/world/suggestions.ts: to revise the day before each
// exam, and to hand in the report a week after each lab. Offered until taken or put aside; nothing is added unasked.
using System.Text.RegularExpressions;
using StuDev.Data;

namespace StuDev.World;

public static partial class Suggestions
{
    public sealed record Suggestion(string Key, PersonalTask Task);
    private const int Offered = 3;

    [GeneratedRegex(@"^实验[一二三四五六七八九十\d]+\s*[：:]\s*")]
    private static partial Regex Numbered();

    /** 实验二：组网与路由器配置 → 组网与路由器配置实验报告; Cachelab实验(上) → Cachelab实验(上)报告. */
    public static string ReportTitle(string project)
    {
        var name = Numbered().Replace(project, "").Trim();
        if (name.Length == 0) name = project;
        return name.Contains("实验") ? $"{name}报告" : $"{name}实验报告";
    }

    private static string Linked(string? code, string name, List<TeachingMeeting> meetings) =>
        meetings.FirstOrDefault(m => CourseTones.Same(code, name, m.Course.Code, m.Course.Name)) is { } m ? CourseTones.Identity(m.Course.Code, m.Course.Name) : CourseTones.Identity(code, name);

    public static List<Suggestion> Suggest(CampusLine line, Moment now, IReadOnlyCollection<string> setAside)
    {
        var titles = line.Tasks.Where(t => t.Deleted != true).Select(t => t.Title).ToHashSet();
        var tomorrow = Clock.Text(now.Date.AddDays(1));
        var exams = line.Exams.Where(x => string.CompareOrdinal(x.Date, tomorrow) >= 0).OrderBy(x => x.Date, StringComparer.Ordinal).ThenBy(x => x.Start, StringComparer.Ordinal)
            .Select(x => new Suggestion($"exam:{x.Id}", new PersonalTask { Id = "", Title = $"复习{Names.CourseShort(x.Course.Name)}", Modified = "",
                Course = Linked(x.Course.Code, x.Course.Name, line.Meetings), Due = new Deadline(Clock.Text(Clock.Parse(x.Date).AddDays(-1))) }));
        var seen = new HashSet<string>();
        var today = Clock.Text(now.Date);
        var labs = line.Labs.Where(l => string.CompareOrdinal(l.Date, today) >= 0).OrderBy(l => l.Date, StringComparer.Ordinal).ThenBy(l => l.Start, StringComparer.Ordinal)
            .Where(l => seen.Add(Linked(l.Course.Code, l.Course.Name, line.Meetings)))
            .Select(l => new Suggestion($"lab:{l.Id}", new PersonalTask { Id = "", Title = ReportTitle(l.Project), Modified = "",
                Course = Linked(l.Course.Code, l.Course.Name, line.Meetings), Due = new Deadline(Clock.Text(Clock.Parse(l.Date).AddDays(7))) }));
        return exams.Concat(labs).OrderBy(s => s.Task.Due!.Date, StringComparer.Ordinal).ThenBy(s => s.Key, StringComparer.Ordinal)
            .Where(s => !setAside.Contains(s.Key) && !titles.Contains(s.Task.Title)).Take(Offered).ToList();
    }
}
