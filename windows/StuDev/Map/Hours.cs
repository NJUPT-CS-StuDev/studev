// Whether a place is open, as src/campus/map/model/hours.ts and Android's Recommendations.hoursAt: half-open intervals,
// closing 30 minutes before the end, overnight windows carried from the day before. The parity golden locks it.
using System.Text.Json;

namespace StuDev.Map;

public enum Open { Unknown, Closed, Closing, Open }
public sealed record HoursNow(Open Open, string Today, string? ClosesAt);

public static class Hours
{
    private static int Clock(string value) => int.Parse(value[..2]) * 60 + int.Parse(value[3..5]);
    private static List<string[]> Day(JsonElement week, int day) => week.TryGetProperty(day.ToString(), out var list) ? list.EnumerateArray().Select(w => w.EnumerateArray().Select(t => t.GetString()!).ToArray()).ToList() : [];

    public static HoursNow At(JsonElement? hours, int day, int minute)
    {
        if (hours is not { ValueKind: JsonValueKind.Object } h || !h.TryGetProperty("week", out var week)) return new(Open.Unknown, "", null);
        var todays = Day(week, day);
        var today = todays.Count == 0 ? "今日不开放" : string.Join(" · ", todays.Select(w => string.Join("–", w)));
        var intervals = new List<(int Start, int End)>();
        foreach (var w in todays) { var s = Clock(w[0]); var e = Clock(w[1]); intervals.Add((s, e <= s ? e + 1440 : e)); }
        foreach (var w in Day(week, day == 1 ? 7 : day - 1)) { var s = Clock(w[0]); var e = Clock(w[1]); if (e < s) intervals.Add((s - 1440, e)); }
        foreach (var w in Day(week, day == 7 ? 1 : day + 1)) { var s = Clock(w[0]); var e = Clock(w[1]); intervals.Add((s + 1440, e + (e <= s ? 2880 : 1440))); }
        var covering = intervals.Where(i => minute >= i.Start && minute < i.End).ToList();
        if (covering.Count == 0) return new(Open.Closed, today, null);
        var end = covering.Max(i => i.End);
        while (true)
        {
            var next = Math.Max(end, intervals.Where(i => i.Start <= end && i.End > minute).Select(i => i.End).DefaultIfEmpty(end).Max());
            if (next == end) break;
            end = next;
        }
        return new(end - minute <= 30 ? Open.Closing : Open.Open, today, $"{end % 1440 / 60:00}:{end % 60:00}");
    }
}
