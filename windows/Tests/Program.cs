using System.Text.Json;
using System.Text.Json.Nodes;
using StuDev.Data;
using StuDev.Me;
using StuDev.World;
using StuDev.Map;

// These are the TypeScript implementation's released-data vectors, also read by Android's ParityTest.
// The verification executable has no UI dependency and never substitutes a fixture implementation for app code.
// The verification reads test-only shapes too, so it keeps reflection, with the same naming as the app's two contexts.
var factsJson = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower, PropertyNameCaseInsensitive = true, DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull };
var storageJson = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true, DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull };
var golden = JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "golden.json")))!;
var checks = 0;
var failures = new List<string>();
T Read<T>(JsonNode node) => node.Deserialize<T>(factsJson)!;
void Equal(string label, object? value, JsonNode? expected)
{
    checks++;
    var actual = JsonSerializer.SerializeToNode(value, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
    if (!JsonNode.DeepEquals(actual, expected)) failures.Add($"{label}: expected {expected?.ToJsonString()}, got {actual?.ToJsonString()}");
}
// The sun, within a billionth of a degree: each runtime's sine and arctangent may round the last bit differently.
// Where the campus is, from the footprints of the same model the web read, within a billionth of a degree.
var repoRoot = new DirectoryInfo(AppContext.BaseDirectory);
while (!Directory.Exists(Path.Combine(repoRoot.FullName, "public", "data"))) repoRoot = repoRoot.Parent ?? throw new DirectoryNotFoundException("public/data");
var model = JsonSerializer.Deserialize<StuDev.Map.CampusModel>(File.ReadAllText(Path.Combine(repoRoot.FullName, "public", "data", (string)golden["source"]!["release"]!, "space", "仙林", "model.json")), factsJson)!;
var campusFrame = StuDev.Map.CampusFrame.Of(model);
checks++;
foreach (var (name, got) in new[] { ("west", campusFrame.West), ("south", campusFrame.South), ("east", campusFrame.East), ("north", campusFrame.North), ("longitude", campusFrame.Longitude), ("latitude", campusFrame.Latitude) })
    if (Math.Abs(got - (double)golden["frame"]![name]!) > 1e-9) failures.Add($"campus frame {name}: expected {golden["frame"]![name]}, got {got}");
foreach (var test in golden["sun"]!.AsArray())
{
    checks++;
    var (altitude, azimuth) = Sun.At(Clock.Parse((string)test!["date"]!), (int)test["min"]!, campusFrame.Longitude, campusFrame.Latitude);
    if (Math.Abs(altitude - (double)test["alt"]!) > 1e-9 || Math.Abs(azimuth - (double)test["az"]!) > 1e-9) failures.Add($"sun {test.ToJsonString()}: got {altitude}, {azimuth}");
}
object Brief(LineEvent e) => new { kind = e.Kind, name = e.Name, @short = e.Short, start = e.Start, end = e.End, room = e.Room };
var term = Read<TeachingTerm>(golden["term"]!);
foreach (var item in golden["campusTimes"]!.AsArray())
{
    var at = CampusDay.At(DateTimeOffset.Parse((string)item!["instant"]!));
    Equal("campus time", new { date = Clock.Text(DateOnly.FromDateTime(at)), min = at.Hour * 60 + at.Minute }, item["now"]);
}
var periods = Read<List<TeachingPeriod>>(golden["periods"]!);
foreach (var test in golden["examHistory"]!["times"]!.AsArray()) Equal("exam time", Exams.Time((string)test!["value"]!), test["text"]);
foreach (var test in golden["examHistory"]!["comparisons"]!.AsArray()) Equal("exam before and after", Exams.ChangeLines(Read<ExamChange>(test!["change"]!)), test["lines"]);
foreach (var test in golden["examHistory"]!["classes"]!.AsArray())
{
    var record = Read<ExamRecord>(test!["record"]!);
    Equal("class exam history", Exams.History(record).Select(version => new { id = version.Id, time = Exams.VersionTime(version), impact = Exams.Impact(version.Baseline, version.Changes), changes = version.Changes.Select(change => new { course = change.Course.Name, kind = change.Change, lines = Exams.ChangeLines(change) }) }), test["versions"]);
}
var holidays = CampusLine.HolidaysOf(Read<List<CalendarTerm>>(golden["calendar"]!));
var meetings = Read<List<TeachingMeeting>>(golden["schedules"]![0]!["meetings"]!);
var basic = new CampusLine(term, periods, meetings, [], [], holidays)
{
    Run = Read<MorningRun>(golden["run"]!),
    RunDays = Read<List<string>>(golden["runDays"]!),
    RunAdjust = 5,
};
{
    var source = meetings[0];
    var custom = new CustomCourse("independent-name", source.Course.Name, [source.Weekday], source.Periods, source.Weeks);
    var named = new CampusLine(term, periods, [source, .. Choices.CustomMeetings(custom)], [], [], holidays)
    {
        CourseNames = new() { [CourseTones.Identity(source.Course.Code, source.Course.Name)] = "PersonalAlias" },
        CourseMeetings = [source],
    };
    var first = Clock.Parse(term.Weeks[0].Start); var lastCourseDay = Clock.Parse(term.Weeks[^1].End);
    var events = Enumerable.Range(0, lastCourseDay.DayNumber - first.DayNumber + 1).SelectMany(offset => named.On(first.AddDays(offset))).ToList();
    Equal("custom name independent from public alias", events.First(e => e.Meeting?.TeachingClass.Id == $"custom:{custom.Id}").Name, JsonValue.Create(source.Course.Name));
    Equal("public course retains personal alias", events.First(e => e.Meeting?.Id == source.Id).Name, JsonValue.Create("PersonalAlias"));
}
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
        Equal("layers", CampusLine.Layers(events, orders[order]).Select(l => new { id = l.Event.Id, under = l.Under }), day["layers"]![order]);
        Equal("clusters", CampusLine.Clusters(events, orders[order]).Select(c => new { front = c.Front.Id, events = c.Events.Select(e => e.Id), start = c.Start, end = c.End }), day["clusters"]![order]);
    }
}
var tasksData = golden["tasks"]!;
var tasks = tasksData["list"]!.Deserialize<List<PersonalTask>>(storageJson)!;
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
    Equal("lab attendance", Choices.Labs(labLine.Labs, test!["choices"]!.Deserialize<LabChoices>(storageJson)).Select(l => l.Id), test["expected"]);
var quickCourses = tasksData["courses"]!.Deserialize<List<QuickCourse>>(storageJson)!;
foreach (var test in tasksData["parse"]!.AsArray())
{
    var parsed = QuickTasks.Parse(test!["input"]!.GetValue<string>(), new(Clock.Parse("2026-11-12"), 600), quickCourses);
    Equal("quick task " + test["input"], JsonSerializer.SerializeToNode(parsed, storageJson), test["result"]);
}
labLine.Tasks = tasks;
// A glance outside the app: the same day, week, term, due tasks and exams at the same moment as the TypeScript.
object Ids(List<LineEvent> events) => events.Select(e => e.Id);
foreach (var test in golden["glance"]!["moments"]!.AsArray())
{
    var at = new Moment(Clock.Parse(test!["now"]!["date"]!.GetValue<string>()), test["now"]!["min"]!.GetValue<int>());
    var day = Glance.Day(labLine, at);
    Equal("glance day", new { date = Clock.Text(day.Date), events = Ids(day.Events) }, test["day"]);
    Equal("glance week", Glance.Week(labLine, at).Select(d => new { date = Clock.Text(d.Date), events = Ids(d.Events) }), test["week"]);
    Equal("glance due", Glance.Due(labLine, at).Select(t => t.Id), test["due"]);
    Equal("glance exams", Glance.Exams(labLine, at).Select(d => new { date = Clock.Text(d.Date), days = d.Days, events = Ids(d.Events) }), test["exams"]);
    var next = Glance.NextChange(labLine, at);
    Equal("glance next", new { date = Clock.Text(next.Date), min = next.Min }, test["next"]);
}
Equal("glance term", Glance.Term(labLine).Select(w => new { week = w.Week, start = Clock.Text(w.Start), days = w.Days.Select(d => new { date = Clock.Text(d.Date), lessons = d.Lessons, exam = d.Exam, off = d.Off }) }), golden["glance"]!["term"]);
foreach (var day in tasksData["days"]!.AsArray())
{
    var date = Clock.Parse(day!["date"]!.GetValue<string>());
    Equal("tasks on line", labLine.On(date).Select(e => new { kind = e.Kind, name = e.Name, @short = e.Short, start = e.Start, end = e.End, room = e.Room, id = e.Id, lab = e.Lab?.Id }), day["events"]);
    Equal("task deadlines", labLine.DueOn(date).Select(t => t.Id), day["due"]);
}
Equal("task order", tasks.Order(TaskRules.Order).Select(t => t.Id), tasksData["order"]);
foreach (var test in tasksData["nextLessons"]!.AsArray())
{
    var next = labLine.NextLesson((string)test!["course"]!, new Moment(Clock.Parse((string)test["now"]!["date"]!), (int)test["now"]!["min"]!));
    Equal("next lesson", next is null ? null : new { date = Clock.Text(next.Date), start = next.Start, id = next.Id }, test["next"]);
}
foreach (var item in tasksData["reportTitles"]!.AsArray()) Equal("report title", Suggestions.ReportTitle((string)item!["project"]!), item["title"]);
foreach (var test in tasksData["suggestions"]!.AsArray())
{
    var at = new Moment(Clock.Parse((string)test!["now"]!["date"]!), (int)test["now"]!["min"]!);
    var got = Suggestions.Suggest(labLine, at, test["setAside"]!.AsArray().Select(k => (string)k!).ToList());
    Equal("suggestions", got.Select(s => new { key = s.Key, task = new { title = s.Task.Title, course = s.Task.Course, due = new { date = s.Task.Due!.Date } } }), test["expected"]);
}
var sync = tasksData["sync"]!;
Equal("task merge", JsonSerializer.SerializeToNode(TaskRules.Merge(sync["mine"]!.Deserialize<List<PersonalTask>>(storageJson)!, sync["theirs"]!.Deserialize<List<PersonalTask>>(storageJson)!), storageJson), sync["merged"]);
foreach (var test in tasksData["moves"]!.AsArray())
{
    var task = tasks.First(t => t.Id == (string)test!["id"]!);
    var shown = test!["shown"]!.AsArray().Select(id => tasks.First(t => t.Id == (string)id!)).ToList();
    var changes = TaskRules.Move(task, (string)test["group"]!, (int)test["index"]!, shown, now);
    var node = JsonSerializer.SerializeToNode(changes, storageJson)!;
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
    var line = new CampusLine(term, periods, labLine.Meetings, labLine.Labs, labLine.Exams, holidays) { Preferences = test!["preferences"]!.Deserialize<Dictionary<string, EventChoice>>(storageJson) };
    var date = Clock.Parse((string)semantics["request"]!["from"]!);
    var events = line.On(date);
    Equal("scheduling attitudes", events.Select(e => new { id = e.Id, avoid = e.Avoid, layer = e.Layer }), test["events"]);
    Equal("scheduling layers", CampusLine.Layers(events).Select(l => new { id = l.Event.Id, under = l.Under }), test["layers"]);
    Equal("available slots", Planning.Available(line, semantics["request"]!.Deserialize<SlotRequest>(storageJson)!, new(Clock.Parse((string)semantics["now"]!["date"]!), (int)semantics["now"]!["min"]!)).Take(4), test["slots"]);
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
foreach (var test in golden["routing"]!.AsArray())
{
    var sourcePlace = byId[(string)test!["from"]!]; var targetPlace = byId[(string)test["to"]!];
    Equal("route source access", Routing.AccessId(sourcePlace), test["sourceAccess"]);
    Equal("route target access", Routing.AccessId(targetPlace), test["targetAccess"]);
    Equal("route within building", Routing.SameAccess(sourcePlace, targetPlace), test["withinBuilding"]);
    Equal("route indoor destination", Routing.Indoor(targetPlace), test["indoorDestination"]);
    Equal("route building", Routing.Name(Routing.Access(targetPlace, byId), byId), test["building"]);
    Equal("route origin floor", Routing.Floor(sourcePlace), test["fromFloor"]);
    Equal("route destination floor", Routing.Floor(targetPlace), test["toFloor"]);
    Equal("route position", Routing.Location(targetPlace, byId), test["location"]);
    Equal("route origin position", Routing.Location(sourcePlace, byId), test["fromLocation"]);
    Equal("route indoor continuation", Routing.Inside(targetPlace, byId), test["continuation"]);
}
var indoorPlace = places.First(p => p.Kind == "room");
Equal("same room stays within building", Routing.SameAccess(indoorPlace, indoorPlace), JsonValue.Create(true));
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
// The AI: the request a provider is sent, a stream read into a turn, the steps said, the thread, the chats, memory.
var assistantCases = golden["assistant"]!;
foreach (var test in assistantCases["addresses"]!.AsArray())
{
    Equal("endpoint", StuDev.Ai.Models.Endpoint((string)test!["base"]!), test["endpoint"]);
    Equal("address", StuDev.Ai.Models.AddressError((string)test["base"]!) is not null, test["invalid"]);
}
var worldFolder = Path.Combine(repositoryRoot.FullName, "src", "campus", "world");
var assistant = StuDev.Ai.Assistant.Load(worldFolder);
foreach (var address in new[] { "http://localhost:9316/v1", "http://127.0.0.1:9316/v1" })
{
    Equal("ordinary API rejects cleartext", StuDev.Ai.Models.AddressError(address) is not null, JsonValue.Create(true));
    Equal("explicit runtime accepts loopback", StuDev.Ai.Models.AddressError(address, true) is null, JsonValue.Create(true));
}
foreach (var address in new[] { "http://localhost.example.com/v1", "http://192.168.1.4/v1", "http://user@localhost/v1", "http://127.0.0.1/v1?key=value", "file:///tmp/model" })
    Equal("runtime rejects nonlocal cleartext and credentials in URL", StuDev.Ai.Models.AddressError(address, true) is not null, JsonValue.Create(true));
var runtimeRequest = assistant.Request("deepseek-web", [], new(null, null, "仙林", null, null, null), DateTimeOffset.UtcNow, runtime: true, conversationId: "owned-chat");
Equal("runtime omits unsupported sampling", runtimeRequest.ContainsKey("max_tokens") || runtimeRequest.ContainsKey("temperature"), JsonValue.Create(false));
Equal("runtime sends its stable conversation", (string?)runtimeRequest["conversation_id"], JsonValue.Create("owned-chat"));
Equal("runtime does not retry automatically", runtimeRequest.ContainsKey("retry"), JsonValue.Create(false));
var runtimeRetry = assistant.Request("deepseek-web", [], new(null, null, "仙林", null, null, null), DateTimeOffset.UtcNow, runtime: true, conversationId: "owned-chat", retry: true);
Equal("explicit runtime retry", (bool?)runtimeRetry["retry"], JsonValue.Create(true));
var stableThread = StuDev.Ai.ChatThread.Empty.Append("", "question", new() { ["role"] = "user" }).Append("question", "original", new() { ["role"] = "assistant" }).Append("original", "continued", new() { ["role"] = "assistant" }).Append("question", "fork", new() { ["role"] = "assistant" }).Append("fork", "tool", new() { ["role"] = "tool" }).Append("tool", "fork-answer", new() { ["role"] = "assistant" });
var stableChat = new StuDev.Ai.SavedChat("chat", "", 0, stableThread, ["fork"], ["web-a", "web-b"]);
Equal("main conversation survives adding another branch", stableChat.ConversationId("continued"), JsonValue.Create("chat"));
Equal("tool rounds keep their fork conversation", stableChat.ConversationId("tool"), JsonValue.Create("fork"));
Equal("conversation fork survives save and reopen", StuDev.Ai.SavedChat.Of(stableChat.ToJson()).ConversationId("fork-answer"), JsonValue.Create("fork"));
Equal("models used by the conversation survive save and reopen", StuDev.Ai.SavedChat.Of(stableChat.ToJson()).RuntimeModels, new JsonArray("web-a", "web-b"));
var partialThread = stableThread.Append("continued", "next-question", new() { ["role"] = "user" }).Append("next-question", "partial", new() { ["role"] = "assistant", ["content"] = "partial answer" });
Equal("a stopped partial answer stays in its conversation", (stableChat with { Thread = partialThread }).ConversationId("partial"), JsonValue.Create("chat"));
try { assistant.Read().Take("data: {\"error\":{\"message\":\"请先打开模型网页\",\"code\":\"provider_not_ready\"}}"); failures.Add("runtime SSE error was ignored"); }
catch (InvalidOperationException error) { Equal("SSE error retains its actionable reason", error.Message, JsonValue.Create("请先打开模型网页")); }
try { assistant.Read(true).Take("data: {\"error\":{\"message\":\"The remote model is unavailable\",\"code\":\"provider_unavailable\"}}"); failures.Add("runtime source error was ignored"); }
catch (InvalidOperationException error) { Equal("runtime uses shared natural product copy", error.Message, JsonValue.Create("模型网站暂时不可用，请稍后再试。")); }
Equal("unknown runtime source error retains its diagnostic", assistant.RuntimeError("unknown-provider-error", "provider text"), JsonValue.Create("provider text"));
foreach (var test in assistantCases["streams"]!.AsArray())
{
    var completion = assistant.Read();
    Equal("stream pieces", test!["lines"]!.AsArray().Select(l => completion.Take((string)l!)), test["pieces"]);
    var expected = test["result"]!;
    try { var turn = completion.Result(); checks++; if (!JsonNode.DeepEquals(turn, expected["message"])) failures.Add($"stream turn: expected {expected["message"]?.ToJsonString()}, got {turn.ToJsonString()}"); }
    catch (InvalidOperationException error) { Equal("stream error", error.Message, expected["error"]); }
}
StuDev.Ai.Situation SituationOf(JsonNode given) => new(given["week"] is JsonValue w && w.TryGetValue<int>(out var week) ? week : null, given["class"]?.GetValue<string>(), (string)given["campus"]!, given["name"]?.GetValue<string>(), given["student"]?.GetValue<string>(), given["memory"]?.GetValue<string>());
var asked = DateTimeOffset.FromUnixTimeMilliseconds((long)assistantCases["at"]!);
var question = new List<JsonObject> { new() { ["role"] = "user", ["content"] = "明天有课吗" } };
void Same(string label, JsonNode actual, JsonNode? expected) { checks++; if (!JsonNode.DeepEquals(actual, expected)) failures.Add($"{label}: expected {expected?.ToJsonString()[..Math.Min(400, expected.ToJsonString().Length)]}, got {actual.ToJsonString()[..Math.Min(400, actual.ToJsonString().Length)]}"); }
Same("last request", assistant.Request("deepseek-flash", question, SituationOf(assistantCases["situations"]![0]!["situation"]!), asked, last: true), assistantCases["last"]);
foreach (var test in assistantCases["situations"]!.AsArray()) Same("request", assistant.Request("deepseek-flash", question, SituationOf(test!["situation"]!), asked), test["request"]);
foreach (var test in golden["steps"]!.AsArray())
{
    var calls = test!["calls"]!.AsArray().Select(c => new StuDev.Ai.Call((string)c!["id"]!, (string)c["name"]!, (string)c["arguments"]!)).ToList();
    var steps = StuDev.Ai.Steps.Of(calls, test["results"]!.AsObject().ToDictionary(kv => kv.Key, kv => kv.Value?.DeepClone()));
    Equal("steps", steps.Select(s => new { name = s.Name, label = s.Label, detail = s.Detail, failed = s.Failed, pending = s.Pending }), test["steps"]);
    Equal("steps line", StuDev.Ai.Steps.Line(steps), test["line"]);
}
var thread = golden["thread"]!;
var tree = StuDev.Ai.ChatThread.Empty;
foreach (var (step, frame) in thread["steps"]!.AsArray().Zip(thread["frames"]!.AsArray()))
{
    var id = (string)step!["id"]!;
    tree = (string)step["op"]! == "append" ? tree.Append((string)step["parent"]!, id, new JsonObject { ["role"] = step["role"]!.DeepClone(), ["content"] = step["content"]!.DeepClone() }) : tree.Choose(id);
    Equal("thread path", tree.Path().Select(n => n.Id), frame!["path"]);
    Equal("thread tip", tree.Tip(), frame["tip"]);
    Equal("thread lineage", tree.Lineage(tree.Tip()).Select(n => n.Id), frame["lineage"]);
    foreach (var (node, value) in frame["siblings"]!.AsObject())
    {
        var got = tree.SiblingsOf(node);
        Equal("siblings", new { index = got.Index, count = got.Count }, new JsonObject { ["index"] = value!["index"]!.DeepClone(), ["count"] = value["count"]!.DeepClone() });
    }
}
Equal("thread chain", StuDev.Ai.ChatThread.Chain([new() { ["role"] = "user", ["content"] = "a" }, new() { ["role"] = "assistant", ["content"] = "b" }], ["x", "y"]).Path().Select(n => new[] { n.Id, n.Parent }), thread["chain"]);
var chatCases = golden["chats"]!;
var listed = chatCases["listed"]!.AsArray().Select(c => new StuDev.Ai.SavedChat((string)c!["id"]!, (string)c["title"]!, (long)c["updated"]!, StuDev.Ai.ChatThread.Of(c["thread"]!.AsObject()))).ToList();
Equal("chat titles", listed.Select(c => StuDev.Ai.Chats.TitleOf(c.Title, c.Thread)), chatCases["titles"]);
Equal("chat groups", StuDev.Ai.Chats.Groups(listed, (long)chatCases["now"]!).Select(g => new object[] { g.Name, g.Chats.Select(c => c.Id) }), chatCases["groups"]);
foreach (var test in golden["memory"]!.AsArray())
{
    try { Equal("memory", StuDev.Ai.Memory.Remembered((string)test!["text"]!, (string)test["fact"]!), test["next"]); }
    catch (ArgumentException error) { Equal("memory error", error.Message, test!["error"]); }
}
var allMaterials = JsonSerializer.Deserialize<List<CourseMaterials>>(File.ReadAllText(Path.Combine(repositoryRoot.FullName, "public", "data", (string)golden["source"]!["release"]!, "materials.json")), factsJson)!;
foreach (var test in golden["materials"]!["cases"]!.AsArray()) Same("materials said", Lessons.MaterialsSaid(allMaterials, (string)test!["course"]!), test["said"]);
foreach (var test in golden["materials"]!["counts"]!.AsArray()) Equal("material counts", Lessons.KindCounts(allMaterials.First(m => m.Course == (string)test!["course"]!).Items).Select(k => new object[] { k.Kind, k.Count }), test!["counts"]);
// What the AI is told about a course, a schedule and a training plan.
{
    var dataBase = Path.Combine(repositoryRoot.FullName, "public", "data", (string)golden["source"]!["release"]!);
    var knowledgeIndex = JsonSerializer.Deserialize(File.ReadAllBytes(Path.Combine(dataBase, "knowledge", "knowledge.json")), StuDev.Data.FactsJson.Default.KnowledgeIndex)!;
    var plan = JsonSerializer.Deserialize(File.ReadAllBytes(Path.Combine(dataBase, "curriculum", "courses.json")), StuDev.Data.FactsJson.Default.ListCurriculumCourse)!;
    var allMeetings = JsonSerializer.Deserialize(File.ReadAllBytes(Path.Combine(dataBase, "teaching", (string)golden["source"]!["teaching"]!, "meetings.json")), StuDev.Data.FactsJson.Default.ListTeachingMeeting)!;
    var answers = golden["answers"]!;
    foreach (var test in answers["weeks"]!.AsArray()) Equal("weeks text", StuDev.Ai.Answers.WeeksText(test!["weeks"]!.AsArray().Select(w => (int)w!)), test["text"]);
    foreach (var test in answers["keys"]!.AsArray()) Equal("text key", StuDev.Ai.Answers.TextKey((string)test!["id"]!), test["key"]);
    foreach (var test in answers["course"]!.AsArray()) Same($"course {(string)test!["course"]!}", StuDev.Ai.Answers.Course(knowledgeIndex, allMaterials, (string)test["course"]!), test["said"]);
    foreach (var test in answers["schedule"]!.AsArray()) Same($"schedule {(string)test!["of"]!}", StuDev.Ai.Answers.Schedule(allMeetings, (string)test["of"]!), test["said"]);
    foreach (var test in answers["curriculum"]!.AsArray()) Same($"curriculum {(string)test!["major"]!}", StuDev.Ai.Answers.Curriculum(plan, (string)test["major"]!, (string?)test["grade"]), test["said"]);
}
var syncCase = golden["settingsSync"]!;
var original = syncCase["original"]!.DeepClone().AsObject();
Same("settings parts", SettingsSync.PartsOf(original), syncCase["initial"]);
Same("settings merge", SettingsSync.Merge(syncCase["initial"]!.AsObject(), syncCase["theirs"]!.AsObject()), syncCase["merged"]);
var stamped = original.DeepClone().AsObject(); stamped["modified"] = new JsonObject(SettingsSync.Sections.Where(s => original[s] is not null).Select(s => new KeyValuePair<string, JsonNode?>(s, "1970-01-01T00:00:00.000Z")));
var takenSettings = SettingsSync.Taken(stamped, syncCase["merged"]!.AsObject())!; takenSettings.Remove("modified");
var expectedTaken = syncCase["taken"]!.DeepClone().AsObject(); expectedTaken.Remove("modified");
Same("settings taken", takenSettings, expectedTaken);
var recommendPlaces = Read<List<Place>>(golden["places"]!); var from = Read<double[]>(golden["from"]!);
foreach (var test in golden["recommend"]!.AsArray())
    Equal("recommend", Places.Recommendations(recommendPlaces, (int)test!["day"]!, (int)test["hour"]! * 60 + (int)test["minute"]!, from).Select(s => new { id = s.Place.Id, state = s.Status.Open.ToString().ToLowerInvariant() }), test["expected"]);
foreach (var test in golden["hoursCases"]!.AsArray())
    Equal("opening", Hours.At(JsonDocument.Parse(test!["hours"]!.ToJsonString()).RootElement, (int)test["day"]!, (int)test["minute"]!).Open.ToString().ToLowerInvariant(), test["state"]);
await SearchTest.Check(repositoryRoot.FullName, Equal);
await AccountTest.Check(Equal);
await RuntimeTest.Check(Equal);
Console.WriteLine($"Windows parity: {checks} checks, {failures.Count} failures");
foreach (var failure in failures) Console.WriteLine(failure);
return failures.Count == 0 ? 0 : 1;
