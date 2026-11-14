// The tools the AI calls, run on this device over the same interpreters and Rust kernels as the visual entries:
// src/campus/world/campusTools.ts and tools.ts, Android's CampusTools.kt.
using System.Text.Json;
using System.Text.Json.Nodes;
using StuDev.Data;
using StuDev.Map;
using StuDev.World;

namespace StuDev.Ai;

/** A task drafted, to be confirmed; `Call` is the tool call that drafted it, so it shows in that answer. */

public sealed class CampusTools(Campus campus, List<JsonObject> definitions, Func<string, bool> remember, Action<TaskProposal> propose) : IDisposable
{
    private const int ReadLimit = 8000;
    private static readonly List<Channel> Channels = JsonSerializer.Deserialize(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "world", "channels.json")), StorageJson.Default.ListChannel)!;
    private static readonly Dictionary<string, string> Kinds = new() { ["class"] = "课", ["lab"] = "实验", ["exam"] = "考试", ["run"] = "早锻炼", ["task"] = "任务" };
    private static readonly Dictionary<string, string> Avoid = new() { ["must"] = "必须避开", ["prefer"] = "尽量避开", ["allow"] = "可以重叠" };
    private Search.NativeSearch? search;
    private Space? space;
    private Kernels.Wayfind.Router? router;

    /** A building as said, as the room data writes it: 教三楼 → 教3. */
    public static string BuildingWord(string said)
    {
        var digits = string.Concat(said.Trim().Select(c => "一二三四五六七八九".IndexOf(c) is var i and >= 0 ? (char)('1' + i) : c));
        return digits.Length > 1 && digits.EndsWith('楼') ? digits[..^1] : digits;
    }

    private JsonObject Arguments(string name, JsonObject args)
    {
        var schema = definitions.FirstOrDefault(d => (string)d["function"]!["name"]! == name)?["function"]!["parameters"]!.AsObject() ?? throw new ArgumentException("未知工具。");
        var fields = schema["properties"]!.AsObject();
        if (!args.All(a => fields.ContainsKey(a.Key)) || !(schema["required"]?.AsArray() ?? []).All(r => args.ContainsKey((string)r!))) throw new ArgumentException("工具参数不完整。");
        foreach (var (key, value) in args)
        {
            var field = fields[key]!; if (value is not JsonValue primitive) throw new ArgumentException("工具参数无效。");
            switch ((string)field["type"]!)
            {
                case "string": if (!primitive.TryGetValue<string>(out var s) || s.Length > 2000) throw new ArgumentException("文字参数无效。"); break;
                case "integer":
                    if (!primitive.TryGetValue<int>(out var n) || n < ((int?)field["minimum"] ?? 0) || n > ((int?)field["maximum"] ?? 1440)) throw new ArgumentException("时间或用时范围无效。"); break;
                case "boolean": if (!primitive.TryGetValue<bool>(out _)) throw new ArgumentException("状态参数无效。"); break;
            }
            if (field["enum"] is JsonArray allowed && !allowed.Any(a => a!.ToJsonString() == primitive.ToJsonString())) throw new ArgumentException("选项无效。");
        }
        return args;
    }

    private static DateOnly Date(string value) => System.Text.RegularExpressions.Regex.IsMatch(value, @"^\d{4}-\d{2}-\d{2}$") && DateOnly.TryParseExact(value, "yyyy-MM-dd", out var d) ? d : throw new ArgumentException("日期无效。");
    private static string ToolDay(DateOnly day) => $"{Clock.DateLabel(day)} {Clock.Weekdays[Clock.Weekday(day)]}";
    private Repository Repo => campus.Repository ?? throw new InvalidOperationException("校园数据还没准备好。");
    private async Task<Space> Places() => space ??= await Space.Load(Repo);
    private static string NameOf(Place place) => place.Kind == "room" ? place.Id[(place.Id.IndexOf('/') + 1)..] : place.Names.FirstOrDefault() ?? place.Id;

    /** A place as the model is told it: what it is, where, and whether it is open now. */
    private static JsonObject Said(Space s, Place place)
    {
        var now = CampusDay.Now(); var parent = place.Parent is { } p ? s.ById.GetValueOrDefault(p) : null;
        var hours = Hours.At(place.Hours, now.DayOfWeek == DayOfWeek.Sunday ? 7 : (int)now.DayOfWeek, now.Hour * 60 + now.Minute);
        var said = new JsonObject { ["id"] = place.Id, ["name"] = NameOf(place) };
        if (place.Category is not null) said["category"] = place.Category;
        said["where"] = parent is null ? "校外" : parent.Kind == "campus" ? "校内" : $"{parent.Names.FirstOrDefault() ?? parent.Id}里";
        if (hours.Open != Open.Unknown && hours.Today == "00:00–24:00") { said["today"] = "全天"; said["now"] = "24 小时开放"; }
        else if (hours.Open != Open.Unknown) { said["today"] = hours.Today; said["now"] = hours.Open switch { Open.Closed => "已关闭", Open.Closing => $"快关门了，{hours.ClosesAt} 关", _ => $"开着，{hours.ClosesAt} 关" }; }
        return said;
    }

    public async Task<JsonNode?> Execute(string name, JsonObject raw, string call)
    {
        var args = Arguments(name, raw);
        string Text(string key) => (string)args[key]!;
        switch (name)
        {
            case "search":
            {
                var channel = Channels.FirstOrDefault(c => c.Label == ((string?)args["in"] ?? "全部")) ?? throw new ArgumentException("没有这个搜索范围。");
                search ??= new Search.NativeSearch(Repo);
                var filters = new JsonObject();
                if (channel.Sources is { Count: > 0 } sources) filters["sourceIds"] = new JsonArray([.. sources.Select(x => (JsonNode)x)]);
                if (channel.Excluded is { Count: > 0 } excluded) filters["excludedSourceIds"] = new JsonArray([.. excluded.Select(x => (JsonNode)x)]);
                var page = await search.Page(Text("query"), 6, "relevance", filters, 0, _ => { }, CancellationToken.None);
                return new JsonArray([.. page.Results.Select(r =>
                {
                    var o = new JsonObject { ["id"] = r["id"]!.DeepClone(), ["title"] = r["title"]!.DeepClone() };
                    if (r["sourceName"] is { } source) o["source"] = source.DeepClone();
                    if (r["publishedAt"]?.GetValue<string>() is { } date) o["date"] = date[..10];
                    if (r.ContainsKey("snippet")) o["snippet"] = r["snippet"]?.DeepClone();
                    o["url"] = r["url"]!.DeepClone();
                    return (JsonNode)o;
                })]);
            }
            case "materials": return Lessons.MaterialsSaid(await Repo.Materials(), Text("course"));
            case "read":
            {
                var id = Text("id");
                if (!System.Text.RegularExpressions.Regex.IsMatch(id, "^[0-9a-f]{16}$")) throw new ArgumentException("这条不是文章，课程、教室、地点请用对应的方式查。");
                var doc = JsonNode.Parse(await Repo.Bytes($"texts/{id[..2]}.json"))![id] ?? throw new ArgumentException("找不到这篇资料。");
                var text = (string)doc["text"]!;
                var said = new JsonObject { ["title"] = doc["title"]!.DeepClone(), ["source"] = doc["source"]!.DeepClone() };
                if (doc["published"]?.GetValue<string>() is { } published) said["date"] = published[..10];
                said["url"] = doc["url"]!.DeepClone();
                said["text"] = text.Length > 0 ? text[..Math.Min(ReadLimit, text.Length)] : "这篇的正文没有收录，内容在附件里：把原文链接和附件给对方，不用再找。";
                if (text.Length > ReadLimit) said["cut"] = true;
                said["files"] = new JsonArray([.. doc["files"]!.AsArray().Take(10).Select(f => f!.DeepClone())]);
                return said;
            }
            case "find_place": { var s = await Places(); return new JsonArray([.. Find.Places(s.Places, Text("query")).Select(p => (JsonNode)Said(s, p))]); }
            case "nearby":
            {
                var s = await Places(); var at = Find.Meant(s.Places, s.ById, Text("near"));
                return new JsonObject { ["near"] = NameOf(at), ["places"] = new JsonArray([.. Find.Around(s.Places, s.ById, at, Text("what")).Select(x => { var o = Said(s, x.Place); o["metres"] = x.Metres; return (JsonNode)o; })]) };
            }
            case "remember": remember(Text("fact")); return new JsonObject { ["remembered"] = true };
            case "free_rooms":
            {
                var date = Date(Text("date")); var index = await Repo.Rooms(); var day = await Repo.RoomDay(index.Term, Clock.Text(date));
                if (day is null) return new JsonObject { ["date"] = Clock.Text(date), ["known"] = false, ["rooms"] = new JsonArray() };
                var reader = new Rooms(await Repo.Periods()); var min = (int)args["minute"]!; var minutes = (int)args["minutes"]!;
                var building = (string?)args["building"];
                var rooms = index.Rooms.Where(World.Rooms.Classroom).Where(r => building is null || r.Building.Contains(BuildingWord(building)))
                    .Select(r => (r.Id, State: reader.At(day, r.Id, min))).Where(r => !r.State.Busy && r.State.Minutes >= minutes)
                    .OrderByDescending(r => r.State.Minutes).ThenBy(r => r.Id, StringComparer.Ordinal).Take(12);
                return new JsonObject { ["date"] = Clock.Text(date), ["known"] = true, ["rooms"] = new JsonArray([.. rooms.Select(r => (JsonNode)new JsonObject { ["room"] = r.Id, ["until"] = r.State.Until, ["minutes"] = r.State.Minutes })]) };
            }
            case "route":
            {
                var s = await Places();
                var from = Find.Meant(s.Places, s.ById, Text("from")); var to = Find.Meant(s.Places, s.ById, Text("to"));
                router ??= new Kernels.Wayfind.Router(s.Network);
                var request = new JsonObject { ["origin"] = JsonNode.Parse(from.Routing.GetRawText()), ["destination"] = JsonNode.Parse(to.Routing.GetRawText()), ["mode"] = (string?)args["mode"] ?? "walk", ["avoid_steps"] = false, ["max_snap_distance_m"] = 100, ["alternatives"] = 1 };
                var routes = JsonNode.Parse(router.Route(request.ToJsonString()))!["routes"]!.AsArray();
                if (routes.Count == 0) throw new ArgumentException($"地图里没有从{NameOf(from)}到{NameOf(to)}的路。");
                var route = routes[0]!;
                return new JsonObject
                {
                    ["from"] = NameOf(from), ["to"] = NameOf(to), ["distance_m"] = (long)Math.Round((double)route["distance_m"]!, MidpointRounding.AwayFromZero), ["duration_s"] = (long)Math.Round((double)route["duration_s"]!, MidpointRounding.AwayFromZero),
                    ["steps"] = new JsonArray([.. route["maneuvers"]!.AsArray().Select(m => (JsonNode)(string)m!["instruction"]!)]), ["url"] = $"/map/?from={Uri.EscapeDataString(from.Id)}&nav={Uri.EscapeDataString(to.Id)}",
                };
            }
        }
        var line = campus.Line ?? throw new InvalidOperationException("请先选择班级，等待课表读取完成。");
        var now = Moment.Now();
        switch (name)
        {
            case "timeline":
            {
                var start = Date(Text("from")); var end = Date(Text("to")); var days = end.DayNumber - start.DayNumber;
                if (days is < 0 or > 13) throw new ArgumentException("一次最多查询14天。");
                return new JsonArray([.. Enumerable.Range(0, days + 1).Select(offset =>
                {
                    var day = start.AddDays(offset);
                    return (JsonNode)new JsonObject
                    {
                        ["date"] = Clock.Text(day), ["day"] = ToolDay(day),
                        ["events"] = new JsonArray([.. line.On(day).Select(e => { var o = new JsonObject(); if (e.Task is not null) o["task"] = e.Id; o["kind"] = Kinds[e.Kind]; o["name"] = e.Name; o["time"] = $"{Clock.Hm(e.Start)}–{Clock.Hm(e.End)}"; o["room"] = e.Room; o["avoid"] = Avoid[e.Avoid]; return (JsonNode)o; })]),
                        ["due"] = new JsonArray([.. line.DueOn(day).Select(t => (JsonNode)new JsonObject { ["task"] = t.Id, ["title"] = t.Title, ["when"] = $"{ToolDay(Clock.Parse(t.Due!.Date))} {(t.Due.Time is { } m ? Clock.Hm(m) : "当天")}", ["done"] = t.Done is not null })]),
                    };
                })]);
            }
            case "exams":
            {
                var exams = line.Exams.OrderBy(x => x.Date, StringComparer.Ordinal).ThenBy(x => x.Start, StringComparer.Ordinal).Select(x =>
                {
                    var o = new JsonObject { ["course"] = x.Course.Name, ["day"] = ToolDay(Clock.Parse(x.Date)), ["time"] = $"{x.Start}–{x.End}", ["room"] = x.Location };
                    if (string.CompareOrdinal(x.Date, Clock.Text(now.Date)) < 0) o["done"] = true;
                    return (JsonNode)o;
                }).ToList();
                var said = new JsonObject { ["exams"] = new JsonArray([.. exams]) };
                if (exams.Count == 0) said["note"] = "学校还没有发布这学期你的考试安排。";
                return said;
            }
            case "list_tasks": return JsonSerializer.SerializeToNode(campus.Tasks.Live.ToList(), StorageJson.Default.ListPersonalTask);
            case "suggest_slots":
            {
                var from = Date(Text("from")); var to = Date(Text("to"));
                if (to.DayNumber - from.DayNumber is < 0 or > 13) throw new ArgumentException("一次最多排14天。");
                var id = (string?)args["task_id"]; var task = id is null ? null : line.Tasks.FirstOrDefault(t => t.Id == id && t.Deleted != true);
                if (id is not null && task is null) throw new ArgumentException("要移动的任务不存在。");
                return new JsonArray([.. Planning.Available(line, new SlotRequest(Clock.Text(from), Clock.Text(to), (int)args["minutes"]!, Exclude: id, Due: task?.Due), now).Take(12)
                    .Select(s => (JsonNode)new JsonObject { ["date"] = s.Date, ["start"] = s.Start, ["end"] = s.End, ["day"] = ToolDay(Clock.Parse(s.Date)), ["time"] = $"{Clock.Hm(s.Start)}–{Clock.Hm(s.End)}", ["overlaps"] = s.Clashes.Count })]);
            }
            case "propose_task":
            {
                var proposal = Proposal(args, line, call);
                propose(proposal);
                var task = JsonSerializer.SerializeToNode(proposal.Task, StorageJson.Default.PersonalTask)!.AsObject(); task.Remove("id"); task.Remove("modified");
                return new JsonObject { ["state"] = "awaiting_user_confirmation", ["proposal"] = proposal.Key, ["task"] = task };
            }
        }
        throw new ArgumentException("未知工具。");
    }

    private static TaskProposal Proposal(JsonObject args, CampusLine line, string call)
    {
        var id = (string?)args["id"]; var old = id is null ? null : line.Tasks.FirstOrDefault(t => t.Id == id && t.Deleted != true);
        if (id is not null && old is null) throw new ArgumentException("要修改的任务不存在。");
        var title = ((string)args["title"]!).Trim(); title = title[..Math.Min(200, title.Length)];
        var task = (old ?? new PersonalTask { Id = "proposal", Title = "", Modified = "proposal" }) with { Title = title };
        int? Int(string key) => (int?)args[key];
        task = args.ContainsKey("date") ? task with { Date = Clock.Text(Date((string)args["date"]!)), Start = Int("start"), End = Int("end") } : task with { Start = Int("start") ?? task.Start, End = Int("end") ?? task.End };
        if (args.ContainsKey("due_date")) task = task with { Due = (task.Due ?? new Deadline("")) with { Date = Clock.Text(Date((string)args["due_date"]!)), Time = Int("due_time") ?? task.Due?.Time } };
        else if (args.ContainsKey("due_time")) { if (task.Due is null) throw new ArgumentException("请先给出截止日期。"); task = task with { Due = task.Due with { Time = Int("due_time") } }; }
        if (args.ContainsKey("note")) { var note = ((string)args["note"]!).Trim(); task = task with { Note = note.Length > 0 ? note[..Math.Min(4000, note.Length)] : null }; }
        if (args.ContainsKey("done")) task = task with { Done = (bool)args["done"]! ? "awaiting-confirmation" : null };
        if (task.Title.Length == 0 || (task.Date is null) != (task.Start is null) || task.End is not null && (task.Start is null || task.End <= task.Start)) throw new ArgumentException("执行安排需要有效日期、开始和结束；截止请单独指定。");
        return new(task, old?.Id, old?.Modified, Guid.NewGuid().ToString(), call);
    }

    public void Dispose() { search?.Dispose(); router?.Dispose(); }
}
