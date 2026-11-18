// What the AI looked up, as src/campus/ai/steps.ts says it: one line for the whole (搜索资料 ×2 · 读原文), and each step
// with what it asked and what came back, including failed attempts and retries.
using System.Text.Json.Nodes;
using StuDev.World;

namespace StuDev.Ai;

public sealed record Step(string Name, string Label, string Detail, bool Failed, bool Pending);
public sealed record Call(string Id, string Name, string Arguments);

public static class Steps
{
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
            case "course": { var course = Text(Field(result, "course")); return (course.Length > 0 ? $"《{course}》" : Quoted("course")) + (done ? Field(result, "chapters") is JsonArray chapters ? $" · {chapters.Count} 章" : " · 没找到" : ""); }
            case "schedule": return Quoted("of") + (done ? Field(result, "count") is JsonValue c && c.TryGetValue<int>(out var n) && n > 0 ? $" · {n} 次课" : " · 没有" : "");
            case "curriculum": { var major = Text(Field(result, "major")); var grade = Text(args["grade"]); return (major.Length > 0 ? major : Text(args["major"])) + (grade.Length > 0 ? $" {grade} 级" : "") + (done ? Field(result, "terms") is JsonArray terms ? $" · {terms.Count} 个学期" : " · 没找到" : ""); }
            case "read": { var title = Text(Field(result, "title")); return done && title.Length > 0 ? $"《{title}》" : Quoted("id"); }
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

    /** Every call in order; a retry never overwrites an earlier attempt. */
    public static List<Step> Of(List<Call> calls, Dictionary<string, JsonNode?> results, Func<string, string?>? webLabel = null)
    {
        var steps = new List<Step>();
        foreach (var call in calls)
        {
            JsonObject args;
            try { args = JsonNode.Parse(call.Arguments) as JsonObject ?? []; } catch (System.Text.Json.JsonException) { args = []; }
            var done = results.ContainsKey(call.Id); var result = results.GetValueOrDefault(call.Id);
            var error = Text(Field(result, "error"));
            var detail = error.Length > 0 ? $"{Detail(call.Name, args, null, false)}：{error}" : Detail(call.Name, args, result, done);
            if (error.Length > 0 && detail.StartsWith('：')) detail = detail[1..];
            var label = ToolMenu.Label(call.Name) ?? webLabel?.Invoke(call.Name) ??
                (call.Name.StartsWith("web_", StringComparison.Ordinal) ? "读取网页" : call.Name);
            var step = new Step(call.Name, label, detail, error.Length > 0, !done);
            steps.Add(step);
        }
        return steps;
    }

    /** The steps in one line: what was done, each kind once, with how many times. */
    public static string Line(List<Step> steps)
    {
        return string.Join(" · ", steps.GroupBy(s => s.Label).Select(group =>
        {
            var failed = group.Count(s => s.Failed); var pending = group.Count(s => s.Pending);
            return group.Key + (group.Count() > 1 ? $" ×{group.Count()}" : "") + (failed > 0 ? $"（失败 {failed}）" : "") + (pending > 0 ? $"（进行中 {pending}）" : "");
        }));
    }
}
