using System.Text.Json;
using System.Text.Json.Nodes;
using StuDev.Data;
using StuDev.Me;
using StuDev.World;
using StuDev.Map;

// These are the TypeScript implementation's released-data vectors, also read by Android's ParityTest.
// The verification executable has no UI dependency and never substitutes a fixture implementation for app code.
var golden = JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "golden.json")))!;
var checks = 0;
var failures = new List<string>();
T Read<T>(JsonNode node) => node.Deserialize<T>(Facts.Json)!;
void Equal(string label, object? value, JsonNode? expected)
{
    checks++;
    var actual = JsonSerializer.SerializeToNode(value, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
    if (!JsonNode.DeepEquals(actual, expected)) failures.Add($"{label}: expected {expected?.ToJsonString()}, got {actual?.ToJsonString()}");
}
object Brief(LineEvent e) => new { kind = e.Kind, name = e.Name, @short = e.Short, start = e.Start, end = e.End, room = e.Room };
var term = Read<TeachingTerm>(golden["term"]!);
var periods = Read<List<TeachingPeriod>>(golden["periods"]!);
var holidays = CampusLine.HolidaysOf(Read<List<CalendarTerm>>(golden["calendar"]!));
var meetings = Read<List<TeachingMeeting>>(golden["schedules"]![0]!["meetings"]!);
var basic = new CampusLine(term, periods, meetings, [], [], holidays)
{
    Run = Read<MorningRun>(golden["run"]!),
    RunDays = Read<List<string>>(golden["runDays"]!),
    RunAdjust = 5,
};
foreach (var day in golden["days"]!.AsArray())
    Equal("day " + day!["date"], basic.On(Clock.Parse(day["date"]!.GetValue<string>())).Select(Brief), day["events"]);
foreach (var item in golden["edgeCases"]!["names"]!.AsArray())
{
    var text = item!["value"]!.GetValue<string>();
    Equal("course " + text, Names.Course(text), item["course"]);
    Equal("short " + text, Names.CourseShort(text), item["short"]);
    Equal("room " + text, Names.Room(text), item["room"]);
}
foreach (var item in golden["edgeCases"]!["colours"]!.AsArray())
    Equal("identity", CourseTones.Identity(item!["course"]!["code"]?.GetValue<string>(), item["course"]!["name"]!.GetValue<string>()), item["identity"]);
foreach (var item in golden["edgeCases"]!["compactPlaces"]!.AsArray())
    Equal("compact place", Names.CompactPlace((string)item!["value"]!), item["compact"]);
foreach (var item in golden["tones"]!.AsArray())
{
    var schedule = golden["schedules"]!.AsArray().First(s => (string?)s!["class"] == (string?)item!["class"]);
    var line = new CampusLine(term, periods, Read<List<TeachingMeeting>>(schedule!["meetings"]!), [], [], holidays);
    Equal("course tones " + item!["class"], CourseTones.Of(line), item["tones"]);
}
var labData = golden["labs"]!;
var labLine = new CampusLine(term, periods, Read<List<TeachingMeeting>>(labData["meetings"]!), Read<List<Lab>>(labData["labs"]!), [Read<Exam>(labData["exam"]!)], holidays);
foreach (var day in labData["days"]!.AsArray())
{
    var events = labLine.On(Clock.Parse(day!["date"]!.GetValue<string>()));
    Equal("labs " + day["date"], events.Select(e => new { kind = e.Kind, name = e.Name, @short = e.Short, start = e.Start, end = e.End, room = e.Room, id = e.Id, lab = e.Lab?.Id }), day["events"]);
    string[][] orders = [["exam", "lab", "class", "run"], ["class", "run", "exam", "lab"]];
    for (var order = 0; order < orders.Length; order++)
    {
        Equal("layers", CampusLine.Layers(events, orders[order]).Select(l => new { id = l.Event.Id, under = l.Under, over = l.Over }), day["layers"]![order]);
        Equal("clusters", CampusLine.Clusters(events, orders[order]).Select(c => new { front = c.Front.Id, events = c.Events.Select(e => e.Id), start = c.Start, end = c.End }), day["clusters"]![order]);
    }
}
var tasksData = golden["tasks"]!;
var tasks = tasksData["list"]!.Deserialize<List<PersonalTask>>(Storage.Json)!;
var now = new Moment(Clock.Parse(tasksData["now"]!["date"]!.GetValue<string>()), tasksData["now"]!["min"]!.GetValue<int>());
foreach (var item in tasksData["groups"]?.AsArray() ?? [])
{
    var task = tasks.First(t => t.Id == item!["id"]!.GetValue<string>());
    Equal("task group " + task.Id, TaskRules.Group(task, now), item!["group"]);
}
foreach (var item in tasksData["reminders"]?.AsArray() ?? [])
{
    var task = tasks.First(t => t.Id == item!["id"]!.GetValue<string>());
    var at = TaskRules.ReminderAt(task, item!["remind"]!.GetValue<int>(), (string?)item["anchor"] ?? "plan");
    Equal("task reminder", at is null ? null : new { date = Clock.Text(at.Value.Date), min = at.Value.Min }, item["at"]);
}
foreach (var test in labData["choices"]!.AsArray())
    Equal("lab attendance", Choices.Labs(labLine.Labs, test!["choices"]!.Deserialize<LabChoices>(Storage.Json)).Select(l => l.Id), test["expected"]);
var quickCourses = tasksData["courses"]!.Deserialize<List<QuickCourse>>(Storage.Json)!;
foreach (var test in tasksData["parse"]!.AsArray())
{
    var parsed = QuickTasks.Parse(test!["input"]!.GetValue<string>(), new(Clock.Parse("2026-11-12"), 600), quickCourses);
    Equal("quick task " + test["input"], JsonSerializer.SerializeToNode(parsed, Storage.Json), test["result"]);
}
labLine.Tasks = tasks;
foreach (var day in tasksData["days"]!.AsArray())
{
    var date = Clock.Parse(day!["date"]!.GetValue<string>());
    Equal("tasks on line", labLine.On(date).Select(e => new { kind = e.Kind, name = e.Name, @short = e.Short, start = e.Start, end = e.End, room = e.Room, id = e.Id, lab = e.Lab?.Id }), day["events"]);
    Equal("task deadlines", labLine.DueOn(date).Select(t => t.Id), day["due"]);
}
Equal("task order", tasks.Order(TaskRules.Order).Select(t => t.Id), tasksData["order"]);
var sync = tasksData["sync"]!;
Equal("task merge", JsonSerializer.SerializeToNode(TaskRules.Merge(sync["mine"]!.Deserialize<List<PersonalTask>>(Storage.Json)!, sync["theirs"]!.Deserialize<List<PersonalTask>>(Storage.Json)!), Storage.Json), sync["merged"]);
foreach (var test in tasksData["moves"]!.AsArray())
{
    var task = tasks.First(t => t.Id == (string)test!["id"]!);
    var shown = test!["shown"]!.AsArray().Select(id => tasks.First(t => t.Id == (string)id!)).ToList();
    var changes = TaskRules.Move(task, (string)test["group"]!, (int)test["index"]!, shown, now);
    var node = JsonSerializer.SerializeToNode(changes, Storage.Json)!;
    foreach (var changed in node.AsArray()) changed!.AsObject().Remove("modified");
    Equal("task move", node, test["changed"]);
}
foreach (var test in golden["moments"]!.AsArray())
{
    var moment = new Moment(Clock.Parse((string)test!["now"]!["date"]!), (int)test["now"]!["min"]!);
    Equal("next", basic.Next(moment) is { } e ? Brief(e) : null, test["next"]);
    Equal("run plan", basic.PlanRuns(moment), test["plan"]);
    Equal("week shown", Clock.Text(basic.WeekShown(moment)), test["week"]);
    var tally = basic.RunTally(moment);
    Equal("run done", tally.Done, test["run"]!["done"]); Equal("run planned", tally.Planned, test["run"]!["planned"]);
    Equal("run count", tally.Count, test["run"]!["count"]); Equal("run need", tally.Need, test["run"]!["need"]);
}
Equal("last lesson", basic.LastLesson() is { } last ? Clock.Text(last) : null, golden["lastLesson"]);
foreach (var test in golden["around"]!.AsArray())
    Equal("meeting around", basic.Around((string)test!["meeting"]!, Clock.Parse((string)test["from"]!)) is { } e ? Clock.Text(e.Date) : null, test["date"]);
var semantics = golden["semantics"]!;
foreach (var test in semantics["cases"]!.AsArray())
{
    var line = new CampusLine(term, periods, labLine.Meetings, labLine.Labs, labLine.Exams, holidays) { Preferences = test!["preferences"]!.Deserialize<Dictionary<string, EventChoice>>(Storage.Json) };
    var date = Clock.Parse((string)semantics["request"]!["from"]!);
    var events = line.On(date);
    Equal("scheduling attitudes", events.Select(e => new { id = e.Id, avoid = e.Avoid, layer = e.Layer }), test["events"]);
    Equal("scheduling layers", CampusLine.Layers(events).Select(l => new { id = l.Event.Id, under = l.Under, over = l.Over }), test["layers"]);
    Equal("available slots", Planning.Available(line, semantics["request"]!.Deserialize<SlotRequest>(Storage.Json)!, new(Clock.Parse((string)semantics["now"]!["date"]!), (int)semantics["now"]!["min"]!)).Take(4), test["slots"]);
}
var repositoryRoot = new DirectoryInfo(AppContext.BaseDirectory);
while (repositoryRoot is not null && !Directory.Exists(Path.Combine(repositoryRoot.FullName, "src", "campus"))) repositoryRoot = repositoryRoot.Parent;
if (repositoryRoot is null) throw new InvalidOperationException("Run verification from its source checkout.");
var roomReader = new Rooms(periods);
var roomDays = Read<List<RoomDay>>(golden["rooms"]!["days"]!);
foreach (var test in golden["rooms"]!["cases"]!.AsArray())
{
    var state = roomReader.At(roomDays.First(day => day.Date == (string)test!["date"]!), (string)test!["room"]!, (int)test["min"]!);
    Equal("room state", new { tier = state.Tier, busy = state.Busy, until = state.Until, minutes = state.Minutes }, new JsonObject { ["tier"] = test["tier"]!.DeepClone(), ["busy"] = test["busy"]!.DeepClone(), ["until"] = test["until"]!.DeepClone(), ["minutes"] = test["minutes"]!.DeepClone() });
}
var mapRoot = Path.Combine(repositoryRoot.FullName, "public", "data", (string)golden["source"]!["release"]!, "space", "仙林");
using (var router = new StuDev.Kernels.Wayfind.Router(File.ReadAllText(Path.Combine(mapRoot, "network.json"))))
{
    var answer = router.Route("{\"origin\":{\"type\":\"position\",\"position\":[118.9262,32.1146]},\"destination\":{\"type\":\"target\",\"id\":\"仙林/教4\"},\"mode\":\"walk\",\"avoid_steps\":false,\"max_snap_distance_m\":100,\"alternatives\":3}");
    Equal("native wayfind answers", answer.Contains("\"routes\""), JsonValue.Create(true));
}
var places = Read<List<Place>>(golden["entities"]!); var byId = places.ToDictionary(p => p.Id);
foreach (var test in golden["finding"]!["queries"]!.AsArray()) Equal("place query", Find.Places(places, (string)test!["query"]!).Select(p => p.Id), test["found"]);
foreach (var test in golden["finding"]!["meant"]!.AsArray())
{
    try { Equal("place meant", Find.Meant(places, byId, (string)test!["said"]!).Id, test["id"]); }
    catch (ArgumentException error) { Equal("place ambiguity", error.Message, test!["error"]); }
}
foreach (var test in golden["finding"]!["around"]!.AsArray())
    Equal("places around", Find.Around(places, byId, Find.Meant(places, byId, (string)test!["near"]!), (string)test["what"]!).Select(p => new object[] { p.Place.Id, p.Metres }), test["found"]);
foreach (var test in golden["labels"]!.AsArray())
{
    var place = byId[(string)test!["id"]!];
    Equal("map label", LabelRules.Of(place, byId), test["rule"]);
    Equal("teaching label", place.Kind == "building" ? LabelRules.Of(place, byId, true) : null, test["teaching"]);
}
Console.WriteLine($"Windows parity: {checks} checks, {failures.Count} failures");
foreach (var failure in failures) Console.WriteLine(failure);
return failures.Count == 0 ? 0 : 1;
