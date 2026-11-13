using System.Text.RegularExpressions;

namespace StuDev.Me;

public static class Courses
{
    public static List<int>? Weeks(string text, int last)
    {
        int? parity = Regex.IsMatch(text, @"^\s*单") ? 1 : Regex.IsMatch(text, @"^\s*双") ? 0 : null;
        var body = Regex.Replace(text, @"^\s*[单双]\s*", "").Replace("周", ""); var weeks = new SortedSet<int>();
        foreach (var part in Regex.Split(body, @"[,，、\s]+").Where(s => s.Length > 0))
        {
            var match = Regex.Match(part, @"^(\d{1,2})(?:[-~–](\d{1,2}))?$"); if (!match.Success) return null;
            var from = int.Parse(match.Groups[1].Value); var to = match.Groups[2].Success ? int.Parse(match.Groups[2].Value) : from;
            if (from < 1 || to < from || to > last) return null;
            for (var week = from; week <= to; week++) if (parity is null || week % 2 == parity) weeks.Add(week);
        }
        return weeks.Count > 0 ? weeks.ToList() : null;
    }
}
