using System.Text.RegularExpressions;

namespace StuDev.World;

public sealed record QuickCourse(string Identity, List<string> Names);
public sealed record QuickTask(string Title, string? Date, int? Start, int? End, Deadline? Due, int? Priority, string? Course, List<int[]> Marks);

/** One line's dates, time, deadline, priority and course, with the same spans the other clients highlight. */
public static class QuickTasks
{
    private const string Num = @"(\d{1,2}|[一二两三四五六七八九十]{1,3})";
    private const string Part = "(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上)";
    private const string ClockPattern = @"(?:(\d{1,2})[:：](\d{2})|" + Num + @"点(?:(半)|(一刻)|(三刻)|(\d{1,2})分?)?|(\d{1,2})\s*(am|pm|AM|PM))";
    private static readonly string Digits = "零一二三四五六七八九";
    public static int? Number(string text)
    {
        if (int.TryParse(text, out var digits)) return digits;
        var value = text.Replace('两', '二');
        if (!Regex.IsMatch(value, "^[零一二三四五六七八九十]+$")) return null;
        var ten = value.IndexOf('十');
        if (ten < 0) return value.Length == 1 ? Digits.IndexOf(value[0]) : null;
        var tens = ten == 0 ? 1 : value[..ten].Length == 1 ? Digits.IndexOf(value[0]) : -1;
        var ones = ten == value.Length - 1 ? 0 : value[(ten + 1)..].Length == 1 ? Digits.IndexOf(value[ten + 1]) : -1;
        return value.Length > 3 || tens < 1 || ones < 0 ? null : tens * 10 + ones;
    }
    private static string? Group(Match m, int index) => m.Groups[index].Success ? m.Groups[index].Value : null;
    private static int? ClockOf(Match m, int at, string? part)
    {
        var hour = 0; var min = 0;
        if (Group(m, at) is { } h) { hour = int.Parse(h); min = int.Parse(m.Groups[at + 1].Value); }
        else if (Group(m, at + 2) is { } chinese)
        {
            if (chinese == "一" && part is null && Enumerable.Range(at + 3, 4).All(i => Group(m, i) is null)) return null;
            if (Number(chinese) is not { } number) return null;
            hour = number;
            min = Group(m, at + 3) is not null ? 30 : Group(m, at + 4) is not null ? 15 : Group(m, at + 5) is not null ? 45 : Group(m, at + 6) is { } minute ? int.Parse(minute) : 0;
        }
        else
        {
            hour = int.Parse(m.Groups[at + 7].Value);
            if (m.Groups[at + 8].Value.Equals("pm", StringComparison.OrdinalIgnoreCase) && hour < 12) hour += 12;
            if (m.Groups[at + 8].Value.Equals("am", StringComparison.OrdinalIgnoreCase) && hour == 12) hour = 0;
        }
        if (hour > 24 || min > 59) return null;
        if (part is "下午" or "傍晚" or "晚上" && hour < 12) hour += 12;
        else if (part == "中午" && hour < 6) hour += 12;
        else if (part is null && Group(m, at + 2) is not null && hour is >= 1 and <= 5) hour += 12;
        return hour == 24 ? null : hour * 60 + min;
    }
    private static DateOnly? Date(int year, int month, int day)
    {
        if (year is < 1 or > 9999 || month is < 1 or > 12 || day < 1 || day > DateTime.DaysInMonth(year, month)) return null;
        return new(year, month, day);
    }

    public static QuickTask Parse(string input, Moment now, List<QuickCourse>? courses = null)
    {
        var line = input.Trim(); var used = new List<int[]>();
        bool Free(int from, int to) => used.All(span => to <= span[0] || span[1] <= from);
        int[]? Take(string pattern, Func<Match, bool> read)
        {
            var regex = new Regex(pattern, RegexOptions.CultureInvariant);
            for (var m = regex.Match(line); m.Success; m = regex.Match(line, m.Index + 1))
            {
                if (m.Length == 0 || !Free(m.Index, m.Index + m.Length) || !read(m)) continue;
                int[] span = [m.Index, m.Index + m.Length]; used.Add(span); return span;
            }
            return null;
        }
        string? date = null, part = null, course = null; int? start = null, end = null, priority = null; var deadline = false;
        string Day(int count) => Clock.Text(now.Date.AddDays(count));
        var daySpan = Take("(大后天|明天早上|明天晚上|后天|明天|今天|今晚|今早|明晚|明早)", m =>
        {
            var word = m.Groups[1].Value; date = Day(word.StartsWith("大后") ? 3 : word.StartsWith("后") ? 2 : word.StartsWith("明") ? 1 : 0);
            if (word.Contains('晚')) part = "晚上"; else if (word.Contains('早')) part = "早上"; return true;
        }) ?? Take(Num + @"\s*(天|周|个星期|星期|个月)(?:后|以后|之后)", m =>
        {
            var count = Number(m.Groups[1].Value); if (count is null or <= 0 or >= 100) return false;
            date = m.Groups[2].Value == "天" ? Day(count.Value) : m.Groups[2].Value == "个月" ? Clock.Text(now.Date.AddMonths(count.Value)) : Day(count.Value * 7); return true;
        }) ?? Take(@"(下下|下|这|本)?(?:个)?(?:周|星期|礼拜)([一二三四五六日天末])", m =>
        {
            var word = m.Groups[2].Value; var weekday = word == "末" ? 6 : "一二三四五六日天".IndexOf(word, StringComparison.Ordinal) % 7 + 1;
            var today = Clock.Weekday(now.Date); var ahead = m.Groups[1].Value == "下下" ? 14 : m.Groups[1].Value == "下" ? 7 : 0;
            date = Day(ahead > 0 ? ahead - today + weekday : (weekday - today + 7) % 7); return true;
        }) ?? Take(@"(?<![第\d])(?:(\d{4})\s*[年\-/.])?(\d{1,2})\s*[月\-/.]\s*(\d{1,2})(?![\d节周页章题])(?:\s*[日号])?", m =>
        {
            var month = int.Parse(m.Groups[2].Value); var day = int.Parse(m.Groups[3].Value); var year = Group(m, 1) is { } y ? int.Parse(y) : now.Date.Year;
            var found = Date(year, month, day);
            if (found is not null && Group(m, 1) is null && found < now.Date && month < now.Date.Month) found = Date(year + 1, month, day);
            if (found is null) return false; date = Clock.Text(found.Value); return true;
        }) ?? Take(Num + @"\s*[日号]", m =>
        {
            var number = Number(m.Groups[1].Value); if (number is null) return false;
            var found = Date(now.Date.Year, now.Date.Month, number.Value);
            if (found is not null && found < now.Date) { var next = now.Date.AddMonths(1); found = Date(next.Year, next.Month, number.Value); }
            if (found is null) return false; date = Clock.Text(found.Value); return true;
        }) ?? Take("月底", _ => { date = Clock.Text(new(now.Date.Year, now.Date.Month, DateTime.DaysInMonth(now.Date.Year, now.Date.Month))); return true; });
        var timeSpan = Take(Part + @"?\s*" + ClockPattern + @"\s*(?:-|~|–|—|到|至)\s*" + Part + @"?\s*" + ClockPattern, m =>
        {
            var from = ClockOf(m, 2, Group(m, 1) ?? part); var to = ClockOf(m, 12, Group(m, 11) ?? Group(m, 1) ?? part);
            if (from is null || to is null) return false;
            var until = to > from ? to : to + 720 > from && to + 720 < 1440 ? to + 720 : null;
            if (until is null) return false; start = from; end = until; return true;
        }) ?? Take(Part + @"?\s*" + ClockPattern, m =>
        {
            var at = ClockOf(m, 2, Group(m, 1) ?? part); if (at is null) return false; start = at; return true;
        });
        Take("(截止|之前|以前|ddl|DDL)", _ => { deadline = true; return true; });
        var after = Math.Max(daySpan?[1] ?? -1, timeSpan?[1] ?? -1);
        if (after >= 0 && after < line.Length && line[after] == '前' && Free(after, after + 1)) { used.Add([after, after + 1]); deadline = true; }
        Take("[!！](高|中|低)|[!！]{1,3}", m => { priority = Group(m, 1) is { } p ? p == "高" ? 3 : p == "中" ? 2 : 1 : m.Length; return true; });
        Take(@"[#＃](\S+)", m =>
        {
            var word = m.Groups[1].Value;
            var found = courses?.FirstOrDefault(c => c.Names.Any(n => n.Equals(word, StringComparison.OrdinalIgnoreCase)))
                ?? courses?.FirstOrDefault(c => c.Names.Any(n => n.Contains(word, StringComparison.OrdinalIgnoreCase)));
            if (found is null) return false; course = found.Identity; return true;
        });
        used.Sort((a, b) => a[0].CompareTo(b[0])); var title = new System.Text.StringBuilder(); var position = 0;
        foreach (var span in used) { title.Append(line[position..span[0]]).Append(' '); position = span[1]; }
        title.Append(line[position..]); var said = Regex.Replace(title.ToString(), @"\s+", " ").Trim('，', ',', '、', ' ');
        if (said.Length == 0) said = line;
        if (start is not null && date is null) date = Clock.Text(now.Date);
        return date is not null && (start is null || deadline) ? new(said, null, null, null, new(date, start), priority, course, used)
            : new(said, date, start, end, null, priority, course, used);
    }
}
