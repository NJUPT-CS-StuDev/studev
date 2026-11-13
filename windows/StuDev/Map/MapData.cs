using System.Text.Json;
using StuDev.Data;

namespace StuDev.Map;

/** One place of the campus as the map release names it: a building, a room, a shop, a gate; its opening hours joined. */
public sealed record Place(string Id, string Kind, List<string> Names, string? Parent, double[]? Centre, string? Category, string? Group, int? Tier, int? Levels, JsonElement? Hours, JsonElement Routing, string? Floor = null, int? Seats = null, List<string>? RoomKinds = null)
{
    public string Name => Names.FirstOrDefault() ?? (Kind == "room" ? World.Names.Room(Id) : "未命名地点");
}
public sealed record OpeningRecord(JsonElement Hours);

/** The campus's places and its walking network, read from the data release; the map's drawing is not here. */
public sealed class Space(List<Place> places, string network)
{
    public List<Place> Places { get; } = places;
    public Dictionary<string, Place> ById { get; } = places.ToDictionary(p => p.Id);
    public string Network { get; } = network;
    public static async Task<Space> Load(Repository repo)
    {
        const string root = "space/仙林/";
        var entities = repo.Read<List<Place>>(root + "entities.json"); var network = repo.Bytes(root + "network.json"); var hours = repo.Read<Dictionary<string, OpeningRecord>>("hours.json");
        await Task.WhenAll(entities, network, hours);
        var joined = entities.Result.Select(place =>
        {
            if (place.Routing.GetProperty("type").GetString() != "target" || place.Routing.GetProperty("id").GetString() != place.Id) throw new InvalidDataException("地图缺少规范导航目标。");
            return hours.Result.TryGetValue(place.Id, out var opening) ? place with { Hours = opening.Hours } : place;
        }).ToList();
        return new Space(joined, System.Text.Encoding.UTF8.GetString(network.Result));
    }
}
