// What the AI is told when it asks about a course, a schedule or a training plan: src/campus/world/answers.ts, as
// Android's Answers.kt.
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using StuDev.Data;
using StuDev.World;

namespace StuDev.Ai;

public static class Answers
{
    private static readonly string[] Weekday = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
    private const int Shown = 24;

    /** Where a result's text is kept, as the data build writes it: an article by its own id, anything else by the first
     * 16 hex digits of the SHA-256 of its search id. */
    public static string TextKey(string id) => Regex.IsMatch(id, "^[0-9a-f]{16}$") ? id
        : Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(id)))[..16];

    /** Teaching weeks as read aloud: [1,2,3,5,7,8] → 1–3、5、7–8 周. */
    public static string WeeksText(IEnumerable<int> weeks)
    {
        var sorted = weeks.Distinct().Order().ToList(); var runs = new List<string>(); var start = 0;
        for (var i = 0; i < sorted.Count; i++)
        {
            if (i + 1 < sorted.Count && sorted[i + 1] == sorted[i] + 1) continue;
            runs.Add(start == i ? $"{sorted[i]}" : $"{sorted[start]}–{sorted[i]}");
            start = i + 1;
        }
        return runs.Count == 0 ? "" : $"{string.Join("、", runs)} 周";
    }

    /** encodeURIComponent: what the web writes into a link. */
    private static string Component(string value) => Uri.EscapeDataString(value).Replace("%21", "!").Replace("%27", "'").Replace("%28", "(").Replace("%29", ")").Replace("%2A", "*");
    private static string PlainKey(string name) { var plain = Regex.Replace(name, "[（(].*?[)）]", ""); return Lessons.Key(plain.Length > 0 ? plain : name); }
    /** A whole number as the web writes it (42, not 42.0). */
    private static JsonNode Number(double value) => value % 1 == 0 ? JsonValue.Create((long)value) : JsonValue.Create(value);
    private static JsonArray Strings(IEnumerable<string> values) => new([.. values.Select(v => (JsonNode)v)]);

    public static JsonObject Course(KnowledgeIndex index, List<CourseMaterials> shared, string asked)
    {
        var key = Lessons.Key(asked); var code = asked.Trim().ToUpperInvariant();
        var course = index.Courses.FirstOrDefault(c => Lessons.Key(c.Name) == key || c.Codes.Contains(code) || c.Former.Contains(code));
        if (course is null) { var near = index.Courses.Where(c => Lessons.Key(c.Name).Contains(key)).ToList(); if (near.Count == 1) course = near[0]; }
        if (course is null)
        {
            var near = index.Courses.Where(c => Lessons.Key(c.Name).Contains(key) || key.Contains(PlainKey(c.Name))).Take(8).Select(c => c.Name);
            var sharedOnly = Lessons.MaterialsSaid(shared, asked);
            var missing = new JsonObject { ["found"] = false, ["courses"] = Strings(near) };
            if (sharedOnly.ContainsKey("kinds")) missing["shared"] = sharedOnly;
            return missing;
        }
        var titles = index.Topics.ToDictionary(t => t.Id, t => t.Title);
        var materials = new JsonObject();
        foreach (var material in index.Materials.Where(m => m.Course == course.Id))
        {
            if (materials[material.Kind] is not JsonArray list) { list = []; materials[material.Kind] = list; }
            if (list.Count < 12) list.Add((JsonNode)new JsonObject { ["title"] = material.Title, ["id"] = $"sections/{material.Path}" });
        }
        var said = new JsonObject
        {
            ["found"] = true, ["course"] = course.Name, ["codes"] = Strings(course.Codes), ["url"] = $"/knowledge/?course={Component(course.Id)}",
            ["chapters"] = new JsonArray([.. course.Chapters.Select(chapter => (JsonNode)new JsonObject
            {
                ["title"] = chapter.Title,
                ["topics"] = new JsonArray([.. chapter.Topics.Select(id => (JsonNode)new JsonObject { ["id"] = $"topics/{id}", ["title"] = titles.GetValueOrDefault(id, id) })]),
            })]),
            ["materials"] = materials,
        };
        if (Lessons.MaterialsSaid(shared, course.Name)["kinds"] is { } kinds) said["shared"] = kinds.DeepClone();
        return said;
    }

    public static JsonObject Schedule(List<TeachingMeeting> meetings, string asked)
    {
        var key = Lessons.Key(asked); var code = asked.Trim().ToUpperInvariant();
        static string Room(TeachingMeeting m) { var room = Regex.Replace(m.Room ?? "", "^[^/:]*[/:]", ""); return room.Length > 0 ? room : m.Location ?? ""; }
        var found = meetings.Where(m => m.Course.Code == code || PlainKey(m.Course.Name) == PlainKey(asked) || Lessons.Key(m.Course.Name) == key
                || m.Teachers.Any(t => t.Name == asked.Trim()) || m.Classes.Any(c => c.ToUpperInvariant() == code)
                || (key.Length >= 3 && Lessons.Key(Room(m)) == key))
            .OrderBy(m => m.Weekday).ThenBy(m => m.Periods[0]).ThenBy(m => m.Course.Name, StringComparer.Ordinal).ToList();
        var said = new JsonObject { ["asked"] = asked, ["count"] = found.Count };
        if (found.Count > Shown) said["cut"] = true;
        said["meetings"] = new JsonArray([.. found.Take(Shown).Select(m => (JsonNode)new JsonObject
        {
            ["course"] = m.Course.Name, ["teachers"] = Strings(m.Teachers.Select(t => t.Name)),
            ["when"] = $"{Weekday[m.Weekday]} {m.Periods[0]}–{m.Periods[1]} 节",
            ["weeks"] = WeeksText(m.Weeks), ["where"] = Room(m), ["campus"] = m.Campus, ["classes"] = m.Classes.Count,
        })]);
        return said;
    }

    public static JsonObject Curriculum(List<CurriculumCourse> courses, string major, string? grade)
    {
        var all = courses.SelectMany(c => c.Plans.Select(p => p.Major)).Distinct().ToList(); var asked = major.Trim();
        var meant = all.Contains(asked) ? [asked] : all.Where(m => m.Contains(asked)).ToList();
        if (meant.Count != 1) return new JsonObject { ["found"] = false, ["majors"] = Strings((meant.Count > 0 ? meant : all).Take(20)) };
        var only = meant[0];
        var grades = courses.SelectMany(c => c.Plans.Where(p => p.Major == only).Select(p => p.Grade)).Distinct().Order().ToList();
        var selected = grade ?? (grades.Count == 1 ? grades[0] : null);
        if (selected is null || !grades.Contains(selected)) return new JsonObject { ["found"] = false, ["major"] = only, ["grades"] = Strings(grades) };
        var chosen = courses.SelectMany(c => c.Plans.Where(p => p.Major == only && p.Grade == selected).Select(p => (Course: c, Plan: p))).ToList();
        var names = courses.ToDictionary(c => c.Code, c => c.Name);
        return new JsonObject {
            ["found"] = true, ["major"] = only, ["grade"] = selected,
            ["terms"] = new JsonArray([.. chosen.Select(c => c.Plan.Term).Distinct().OrderBy(t => t ?? 99).Select(term =>
            {
                var list = chosen.Where(c => c.Plan.Term == term).ToList();
                return (JsonNode)new JsonObject {
                    ["term"] = term, ["credits"] = list.All(c => c.Plan.Credits.HasValue) ? Number(list.Sum(c => c.Plan.Credits!.Value)) : null,
                    ["courses"] = new JsonArray([.. list.Select(c => {
                        var one = new JsonObject { ["name"] = c.Course.Name, ["code"] = c.Course.Code, ["credits"] = c.Plan.Credits is {} credits ? Number(credits) : null, ["nature"] = c.Plan.Nature, ["category"] = c.Plan.Category };
                        if (c.Course.Requires.Count > 0) one["requires"] = Strings(c.Course.Requires.Select(r => names.GetValueOrDefault(r, r)));
                        return (JsonNode)one;
                    })])
                };
            })])
        };
    }
}
