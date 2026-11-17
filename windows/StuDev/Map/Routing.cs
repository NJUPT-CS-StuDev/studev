namespace StuDev.Map;

/** A requested room and the real point where the road network hands over to its building. */
public static class Routing
{
    public static string AccessId(Place place) => place.Routing.GetProperty("id").GetString()!;
    public static bool Indoor(Place place) => AccessId(place) != place.Id;
    public static bool SameAccess(Place from, Place to) => (to.Kind == "building" || Indoor(to)) && AccessId(from) == AccessId(to);
    public static Place Access(Place place, IReadOnlyDictionary<string, Place> places) => places[AccessId(place)];
    public static string Name(Place place, IReadOnlyDictionary<string, Place> places) => place.Kind switch { "room" => World.Names.Room(place.Id), "floor" => $"{Places.DisplayName(Access(place, places), places)} {Floor(place)} 层", _ => Places.DisplayName(place, places) };
    public static string? Floor(Place place) => place.Floor ?? (place.Kind == "floor" ? place.Id[(place.Id.LastIndexOf('/') + 1)..] : null);
    public static string Location(Place place, IReadOnlyDictionary<string, Place> places) => (place.Kind != "floor" && Floor(place) is { } floor ? $"{floor} 层 · " : "") + Name(place, places);
    public static string Inside(Place place, IReadOnlyDictionary<string, Place> places) => $"进入{Name(Access(place, places), places)}后，前往{Location(place, places)}";
    public static string Duration(double seconds) => seconds < 60 ? "不到 1 分钟" : $"{(int)Math.Ceiling(seconds / 60)} 分钟";
}
