namespace StuDev.Map;

public sealed record LabelRule(double MinZoom, int Priority);
public static class LabelRules
{
    public static LabelRule? Of(Place place, IReadOnlyDictionary<string, Place> byId, bool teaching = false)
    {
        var tier = place.Tier ?? 3;
        if (place.Kind == "building") return teaching ? new(14.5, 0) : new(new[] { 15.1, 16.0, 16.8 }[tier - 1], tier);
        if (place.Kind != "place" || place.Category == "停车场") return null;
        var parent = place.Parent is { } id ? byId.GetValueOrDefault(id) : null; var off = parent is null;
        var zoom = new[] { 15.6, 16.4, 17.0 }[tier - 1] + (off ? .4 : 0);
        if (parent?.Kind == "building") zoom = Math.Max(zoom, 17.4);
        return new(Math.Round(zoom, 1), tier + 1 + (off ? 1 : 0));
    }
}
