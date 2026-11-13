// One timetable's colours, as src/campus/timetable/model/courseColors.ts: courses meeting on the same day get different
// tones, at least one tone apart where they can; a lab takes its course's tone.
using StuDev.Data;

namespace StuDev.World;

public static class CourseTones
{
    /** Where each tone sits on the hue circle, in steps of 30°. */
    private static readonly int[] Position = [7, 5, 4, 3, 2, 1, 0, 11, 10, 9, 8, 6];
    /** Which tone to prefer when all else is equal: the first three 120° apart, the first six 60° apart. */
    private static readonly int[] Order = [0, 7, 3, 9, 5, 1, 10, 6, 2, 8, 4, 11];
    private static int Apart(int left, int right) { var steps = Math.Abs(Position[left] - Position[right]); return Math.Min(steps, Position.Length - steps); }

    // The contract uses ECMAScript whitespace (including BOM, excluding control separators) and full upper casing.
    private const string Whitespace = @"[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]";
    private static string Trim(string text) => System.Text.RegularExpressions.Regex.Replace(text, $"^{Whitespace}+|{Whitespace}+$", "");
    public static string Identity(string? code, string name) => code is not null && Trim(code).Length > 0
        ? Trim(code).Replace("ß", "SS").ToUpperInvariant() : System.Text.RegularExpressions.Regex.Replace(Trim(name), Whitespace + "+", " ");
    public static bool Same(string? leftCode, string leftName, string? rightCode, string rightName) =>
        Identity(leftCode, leftName) == Identity(rightCode, rightName) || string.Equals(Names.Course(leftName), Names.Course(rightName), StringComparison.OrdinalIgnoreCase);
    private static string Linked(Lab lab, List<TeachingMeeting> meetings) =>
        meetings.FirstOrDefault(m => Same(lab.Course.Code, lab.Course.Name, m.Course.Code, m.Course.Name)) is { } m ? Identity(m.Course.Code, m.Course.Name) : Identity(lab.Course.Code, lab.Course.Name);

    public static Dictionary<string, int> Of(CampusLine line) =>
        Allot(line.Meetings.Select(m => (Identity(m.Course.Code, m.Course.Name), m.Weekday)).Concat(line.Labs.Select(l => (Linked(l, line.CourseMeetings), l.Weekday))));

    public static int? ToneOf(LineEvent e, Dictionary<string, int> tones, List<TeachingMeeting> meetings) =>
        e.Meeting is { } m ? tones.GetValueOrDefault(Identity(m.Course.Code, m.Course.Name)) : e.Lab is { } l ? tones.GetValueOrDefault(Linked(l, meetings)) : null;

    private static Dictionary<string, int> Allot(IEnumerable<(string Id, int Day)> items)
    {
        var days = new Dictionary<string, HashSet<int>>();
        foreach (var (id, day) in items) { if (!days.TryGetValue(id, out var set)) days[id] = set = []; set.Add(day); }
        var ids = days.Keys.OrderBy(k => k, StringComparer.Ordinal).ToList();
        var neighbours = ids.ToDictionary(id => id, id => ids.Where(o => o != id && days[id].Overlaps(days[o])).ToList());
        var tones = new Dictionary<string, int>();
        var used = new int[Position.Length];
        foreach (var id in ids.OrderByDescending(id => neighbours[id].Count).ThenBy(id => id, StringComparer.Ordinal))
        {
            var near = neighbours[id].Where(tones.ContainsKey).Select(o => tones[o]).ToList();
            int[] Score(int tone) => [near.Contains(tone) ? 0 : 1, near.Select(o => Apart(tone, o)).Append(2).Min(), -used[tone], -Array.IndexOf(Order, tone)];
            static bool Better(int[] l, int[] r) { for (var i = 0; i < l.Length; i++) if (l[i] != r[i]) return l[i] > r[i]; return false; }
            var best = Order[0];
            foreach (var tone in Order) if (Better(Score(tone), Score(best))) best = tone;
            tones[id] = best; used[best]++;
        }
        return tones;
    }
}
