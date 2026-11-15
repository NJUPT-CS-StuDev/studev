using System.Text.Json;
using StuDev.Data;

namespace StuDev.Map;

/** One place of the campus as the map release names it: a building, a room, a shop, a gate; its opening hours joined. */
public sealed record Place(string Id, string Kind, List<string> Names, string? Parent, double[]? Centre, string? Category, string? Group, int? Tier, int? Levels, JsonElement? Hours, JsonElement Routing, string? Floor = null, int? Seats = null, List<string>? RoomKinds = null)
{
    public string Name => Names.FirstOrDefault() ?? (Kind == "room" ? World.Names.Room(Id) : "未命名地点");
}
public sealed record OpeningRecord(JsonElement Hours);
/** The buildings as the model lays them out (model.json): their shapes and heights, and each floor's plate, rooms and cores. */
public sealed record ModelBuilding(string Id, int Levels, double Height, JsonElement Geometry);
public sealed record ModelPart(string? Id, string? Kind, JsonElement Geometry);
public sealed record ModelFloor(int Level, JsonElement Plate, List<ModelPart> Cores, List<ModelPart> Rooms);
/** A building around the campus, not modelled: only its footprint and height, for the shadow it casts. */
public sealed record ModelContext(double Height, JsonElement Geometry);
public sealed record CampusModel(List<ModelBuilding> Buildings, List<ModelContext> Context, Dictionary<string, ModelFloor> Floors);

/**
 * Where the campus is, read from its own footprints rather than written down, as src/campus/map/model/frame.ts reads it:
 * the box around every building and the buildings around it, a little wider, and its middle, which the sun is reckoned
 * for and its shadows are drawn over.
 */
public sealed record CampusFrame(double West, double South, double East, double North)
{
    /** How far past its outermost footprints the frame reaches, in degrees: room for the longest shadows. */
    private const double Margin = .002;
    public double Longitude => (West + East) / 2;
    public double Latitude => (South + North) / 2;

    public static CampusFrame Of(CampusModel model)
    {
        double west = double.PositiveInfinity, south = double.PositiveInfinity, east = double.NegativeInfinity, north = double.NegativeInfinity;
        foreach (var geometry in model.Buildings.Select(b => b.Geometry).Concat(model.Context.Select(c => c.Geometry)))
        {
            var coordinates = geometry.GetProperty("coordinates");
            var rings = geometry.GetProperty("type").GetString() switch
            {
                "Polygon" => [coordinates[0]],
                "MultiPolygon" => coordinates.EnumerateArray().Select(polygon => polygon[0]).ToList(),
                _ => new List<JsonElement>(),
            };
            foreach (var ring in rings)
                foreach (var point in ring.EnumerateArray())
                {
                    double x = point[0].GetDouble(), y = point[1].GetDouble();
                    west = Math.Min(west, x); east = Math.Max(east, x); south = Math.Min(south, y); north = Math.Max(north, y);
                }
        }
        if (double.IsInfinity(west)) throw new InvalidDataException("the campus model has no footprints");
        return new(west - Margin, south - Margin, east + Margin, north + Margin);
    }
}

/** The campus's places and its walking network, read from the data release; the map's drawing is not here. */
public sealed class Space(List<Place> places, string network)
{
    public List<Place> Places { get; } = places;
    public Dictionary<string, Place> ById { get; } = places.ToDictionary(p => p.Id);
    public string Network { get; } = network;
    public static async Task<Space> Load(Repository repo)
    {
        const string root = "space/仙林/";
        var entities = repo.Read(root + "entities.json", FactsJson.Default.ListPlace); var network = repo.Bytes(root + "network.json"); var hours = repo.Read("hours.json", FactsJson.Default.DictionaryStringOpeningRecord);
        await Task.WhenAll(entities, network, hours);
        var joined = entities.Result.Select(place =>
        {
            if (place.Routing.GetProperty("type").GetString() != "target" || place.Routing.GetProperty("id").GetString() != place.Id) throw new InvalidDataException("地图缺少规范导航目标。");
            return hours.Result.TryGetValue(place.Id, out var opening) ? place with { Hours = opening.Hours } : place;
        }).ToList();
        return new Space(joined, System.Text.Encoding.UTF8.GetString(network.Result));
    }
}

/** The baked campus buildings' buffer: its origin, the metres of one unit, and each building's vertex range. */
public sealed record ModelIndex(double[] Origin, double Scale, Dictionary<string, int[]> Buildings);
