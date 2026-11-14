// The AI's one contract, as src/campus/world/assistant.mjs and Android's Assistant.kt: what the model is told
// (assistant.json, filled in with the moment and who is asking), the tools it may call (tools.json), the request a
// provider is sent, and a streamed answer read into one turn. The parity golden locks all of it.
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace StuDev.Ai;

/** A task drafted, to be confirmed; `Call` is the tool call that drafted it, so it shows in that answer. */
public sealed record TaskProposal(World.PersonalTask Task, string? Id, string? Expected, string Key, string Call, bool Saved = false);

/** Who is asking and when, as far as this device knows. */
public sealed record Situation(int? Week, string? Klass, string Campus, string? Name, string? Student, string? Memory)
{
    public JsonObject ToJson() => new() { ["week"] = Week, ["class"] = Klass, ["campus"] = Campus, ["memory"] = Memory };
}

public sealed class Assistant(JsonObject contract, List<JsonObject> tools)
{
    /** How many times the model may look things up for one question. */
    public const int Rounds = 8;
    private static readonly TimeZoneInfo Nanjing = TimeZoneInfo.FindSystemTimeZoneById("China Standard Time");
    private static readonly string[] Weekdays = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
    private readonly HashSet<string> names = tools.Select(t => (string)t["function"]!["name"]!).ToHashSet();
    public List<JsonObject> Tools => tools;
    public List<string> Diagrams => contract["diagrams"]!.AsArray().Select(d => (string)d!).ToList();
    private List<string> Lines(string key) => contract[key]!.AsArray().Select(l => (string)l!).ToList();
    private string Phrase(string group, string key) => (string)contract[group]![key]!;
    private static string Fill(string text, Dictionary<string, object?> values) => Regex.Replace(text, @"\{(\w+)\}", m => values.TryGetValue(m.Groups[1].Value, out var v) ? v?.ToString() ?? "null" : "null");

    public static Assistant Load(string folder) => new(JsonNode.Parse(File.ReadAllText(Path.Combine(folder, "assistant.json")))!.AsObject(),
        JsonNode.Parse(File.ReadAllText(Path.Combine(folder, "tools.json")))!.AsArray().Select(t => t!.AsObject()).ToList());

    /** The moment in Nanjing, as people say it: 2026年11月13日 周五 16:40. */
    public static string NanjingNow(DateTimeOffset now)
    {
        var at = TimeZoneInfo.ConvertTime(now, Nanjing);
        return $"{at.Year}年{at.Month}月{at.Day}日 {Weekdays[at.DayOfWeek == DayOfWeek.Sunday ? 7 : (int)at.DayOfWeek]} {at.Hour:00}:{at.Minute:00}";
    }

    private string Who(Situation s)
    {
        var where = Fill(Phrase("me", s.Klass is not null ? "class" : "noClass"), new() { ["campus"] = s.Campus, ["class"] = s.Klass });
        return where + (s.Name is not null ? Fill(Phrase("me", "named"), new() { ["name"] = s.Name, ["student"] = s.Student ?? "未知" }) : Phrase("me", "anyone"));
    }

    /** What the model is told before the conversation. */
    public string Instructions(Situation s, DateTimeOffset now)
    {
        var week = s.Week is null ? Phrase("week", "out") : Fill(Phrase("week", "in"), new() { ["week"] = s.Week });
        var values = new Dictionary<string, object?> { ["now"] = NanjingNow(now), ["week"] = week, ["me"] = Who(s), ["diagrams"] = string.Join("、", Diagrams) };
        var all = Lines("prompt").Select(l => Fill(l, values)).ToList();
        if (s.Memory is not null) all.AddRange(Lines("memory").Select(l => Fill(l, new() { ["memory"] = s.Memory.Trim() is { Length: > 0 } m ? m : "（还没有）" })));
        return string.Join("\n", all);
    }

    /** The tools offered: all of them, but `remember` only to someone who keeps a memory. */
    public List<JsonObject> ToolsFor(Situation s) => s.Memory is null ? tools.Where(t => (string)t["function"]!["name"]! != "remember").ToList() : tools;

    /** The request a provider is sent: OpenAI's chat completions, as every provider speaks it. */
    public JsonObject Request(string model, List<JsonObject> messages, Situation s, DateTimeOffset now, bool last = false)
    {
        var request = new JsonObject { ["model"] = model, ["stream"] = true, ["max_tokens"] = 4096, ["temperature"] = 0.2, ["tools"] = new JsonArray([.. ToolsFor(s).Select(t => t.DeepClone())]) };
        if (last) request["tool_choice"] = "none";
        request["messages"] = new JsonArray([new JsonObject { ["role"] = "system", ["content"] = Instructions(s, now) }, .. messages.Select(m => m.DeepClone())]);
        return request;
    }

    public Completion Read() => new(names);

    /** A streamed answer read line by line. */
    public sealed class Completion(HashSet<string> names)
    {
        private readonly StringBuilder content = new();
        private string? finish;
        private readonly SortedDictionary<int, (StringBuilder Id, StringBuilder Name, StringBuilder Arguments)> calls = new();

        /** One line of the stream; the piece of the answer it adds, or "". */
        public string Take(string line)
        {
            if (!line.StartsWith("data:")) return "";
            var data = line["data:".Length..].Trim();
            if (data.Length == 0 || data == "[DONE]") return "";
            if (JsonNode.Parse(data)?["choices"]?.AsArray().FirstOrDefault() is not JsonObject choice) return "";
            var delta = choice["delta"] as JsonObject ?? [];
            foreach (var item in delta["tool_calls"]?.AsArray() ?? [])
            {
                var index = item!["index"] is JsonValue i && i.TryGetValue<int>(out var n) ? n : calls.Count;
                if (!calls.TryGetValue(index, out var call)) calls[index] = call = (new(), new(), new());
                if (item["id"] is JsonValue id && id.TryGetValue<string>(out var said)) { call.Id.Clear(); call.Id.Append(said); }
                if (item["function"] is JsonObject function)
                {
                    if (function["name"] is JsonValue name && name.TryGetValue<string>(out var called)) call.Name.Append(called);
                    if (function["arguments"] is JsonValue args && args.TryGetValue<string>(out var given)) call.Arguments.Append(given);
                }
            }
            if (choice["finish_reason"] is JsonValue f && f.TryGetValue<string>(out var reason)) finish = reason;
            var piece = delta["content"] is JsonValue c && c.TryGetValue<string>(out var text) ? text : "";
            content.Append(piece);
            return piece;
        }

        /** The turn, once the stream has ended; thrown when it is not one. */
        public JsonObject Result()
        {
            var made = calls.Values.Select(c => new JsonObject { ["id"] = c.Id.ToString(), ["type"] = "function", ["function"] = new JsonObject { ["name"] = c.Name.ToString(), ["arguments"] = c.Arguments.ToString() } }).ToList();
            // An answer cut at its length is still an answer, what it got to say; a cut tool call is not.
            var whole = finish is "stop" or "tool_calls" || (finish == "length" && made.Count == 0 && content.Length > 0);
            if (!whole || made.Any(m => ((string)m["id"]!).Length == 0 || !names.Contains((string)m["function"]!["name"]!)))
                throw new InvalidOperationException("AI 回答未完成，请缩短问题后重试。");
            var turn = new JsonObject { ["role"] = "assistant", ["content"] = content.Length > 0 ? content.ToString() : null };
            if (made.Count > 0) turn["tool_calls"] = new JsonArray([.. made]);
            return turn;
        }
    }
}

/** One's own provider: where, which model, and the key, which never leaves this device. */
public sealed record Own(string Base, string Model, string Key);

/** Which model answers, as src/campus/ai/model.ts. */
public static class Models
{
    public static readonly Own Starting = new("https://api.deepseek.com", "deepseek-flash", "");
    public static string Endpoint(string @base) { var root = @base.Trim().TrimEnd('/'); return root.EndsWith("/chat/completions") ? root : root + "/chat/completions"; }
    public static string? AddressError(string @base)
    {
        const string said = "接口地址以 https:// 开头，只写地址本身。";
        if (!Uri.TryCreate(@base.Trim(), UriKind.Absolute, out var uri)) return said;
        return uri.Scheme == "https" && uri.Host.Length > 0 && uri.UserInfo.Length == 0 && uri.Query.Length == 0 && uri.Fragment.Length == 0 ? null : said;
    }
    public static string Name(Own own) => own.Model.Trim().Length > 0 ? own.Model : "我的 API";
}
