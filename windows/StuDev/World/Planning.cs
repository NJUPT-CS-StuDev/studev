namespace StuDev.World;

public sealed record SlotRequest(string From, string To, int Minutes, int? Earliest = null, int? Latest = null, string? Exclude = null, Deadline? Due = null);
public sealed record TimeSlot(string Date, int Start, int End, List<string> Clashes, int Penalty);

/** Scheduling reads attendance and attitude. Visual layers never make a time busy or free. */
public static class Planning
{
    public static List<TimeSlot> Available(CampusLine line, SlotRequest request, Moment now)
    {
        if (request.Minutes is < 1 or > 840 || string.CompareOrdinal(request.From, request.To) > 0) return [];
        var result = new List<TimeSlot>();
        var from = Clock.Parse(request.From); var to = Clock.Parse(request.To);
        for (var date = from; date <= to && date.DayNumber - from.DayNumber < 60; date = date.AddDays(1))
        {
            var text = Clock.Text(date);
            if (date < now.Date || request.Due is { } due && string.CompareOrdinal(text, due.Date) > 0) continue;
            var earliest = Math.Max(request.Earliest ?? 480, date == now.Date ? now.Min : 0);
            var latest = Math.Min(request.Latest ?? 1320, request.Due?.Date == text ? request.Due.Time ?? 1440 : 1440);
            var events = line.On(date).Where(e => e.Id != request.Exclude && e.Task?.Done is null).ToList();
            var starts = events.Select(e => e.End).ToHashSet(); starts.Add(earliest);
            for (var minute = (int)Math.Ceiling(earliest / 15.0) * 15; minute + request.Minutes <= latest; minute += 15) starts.Add(minute);
            foreach (var start in starts)
            {
                var end = start + request.Minutes;
                if (start < earliest || end > latest) continue;
                var clashes = events.Where(e => e.Start < end && start < e.End).ToList();
                if (clashes.Any(e => e.Avoid == "must")) continue;
                var soft = clashes.Where(e => e.Avoid != "allow").ToList();
                result.Add(new(text, start, end, soft.Select(e => e.Id).Order(StringComparer.Ordinal).ToList(), soft.Sum(e => Math.Min(end, e.End) - Math.Max(start, e.Start))));
            }
        }
        return result.OrderBy(s => s.Penalty).ThenBy(s => s.Date, StringComparer.Ordinal).ThenBy(s => s.Start).ToList();
    }
}
