// How a place is named, and what is worth going to at a moment: src/campus/map/model/displayName.ts, homePolicy.ts and
// routeText.ts, the same answers as the web and Android (the parity golden locks the recommendations).
namespace StuDev.Map;

public sealed record Suggested(Place Place, double Distance, HoursNow Status);

public static class Places
{
    public static readonly double[] CampusCentre = [118.9262, 32.1146];

    /** A place's title: its own name, or for a nameless building its kind and what it stands in. */
    public static string DisplayName(Place place, IReadOnlyDictionary<string, Place> byId)
    {
        if (place.Names.FirstOrDefault(n => n.Trim().Length > 0) is { } direct) return direct.Trim();
        if (place.Kind == "building")
        {
            for (var parent = place.Parent is { } p ? byId.GetValueOrDefault(p) : null; parent is not null; parent = parent.Parent is { } q ? byId.GetValueOrDefault(q) : null)
                if (parent.Names.FirstOrDefault(n => n.Trim().Length > 0) is { } context) return $"{place.Category ?? "建筑"} · {context.Trim()}";
            return "未命名建筑";
        }
        return $"{place.Category ?? place.Kind} · 未命名地点";
    }

    /** Route text without the campus name, which the person already knows. */
    public static string RouteText(string text) => text.Replace("仙林/", "");

    public static readonly Dictionary<Open, string> OpenLabel = new() { [Open.Open] = "营业中", [Open.Closing] = "即将关闭", [Open.Closed] = "已关闭", [Open.Unknown] = "" };

    /** Where people on campus go at each part of the day, most likely first. */
    public static string[] MomentAt(int hour) => hour switch
    {
        >= 5 and <= 10 => ["教学楼", "图书馆", "食堂"], >= 11 and <= 13 => ["食堂", "超市便利"], >= 14 and <= 16 => ["教学楼", "图书馆", "体育"],
        >= 17 and <= 18 => ["食堂", "超市便利"], >= 19 and <= 21 => ["图书馆", "教学楼", "体育"], _ => ["宿舍", "超市便利"],
    };
    private static readonly string[] Closes = ["食堂", "超市便利"];

    public static double Distance(double[] a, double[] b)
    {
        const double rad = Math.PI / 180;
        var h = Math.Pow(Math.Sin((b[1] - a[1]) * rad / 2), 2) + Math.Cos(a[1] * rad) * Math.Cos(b[1] * rad) * Math.Pow(Math.Sin((b[0] - a[0]) * rad / 2), 2);
        return 6371008.8 * 2 * Math.Asin(Math.Sqrt(Math.Clamp(h, 0, 1)));
    }

    public static List<Suggested> Recommendations(IEnumerable<Place> places, int day, int minute, double[]? position = null, string? category = null)
    {
        int Rank(Open o) => o is Open.Open or Open.Closing ? 0 : o == Open.Unknown ? 1 : 2;
        var order = MomentAt(minute / 60);
        var shown = new Dictionary<string, int>();
        return places.Where(p => p.Kind is "building" or "place" && p.Centre is not null && (category is not null ? p.Category == category : p.Id.StartsWith("仙林/") && order.Contains(p.Category ?? "")))
            .Select(p => new Suggested(p, Distance(position ?? CampusCentre, p.Centre!), Hours.At(p.Hours, day, minute)))
            .Where(s => category is not null || !(Closes.Contains(s.Place.Category ?? "") && s.Status.Open == Open.Closed))
            .OrderBy(s => category is not null ? 0 : Array.IndexOf(order, s.Place.Category)).ThenBy(s => Rank(s.Status.Open)).ThenBy(s => s.Distance).ThenBy(s => s.Place.Id, StringComparer.Ordinal)
            .Where(s => { if (category is not null) return true; var key = s.Place.Category ?? ""; var n = shown.GetValueOrDefault(key); shown[key] = n + 1; return n < 3; })
            .ToList();
    }
}
