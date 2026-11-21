using System.Text.RegularExpressions;
using StuDev.Data;

namespace StuDev.World;

/** Course names, teachers and progress from the same off-grid teaching facts as the web. */
public static class Practices
{
    public static string Name(Practice practice) => practice.Name.Contains('”') && !practice.Name.Contains('“') ? "“" + practice.Name : practice.Name;

    public static IEnumerable<string> Teachers(Practice practice) =>
        practice.Text.StartsWith(practice.Name, StringComparison.Ordinal)
            ? Regex.Replace(practice.Text[practice.Name.Length..], @"\(共\d+周\)/.*$", "")
                .Split([',', '，', '、'], StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            : [];

    public static string Progress(IReadOnlyList<int> weeks, int? current)
    {
        var first = weeks.Min();
        var last = weeks.Max();
        return current switch
        {
            null => $"第 {first} 周开始",
            { } week when week < first => $"{first - week} 周后开始",
            { } week when week > last => "已结束",
            { } week => $"进行中 · 第 {week - first + 1} / {last - first + 1} 周",
        };
    }

    public static string ResourceName(Practice practice) =>
        Regex.Replace(Regex.Replace(Name(practice), "[“”\"]", ""), "实践$", "").Trim();
}
