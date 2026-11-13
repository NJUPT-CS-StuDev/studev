using StuDev.Data;

namespace StuDev.World;

public sealed record RoomUse(RoomOccupant Occupant, int Start, int End);
public sealed record RoomState(string Tier, bool Busy, int Until, int Minutes, List<RoomUse> Occupants, RoomUse? Current);

/** Missing room facts mean unknown; an empty, published occupancy list means free. */
public sealed class Rooms(List<TeachingPeriod> periods)
{
    private readonly List<TeachingPeriod> sorted = periods.OrderBy(p => p.Period).ToList();
    private readonly Dictionary<int, (int Start, int End)> clock = periods.ToDictionary(p => p.Period, p => (Clock.Minutes(p.Start), Clock.Minutes(p.End)));
    private bool Free(RoomDay day, string id, int period) => day.Free is not null ? day.Free.GetValueOrDefault(period.ToString())?.Contains(id) == true : !day.Occupied.GetValueOrDefault(id, []).Any(o => o.Periods[0] <= period && period <= o.Periods[^1]);
    public static bool Classroom(Room room) => room.Listed == true && room.Kinds.Any(kind => new[] { "多媒体", "非多媒体", "翻转课堂" }.Any(kind.Contains));
    public RoomState At(RoomDay? day, string id, int minute)
    {
        var occupants = (day?.Occupied.GetValueOrDefault(id) ?? []).Select(o => new RoomUse(o, clock[o.Periods[0]].Start, clock[o.Periods[^1]].End)).OrderBy(o => o.Start).ToList();
        if (day is null) return new("other", false, minute, 0, occupants, null);
        var current = occupants.FirstOrDefault(o => o.Start <= minute && minute < o.End);
        var running = sorted.FirstOrDefault(p => clock[p.Period].Start <= minute && minute < clock[p.Period].End);
        if (current is not null || running is not null && !Free(day, id, running.Period))
        {
            var until = current?.End ?? clock[running!.Period].End;
            foreach (var p in sorted) if (clock[p.Period].Start >= until && clock[p.Period].Start - until <= 25 && !Free(day, id, p.Period)) until = clock[p.Period].End;
            return new("busy", true, until, 0, occupants, current);
        }
        var end = clock.Values.Max(p => p.End);
        if (minute >= end) return new("short", false, end, 0, occupants, null);
        var next = sorted.FirstOrDefault(p => clock[p.Period].Start >= minute && !Free(day, id, p.Period));
        var freeUntil = next is null ? end : clock[next.Period].Start; var minutes = freeUntil - minute;
        return new(minutes >= 180 ? "long" : minutes >= 60 ? "mid" : "short", false, freeUntil, minutes, occupants, null);
    }
}
