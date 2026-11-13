using System.Text.RegularExpressions;

namespace StuDev.Map;

public static class Find
{
    public static string Plain(string text)
    {
        var said = Regex.Replace(text.ToLowerInvariant(), "[ \\t\\n\\r\u3000()（）·\\-—_]", "");
        said = Regex.Replace(said, "[一二三四五六七八九](?=楼|号|栋|幢|$)", match => ("一二三四五六七八九".IndexOf(match.Value, StringComparison.Ordinal) + 1).ToString());
        return Regex.Replace(said, "^(教[1-9])楼$", "$1");
    }
    private static int Score(Place place, string said)
    {
        if (said.Length == 0 || place.Kind is not ("building" or "place" or "room")) return 0;
        var tail = Plain(place.Id[(place.Id.IndexOf('/') + 1)..]); var best = tail == said ? 95 : 0;
        foreach (var name in place.Names.Concat(place.Kind == "room" ? [] : new[] { tail }).Select(Plain).Where(s => s.Length > 0))
        {
            if (name == said) best = Math.Max(best, 100);
            else if (place.Kind == "room") continue;
            else if (name.StartsWith(said, StringComparison.Ordinal)) best = Math.Max(best, 80 - Math.Min(20, name.Length - said.Length));
            else if (said.StartsWith(name, StringComparison.Ordinal) && name.Length >= 2) best = Math.Max(best, 70 - Math.Min(20, said.Length - name.Length));
            else if (name.Contains(said, StringComparison.Ordinal) && said.Length >= 2) best = Math.Max(best, 60 - Math.Min(20, name.Length - said.Length));
        }
        return best == 0 ? 0 : best + (place.Id.StartsWith("周边/", StringComparison.Ordinal) ? 0 : 5) + 4 - (place.Tier ?? 3);
    }
    private static List<(Place Place, int Score)> Ranked(IEnumerable<Place> places, string said) => places.Select(p => (Place: p, Score: Score(p, Plain(said)))).Where(p => p.Score > 0).OrderByDescending(p => p.Score).ThenBy(p => p.Place.Id, StringComparer.Ordinal).ToList();
    public static List<Place> Places(IEnumerable<Place> places, string query, int limit = 8) => Ranked(places, query).Take(limit).Select(p => p.Place).ToList();
    public static Place Meant(IEnumerable<Place> places, IReadOnlyDictionary<string, Place> byId, string said)
    {
        if (byId.TryGetValue(said.Trim(), out var exact)) return exact;
        var ranked = Ranked(places, said); if (ranked.Count == 0) throw new ArgumentException($"地图里找不到“{said}”。");
        var top = ranked[0]; var rivals = ranked.Where(p => p.Score == top.Score && p.Place.Names.FirstOrDefault() != top.Place.Names.FirstOrDefault()).ToList();
        if (top.Score < 70 && rivals.Count > 0) throw new ArgumentException($"“{said}”可能是：{string.Join("、", new[] { top }.Concat(rivals).Take(4).Select(p => p.Place.Name))}，说具体一点。");
        return top.Place;
    }
    public static double Metres(double[] a, double[] b)
    {
        const double rad = Math.PI / 180;
        var h = Math.Pow(Math.Sin((b[1] - a[1]) * rad / 2), 2) + Math.Cos(a[1] * rad) * Math.Cos(b[1] * rad) * Math.Pow(Math.Sin((b[0] - a[0]) * rad / 2), 2);
        return 6371008.8 * 2 * Math.Asin(Math.Sqrt(Math.Clamp(h, 0, 1)));
    }
    public static List<(Place Place, long Metres)> Around(IEnumerable<Place> places, IReadOnlyDictionary<string, Place> byId, Place near, string what, int limit = 8)
    {
        var from = near.Centre ?? (near.Parent is { } parent ? byId.GetValueOrDefault(parent)?.Centre : null) ?? throw new ArgumentException($"地图上没有“{near.Name}”的位置。");
        return places.Where(p => p.Id != near.Id && p.Kind is "place" or "building" && (p.Category == what || p.Group == what) && p.Centre is not null)
            .Select(p => (Place: p, Metres: (long)Math.Floor(Metres(from, p.Centre!) + .5))).OrderBy(p => p.Metres).ThenBy(p => p.Place.Id, StringComparer.Ordinal).Take(limit).ToList();
    }
}
