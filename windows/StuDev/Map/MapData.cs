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
public sealed record CampusModel(List<ModelBuilding> Buildings, Dictionary<string, ModelFloor> Floors);

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
