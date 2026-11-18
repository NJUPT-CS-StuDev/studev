using System.Text.Json;
using System.Text.Json.Nodes;
using StuDev.Data;
using StuDev.Me;
using StuDev.World;

namespace StuDev.Timetable;

/** The desktop app's read-only entry point for the selected personal timetable. */
internal static class NextClassCommand
{
    public static async Task<JsonObject> Read()
    {
        try
        {
            var preferences = Preferences.Load();
            if (preferences.Class is not { } klass) return State("class_required");
            var repo = await Repository.Open();
            var classes = repo.Classes(); var term = repo.Term(); var periods = repo.Periods(); var calendar = repo.Calendar();
            await Task.WhenAll(classes, term, periods, calendar);
            if (!classes.Result.Any(item => item.Id == klass)) return State("class_required");
            var personal = await PersonalLine.Read(repo, preferences, klass, term.Result, periods.Result, calendar.Result);
            if (personal.Line.NextClass(Moment.Now()) is not { } next) return State("no_upcoming_class");
            return new JsonObject {
                ["state"] = "found",
                ["name"] = next.Name,
                ["date"] = Clock.Text(next.Date),
                ["starts_at"] = Clock.Hm(next.Start),
                ["ends_at"] = Clock.Hm(next.End),
                ["room"] = next.Room,
            };
        }
        catch (Exception failure) when (failure is HttpRequestException or IOException or TaskCanceledException or JsonException or NotSupportedException)
        { return State("timetable_unavailable"); }
    }

    private static JsonObject State(string state) => new() { ["state"] = state };
}
