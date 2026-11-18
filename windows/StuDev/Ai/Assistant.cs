// The AI's one contract, as src/campus/world/assistant.mjs and Android's Assistant.kt: what the model is told
// (assistant.json, filled in with the campus situation), the tools it may call (tools.json), the request a
// provider is sent, and a streamed answer read into one turn. The parity golden locks all of it.
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace StuDev.Ai;

/** A task drafted, to be confirmed; `Call` is the tool call that drafted it, so it shows in that answer. */
public sealed record TaskProposal(World.PersonalTask Task, string? Id, string? Expected, string Key, string Call, bool Saved = false);

/** The campus situation shared with the model. */
public sealed record Situation(int? Week, string? Klass, string Campus, string? Memory)
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

    private string CampusContext(Situation s)
    {
        var where = Fill(Phrase("me", s.Klass is not null ? "class" : "noClass"), new() { ["campus"] = s.Campus, ["class"] = s.Klass });
        return where + Phrase("me", "anyone");
    }

    /** What the model is told before the conversation. */
    public string Instructions(Situation s, DateTimeOffset now)
    {
        var week = s.Week switch { null => Phrase("week", "unknown"), 0 => Phrase("week", "out"), _ => Fill(Phrase("week", "in"), new() { ["week"] = s.Week }) };
        var values = new Dictionary<string, object?> { ["now"] = NanjingNow(now), ["week"] = week, ["me"] = CampusContext(s), ["diagrams"] = string.Join("、", Diagrams) };
        var all = Lines("prompt").Select(l => Fill(l, values)).ToList();
        if (s.Memory is not null) all.AddRange(Lines("memory").Select(l => Fill(l, new() { ["memory"] = s.Memory.Trim() is { Length: > 0 } m ? m : "（还没有）" })));
        return string.Join("\n", all);
    }

    /** The tools offered: all of them, but `remember` only to someone who keeps a memory. */
    public List<JsonObject> ToolsFor(Situation s) => s.Memory is null ? tools.Where(t => (string)t["function"]!["name"]! != "remember").ToList() : tools;

    /** The request a provider is sent: OpenAI's chat completions, as every provider speaks it. */
    public JsonObject Request(string model, List<JsonObject> messages, Situation s, DateTimeOffset now, bool last = false, bool runtime = false, string? conversationId = null, bool retry = false)
    {
        var request = new JsonObject { ["model"] = model, ["stream"] = true };
        if (!runtime) { request["max_tokens"] = 4096; request["temperature"] = 0.2; }
        else { if (string.IsNullOrWhiteSpace(conversationId)) throw new InvalidOperationException("对话尚未初始化，请重新打开对话。"); request["conversation_id"] = conversationId; if (retry) request["retry"] = true; }
        if (!last) request["tools"] = new JsonArray([.. ToolsFor(s).Select(t => t.DeepClone())]);
        request["messages"] = new JsonArray([new JsonObject { ["role"] = "system", ["content"] = Instructions(s, now) + (last ? "\n" + (string)contract["finish"]! : "") }, .. messages.Select(m => m.DeepClone())]);
        return request;
    }

    public string RuntimeError(string? code, string fallback) => code is not null && contract["runtimeErrors"]?[code] is JsonValue value && value.TryGetValue<string>(out var text) ? text : fallback;
    public string? RuntimeStage(string stage) => contract["runtimeStages"]?[stage]?.GetValue<string>();
    public Completion Read(bool runtime = false) => new(names, runtime ? RuntimeError : null);

    /** A streamed answer read line by line. */
    public sealed class Completion(HashSet<string> names, Func<string?, string, string>? runtimeError = null)
    {
        private readonly StringBuilder content = new();
        private string? finish;
        private readonly SortedDictionary<int, (StringBuilder Id, StringBuilder Name, StringBuilder Arguments)> calls = new();
        private string pending = "";
        private bool protocolError;

        /** One line of the stream; the piece of the answer it adds, or "". */
        public string Take(string line)
        {
            if (!line.StartsWith("data:")) return "";
            var data = line["data:".Length..].Trim();
            if (data.Length == 0 || data == "[DONE]") return "";
            var envelope = JsonNode.Parse(data);
            if (envelope?["error"] is { } error)
            {
                var message = error is JsonObject detail ? detail["message"] : error;
                var diagnostic = message is JsonValue value && value.TryGetValue<string>(out var said) ? said : "模型服务未能完成请求。";
                throw new InvalidOperationException(runtimeError is null ? diagnostic : runtimeError(error is JsonObject coded ? (string?)coded["code"] : null, diagnostic));
            }
            if (envelope?["choices"]?.AsArray().FirstOrDefault() is not JsonObject choice) return "";
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
            if (protocolError) return "";
            pending += delta["content"] is JsonValue c && c.TryGetValue<string>(out var text) ? text : "";
            string[] markers = ["<｜DSML｜", "<|DSML|"];
            var found = markers.Select(m => pending.IndexOf(m, StringComparison.Ordinal)).Where(at => at >= 0).DefaultIfEmpty(-1).Min();
            if (found >= 0)
            {
                var before = pending[..found]; content.Append(before); pending = ""; protocolError = true;
                return before;
            }
            var held = 0;
            for (var size = 1; size <= pending.Length && size < 8; size++) if (markers.Any(m => m.StartsWith(pending[^size..], StringComparison.Ordinal))) held = size;
            if (finish is not null)
            {
                if (held > 1) { protocolError = true; pending = ""; return ""; }
                held = 0;
            }
            var piece = pending[..(pending.Length - held)]; pending = pending[(pending.Length - held)..];
            content.Append(piece);
            return piece;
        }

        /** The turn, once the stream has ended; thrown when it is not one. */
        public JsonObject Result()
        {
            if (protocolError) throw new InvalidOperationException("模型未能正确发起查询，请重试。");
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
public sealed record Own(string Base, string Model, string Key, bool Runtime = false);

/** Which model answers, as src/campus/ai/model.ts. */
public static class Models
{
    public const string OwnerAvatar = "https://q1.qlogo.cn/g?b=qq&nk=2366522877&s=100";
    public static readonly Own Starting = new("https://api.deepseek.com", "deepseek-chat", "");
    public static readonly Own Runtime = new("http://127.0.0.1:9316/v1", "deepseek-web", "", true);
    public static string Endpoint(string @base) { var root = @base.Trim().TrimEnd('/'); return root.EndsWith("/chat/completions") ? root : root + "/chat/completions"; }
    public static List<string> ModelsEndpoints(string @base)
    {
        var root = @base.Trim().TrimEnd('/');
        if (root.EndsWith("/chat/completions")) root = root[..^"/chat/completions".Length];
        if (root.EndsWith("/models")) root = root[..^"/models".Length];
        var first = root + "/models";
        return Regex.IsMatch(root, @"/v\d+$") ? [first] : [first, root + "/v1/models"];
    }
    public static async Task<List<string>> FetchModelsAsync(HttpClient http, string @base, string key, bool runtime = false, CancellationToken cancel = default)
    {
        if (AddressError(@base, runtime) is not null) throw new InvalidOperationException("接口地址格式不对");
        var trimmed = key.Trim();
        if (trimmed.Length == 0) throw new InvalidOperationException("请先填写 API Key");
        foreach (var url in ModelsEndpoints(@base))
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", trimmed);
            using var res = await http.SendAsync(req, cancel);
            if ((int)res.StatusCode == 404) continue;
            if (!res.IsSuccessStatusCode) throw new InvalidOperationException((int)res.StatusCode == 401 ? "API Key 无效或无权限" : $"请求失败（{(int)res.StatusCode}）");
            var root = JsonNode.Parse(await res.Content.ReadAsStringAsync(cancel))?.AsObject();
            var ids = root?["data"]?.AsArray().Select(item => (string?)item?["id"]).Where(id => !string.IsNullOrWhiteSpace(id)).Select(id => id!.Trim()).Distinct().ToList() ?? [];
            if (ids.Count > 0) return ids;
        }
        throw new InvalidOperationException("接口没有返回模型列表，可直接手动填写模型名");
    }
    public static string? AddressError(string @base, bool runtime = false)
    {
        var said = runtime ? "Local Runtime MCP 地址须指向这台电脑，例如 http://127.0.0.1:9316/v1。" : "接口地址以 https:// 开头，只写地址本身。";
        if (!Uri.TryCreate(@base.Trim(), UriKind.Absolute, out var uri)) return said;
        var transport = runtime ? (uri.Host is "localhost" or "127.0.0.1" or "[::1]") && (uri.Scheme is "https" or "http") : uri.Scheme == "https";
        return transport && uri.Host.Length > 0 && uri.UserInfo.Length == 0 && uri.Query.Length == 0 && uri.Fragment.Length == 0 ? null : said;
    }
    public static async Task CloseConversationsAsync(HttpClient http, Own own, IEnumerable<string> models, IEnumerable<string> ids)
    {
        if (!own.Runtime || own.Key.Length == 0) return;
        if (AddressError(own.Base, true) is { } wrong) throw new InvalidOperationException(wrong);
        var root = Endpoint(own.Base)[..^"/chat/completions".Length];
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var pages = models.Distinct().SelectMany(model => ids.Distinct().Select(id => (Model: model, Id: id)));
        Exception? failure = null;
        foreach (var batch in pages.Chunk(4))
        {
            var results = await Task.WhenAll(batch.Select(async page =>
            {
                try
                {
                    using var request = new HttpRequestMessage(HttpMethod.Delete, $"{root}/conversations/{Uri.EscapeDataString(page.Id)}?model={Uri.EscapeDataString(page.Model)}");
                    request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", own.Key);
                    using var response = await http.SendAsync(request, timeout.Token);
                    if (!response.IsSuccessStatusCode && response.StatusCode != System.Net.HttpStatusCode.NotFound)
                        throw new InvalidOperationException($"本地模型服务未能关闭对应网页（{(int)response.StatusCode}）。");
                    return (Exception?)null;
                }
                catch (Exception error) when (error is HttpRequestException or OperationCanceledException or InvalidOperationException) { return error; }
            }));
            failure ??= results.FirstOrDefault(result => result is not null);
        }
        if (failure is not null) throw failure;
    }
}
