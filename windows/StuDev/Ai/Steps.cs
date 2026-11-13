// What the AI looked up, as src/campus/ai/steps.ts says it: one line for the whole (搜索资料 ×2 · 读原文), and each step
// with what it asked and what came back. The same call made twice is one step.
using System.Text.Json.Nodes;
using StuDev.World;

namespace StuDev.Ai;

public sealed record Step(string Name, string Label, string Detail, bool Failed, bool Pending);
public sealed record Call(string Id, string Name, string Arguments);

public static class Steps
{
    private static readonly Dictionary<string, string> Labels = new()
    {
        ["search"] = "搜索资料", ["read"] = "读原文", ["materials"] = "找课程资料", ["find_place"] = "找地点", ["nearby"] = "找附近", ["route"] = "规划路线", ["timeline"] = "查看安排",
        ["exams"] = "查考试", ["list_tasks"] = "读取任务", ["suggest_slots"] = "找空闲时间", ["free_rooms"] = "查空教室", ["propose_task"] = "起草任务", ["remember"] = "记住",
    };
    private static string Text(JsonNode? value) => value is JsonValue v && v.TryGetValue<string>(out var s) ? s : "";
    private static int Count(JsonNode? value) => value is JsonArray a ? a.Count : 0;
    private static JsonNode? Field(JsonNode? value, string key) => value is JsonObject o ? o[key] : null;
    private static string Day(string date) => DateOnly.TryParseExact(date, "yyyy-MM-dd", out var d) ? Clock.DateLabel(d) : "";
    private static string Days(string from, string to) => from == to ? Day(from) : $"{Day(from)}–{Day(to)}";
    private static string? Number(JsonNode? value) => value is JsonValue v && !v.TryGetValue<string>(out _) ? v.ToJsonString() : null;

    private static string Detail(string name, JsonObject args, JsonNode? result, bool done)
    {
        string Quoted(string key) => $"“{Text(args[key])}”";
        switch (name)
        {
            case "search": return Quoted("query") + (args["in"] is { } scope && Text(scope) != "全部" ? $" · {Text(scope)}" : "") + (done ? $" · {Count(result)} 条" : "");
            case "materials":
                if (!done) return Quoted("course");
                var all = new List<JsonNode?>(); if (result is not null) all.Add(result); if (Field(result, "courses") is JsonArray more) all.AddRange(more);
                var n = all.Sum(one => Field(one, "kinds") is JsonObject kinds ? kinds.Sum(k => k.Value is JsonArray list ? list.Count : 0) : 0);
                return Quoted("course") + (n > 0 ? $" · {n} 份" : " · 没有");
            case "read": { var title = Text(Field(result, "title")); return done && title.Length > 0 ? $"《{title}》" : ""; }
            case "find_place": { var first = result is JsonArray found && found.Count > 0 ? Text(Field(found[0], "name")) : ""; return Quoted("query") + (done ? first.Length > 0 ? $" → {first}" : " · 没找到" : ""); }
            case "nearby": { var near = Text(Field(result, "near")); return $"{(near.Length > 0 ? near : Text(args["near"]))}附近的{Text(args["what"])}" + (Field(result, "places") is JsonArray places && done ? $" · {places.Count} 处" : ""); }
            case "route":
            {
                var from = Text(Field(result, "from")); var to = Text(Field(result, "to"));
                var metres = Field(result, "distance_m") is JsonValue d && d.TryGetValue<double>(out var m) ? $" · {Math.Round(m, MidpointRounding.AwayFromZero)} 米" : "";
                return $"{(from.Length > 0 ? from : Text(args["from"]))} → {(to.Length > 0 ? to : Text(args["to"]))}{metres}";
            }
            case "timeline": return Days(Text(args["from"]), Text(args["to"]));
            case "exams": return Field(result, "exams") is JsonArray exams && done ? $"{exams.Count} 场" : "";
            case "list_tasks": return done ? $"{Count(result)} 个" : "";
            case "suggest_slots": return $"{Days(Text(args["from"]), Text(args["to"]))} · {Number(args["minutes"])} 分钟" + (done ? $" · {Count(result)} 个空档" : "");
            case "free_rooms":
                return $"{Day(Text(args["date"]))} {(args["minute"] is JsonValue min && min.TryGetValue<int>(out var at) ? Clock.Hm(at) : "")}" + (args["building"] is { } b && Text(b).Length > 0 ? $" · {Text(b)}" : "") + (done ? $" · {Count(Field(result, "rooms"))} 间" : "");
            case "propose_task": return Quoted("title");
            case "remember": return Quoted("fact");
            default: return "";
        }
    }

    /** The steps of one answer, in the order they were taken, the same call made again taken once. */
    public static List<Step> Of(List<Call> calls, Dictionary<string, JsonNode?> results)
    {
        var steps = new List<(string Key, Step Step)>();
        foreach (var call in calls)
        {
            JsonObject args;
            try { args = JsonNode.Parse(call.Arguments) as JsonObject ?? []; } catch (System.Text.Json.JsonException) { args = []; }
            var done = results.ContainsKey(call.Id); var result = results.GetValueOrDefault(call.Id);
            var error = Text(Field(result, "error"));
            var key = $"{call.Name} {args.ToJsonString()}";
            var detail = error.Length > 0 ? $"{Detail(call.Name, args, null, false)}：{error}" : Detail(call.Name, args, result, done);
            if (error.Length > 0 && detail.StartsWith('：')) detail = detail[1..];
            var step = new Step(call.Name, Labels.GetValueOrDefault(call.Name) ?? call.Name, detail, error.Length > 0, !done);
            var at = steps.FindIndex(s => s.Key == key);
            if (at >= 0) steps[at] = (key, step); else steps.Add((key, step));
        }
        return steps.Select(s => s.Step).ToList();
    }

    /** The steps in one line: what was done, each kind once, with how many times. */
    public static string Line(List<Step> steps)
    {
        var counts = new List<(string Label, int Count)>();
        foreach (var step in steps) { var at = counts.FindIndex(c => c.Label == step.Label); if (at >= 0) counts[at] = (step.Label, counts[at].Count + 1); else counts.Add((step.Label, 1)); }
        return (steps.Any(s => s.Pending) ? "正在" : "已") + string.Join(" · ", counts.Select(c => c.Count > 1 ? $"{c.Label} ×{c.Count}" : c.Label));
    }
}
