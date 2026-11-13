// What a sheet says of a lesson, a lab or an exam: its weeks, how often it still meets, the lessons sharing its slot
// on other weeks, and what students have shared for the course. src/campus/world/exams.ts, events.ts, materials.ts.
using StuDev.Data;

namespace StuDev.World;

public sealed record Material(string Title, string Url, string Kind, string? Term = null, string? Ext = null);
public sealed record MaterialNote(string Title, string Url);
public sealed record CourseMaterials(string Course, string Source, MaterialNote? Note, List<Material> Items);

public static class Lessons
{
    /** "1–16 周", "1–17 周（单）", "2、5、9 周". */
    public static string WeeksText(IEnumerable<int> weeks)
    {
        var sorted = weeks.Order().ToList();
        if (sorted.Count == 0) return "";
        var (first, last) = (sorted[0], sorted[^1]);
        if (sorted.Count == 1) return $"第 {first} 周";
        if (last - first + 1 == sorted.Count) return $"{first}–{last} 周";
        if (sorted.Skip(1).Select((week, i) => week - sorted[i]).All(step => step == 2)) return $"{first}–{last} 周（{(first % 2 == 1 ? "单" : "双")}）";
        return $"{string.Join("、", sorted)} 周";
    }

    /** How many times a lesson still meets from now: the weeks it is on, less public holidays. */
    public static int Left(CampusLine line, TeachingMeeting meeting, Moment now, int end)
    {
        var left = 0;
        foreach (var week in meeting.Weeks)
        {
            if (line.Term.Weeks.FirstOrDefault(w => w.Week == week)?.Start is not { } start) continue;
            var first = Clock.Parse(start); var date = first.AddDays(meeting.Weekday - Clock.Weekday(first));
            if (line.Holidays.ContainsKey(date)) continue;
            if (date > now.Date || (date == now.Date && end > now.Min)) left++;
        }
        return left;
    }

    public static Course? CourseOf(List<TeachingMeeting> meetings, ExamCourse course) =>
        meetings.FirstOrDefault(m => (m.Course.Code ?? m.Course.Name) == (course.Code ?? course.Name))?.Course;

    /** "3 学分 · 必修 · 考核：考试". */
    public static string CourseLine(double? credits, string? nature, string? assessment = null) =>
        string.Join(" · ", new[] { credits is { } c ? $"{c:0.#} 学分" : null, nature, assessment is { Length: > 0 } a ? $"考核：{a}" : null }.Where(s => !string.IsNullOrEmpty(s)));

    /** The lessons in the same slot on other weeks, off this week. */
    public static List<TeachingMeeting> SharingSlot(CampusLine line, LineEvent e)
    {
        if (e.Meeting is not { } own || line.WeekOf(e.Date) is not { } week) return [];
        return line.Meetings.Where(o => o.Id != own.Id && o.Weekday == own.Weekday && !o.Weeks.Contains(week) && o.Weeks.Count > 0
            && o.Periods[0] <= own.Periods[^1] && own.Periods[0] <= o.Periods[^1] && week >= o.Weeks.Min() && week <= o.Weeks.Max()).ToList();
    }

    public static readonly string[] MaterialKinds = ["试卷", "答案", "复习", "习题", "课件", "实验", "资料"];
    private static string Key(string name) => System.Text.RegularExpressions.Regex.Replace(name.Replace('（', '(').Replace('）', ')'), "[ \t　]", "").ToLowerInvariant();
    public static CourseMaterials? MaterialsOf(List<CourseMaterials> all, string course) => all.FirstOrDefault(m => Key(m.Course) == Key(course));
    public static IEnumerable<(string Kind, int Count)> KindCounts(List<Material> items) =>
        MaterialKinds.Select(kind => (kind, items.Count(i => i.Kind == kind))).Where(k => k.Item2 > 0);
    /** A material's name as shown: its file's name, with its folder when the name alone says little. */
    public static string Shown(string title)
    {
        var parts = System.Text.RegularExpressions.Regex.Replace(title, @"\.[a-z0-9]+$", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase).Split(" · ");
        var name = parts[^1];
        return name.Length > 4 || parts.Length < 2 ? name : $"{parts[^2]} {name}";
    }
}
