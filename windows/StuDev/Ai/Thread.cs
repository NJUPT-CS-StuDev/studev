// A conversation as a tree, as src/campus/ai/thread.ts: a question changed, or an answer asked again, grows a new
// branch beside the old one; what is shown, and what the model is given, is the path the chosen branches make.
using System.Text.Json.Nodes;

namespace StuDev.Ai;

public sealed record ChatNode(string Id, string Parent, JsonObject Message, IReadOnlyList<string>? PreferredTools = null)
{
    internal JsonObject ToJson()
    {
        var value = new JsonObject { ["id"] = Id, ["parent"] = Parent, ["message"] = Message.DeepClone() };
        if (PreferredTools is { Count: > 0 }) value["preferredTools"] = new JsonArray([.. PreferredTools.Select(name => (JsonNode)JsonValue.Create(name)!)]);
        return value;
    }
}
public sealed record Siblings(int Index, int Count, string? Previous, string? Next);

public sealed record ChatThread(List<ChatNode> Nodes, Dictionary<string, string> Chosen)
{
    public const string Start = "";
    public static ChatThread Empty => new([], new());
    public List<ChatNode> Children(string parent) => Nodes.Where(n => n.Parent == parent).ToList();

    /** The conversation as shown: from the start, at each fork the branch chosen, else the newest. */
    public List<ChatNode> Path()
    {
        var path = new List<ChatNode>(); var at = Start;
        while (true)
        {
            var next = Children(at);
            if (next.Count == 0) return path;
            var pick = next.FirstOrDefault(n => Chosen.TryGetValue(at, out var c) && n.Id == c) ?? next[^1];
            path.Add(pick); at = pick.Id;
        }
    }
    public string Tip() => Path().LastOrDefault()?.Id ?? Start;
    /** A message and everything before it, oldest first. */
    public List<ChatNode> Lineage(string id)
    {
        var byId = Nodes.ToDictionary(n => n.Id); var line = new List<ChatNode>();
        for (var at = byId.GetValueOrDefault(id); at is not null; at = byId.GetValueOrDefault(at.Parent)) line.Add(at);
        line.Reverse(); return line;
    }
    public ChatThread Append(string parent, string id, JsonObject message, IReadOnlyList<string>? preferredTools = null) =>
        new([.. Nodes, new ChatNode(id, parent, message, preferredTools)], new(Chosen) { [parent] = id });
    public ChatThread Choose(string id) => Nodes.FirstOrDefault(n => n.Id == id) is { } node ? this with { Chosen = new(Chosen) { [node.Parent] = id } } : this;
    public Siblings SiblingsOf(string id)
    {
        var all = Nodes.FirstOrDefault(n => n.Id == id) is { } node ? Children(node.Parent) : [];
        var index = all.FindIndex(n => n.Id == id);
        return new(index, all.Count, index > 0 ? all[index - 1].Id : null, index >= 0 && index + 1 < all.Count ? all[index + 1].Id : null);
    }
    public JsonObject ToJson() => new()
    {
        ["nodes"] = new JsonArray([.. Nodes.Select(n => (JsonNode)n.ToJson())]),
        ["chosen"] = new JsonObject(Chosen.Select(kv => new KeyValuePair<string, JsonNode?>(kv.Key, kv.Value))),
    };
    public static ChatThread Of(JsonObject json) => new(
        json["nodes"]!.AsArray().Select(n => new ChatNode((string)n!["id"]!, (string)n["parent"]!, n["message"]!.DeepClone().AsObject(), n["preferredTools"]?.AsArray().Select(name => (string)name!).ToList())).ToList(),
        (json["chosen"] as JsonObject ?? []).ToDictionary(kv => kv.Key, kv => (string)kv.Value!));
    public static ChatThread Chain(List<JsonObject> messages, List<string> ids)
    {
        var thread = Empty;
        for (var i = 0; i < messages.Count; i++) thread = thread.Append(i == 0 ? Start : ids[i - 1], ids[i], messages[i]);
        return thread;
    }
}

public sealed record ModelChoice(string ProviderId, string ModelId)
{
    public static readonly ModelChoice Free = new("free", "auto");
    public JsonObject ToJson() => new() { ["providerId"] = ProviderId, ["modelId"] = ModelId };
    public static ModelChoice? Of(JsonNode? node) =>
        node is JsonObject value && value["providerId"] is JsonValue provider && provider.TryGetValue<string>(out var providerId)
                               && value["modelId"] is JsonValue model && model.TryGetValue<string>(out var modelId)
        ? new(providerId, modelId) : null;
}

/** A conversation kept on this device. */
public sealed record SavedChat(string Id, string Title, long Updated, ChatThread Thread, List<string>? Forks = null,
    List<string>? RuntimeModels = null, ModelChoice? Choice = null, bool StartsRuntime = false,
    string? ProjectId = null, bool Pinned = false, bool Archived = false)
{
    public string ConversationId(string at, ChatThread? from = null) => (from ?? Thread).Lineage(at).LastOrDefault(node => Forks?.Contains(node.Id) == true)?.Id ?? Id;
    public JsonObject ToJson()
    {
        var json = new JsonObject { ["id"] = Id, ["title"] = Title, ["updated"] = Updated, ["thread"] = Thread.ToJson() };
        if (Forks is { Count: > 0 }) json["forks"] = new JsonArray([.. Forks.Select(id => (JsonNode)JsonValue.Create(id)!)]);
        if (RuntimeModels is { Count: > 0 }) json["runtimeModels"] = new JsonArray([.. RuntimeModels.Select(id => (JsonNode)JsonValue.Create(id)!)]);
        if (Choice is not null) json["modelChoice"] = Choice.ToJson();
        if (StartsRuntime) json["startsRuntime"] = true;
        if (ProjectId is not null) json["projectId"] = ProjectId;
        if (Pinned) json["pinned"] = true;
        if (Archived) json["archived"] = true;
        return json;
    }
    public static SavedChat Of(JsonObject json) => new((string)json["id"]!, json["title"]?.GetValue<string>() ?? "",
        (long)json["updated"]!, ChatThread.Of(json["thread"]!.AsObject()), json["forks"]?.AsArray().Select(id => (string)id!).ToList(),
        json["runtimeModels"]?.AsArray().Select(id => (string)id!).Distinct().ToList(), ModelChoice.Of(json["modelChoice"]), (bool?)json["startsRuntime"] == true,
        (string?)json["projectId"], (bool?)json["pinned"] == true, (bool?)json["archived"] == true);

    internal JsonObject ToProjectJson(JsonArray proposals)
    {
        var document = ToJson();
        document.Remove("modelChoice"); document.Remove("startsRuntime"); document.Remove("projectId");
        if (Choice is { } selected) document["model"] = new JsonObject { ["provider"] = selected.ProviderId, ["model"] = selected.ModelId };
        if (StartsRuntime) document["resetRuntime"] = true;
        document["proposals"] = proposals;
        return document;
    }

    internal static SavedChat OfProject(JsonObject json, string project)
    {
        ModelChoice? choice = null;
        if (json["model"] is JsonObject selected)
        {
            if ((string?)selected["provider"] is not { Length: > 0 } provider || (string?)selected["model"] is not { Length: > 0 } model)
                throw new IOException("对话里的模型设置格式有误，原文件已保留。");
            choice = new(provider, model);
        }
        var chat = Of(json);
        var seen = new HashSet<string>(StringComparer.Ordinal) { ChatThread.Start };
        foreach (var node in chat.Thread.Nodes)
            if (!seen.Contains(node.Parent) || !seen.Add(node.Id) || (string?)node.Message["role"] is not ("user" or "assistant" or "tool"))
                throw new IOException("对话里的消息关系格式有误，原文件已保留。");
        return chat with { ProjectId = project, Choice = choice, StartsRuntime = (bool?)json["resetRuntime"] == true };
    }
}

public static class Chats
{
    /** What a conversation is called: the name given it, else its first question, cut to a line. */
    public static string TitleOf(string title, ChatThread thread)
    {
        if (title.Trim().Length > 0) return title.Trim();
        var first = thread.Path().FirstOrDefault(n => (string?)n.Message["role"] == "user")?.Message["content"] is JsonValue v && v.TryGetValue<string>(out var s) ? s : "";
        var line = System.Text.RegularExpressions.Regex.Replace(first, @"\s+", " ").Trim();
        return line.Length > 28 ? line[..28] + "…" : line.Length > 0 ? line : "新对话";
    }

    /** The conversations newest first, in groups: 今天, 昨天, 前 7 天, 前 30 天, then by month. */
    public static List<(string Name, List<SavedChat> Chats)> Groups(List<SavedChat> chats, long now, TimeZoneInfo? zone = null)
    {
        zone ??= TimeZoneInfo.Local;
        DateOnly DayOf(long ms) => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.FromUnixTimeMilliseconds(ms), zone).DateTime);
        var today = DayOf(now);
        var groups = new List<(string, List<SavedChat>)>();
        foreach (var chat in chats.OrderByDescending(c => c.Pinned).ThenByDescending(c => c.Updated))
        {
            var day = DayOf(chat.Updated); var days = today.DayNumber - day.DayNumber;
            var name = days <= 0 ? "今天" : days == 1 ? "昨天" : days <= 7 ? "前 7 天" : days <= 30 ? "前 30 天" : $"{day.Year}年{day.Month}月";
            var at = groups.FindIndex(g => g.Item1 == name);
            if (at >= 0) groups[at].Item2.Add(chat); else groups.Add((name, [chat]));
        }
        return groups;
    }
}

/** What the AI keeps in mind about the person asking: plain lines kept on this device. */
public static class Memory
{
    public const int Limit = 4000;
    private static string Plain(string line) => System.Text.RegularExpressions.Regex.Replace(System.Text.RegularExpressions.Regex.Replace(line, @"^[-*•]\s*", ""), "[ \\t\\n\\r　，。,.！!？?；;：:“”\"']", "").ToLowerInvariant();
    /** The memory with one more thing in it, as a line of its own; the same thing again changes nothing. */
    public static string Remembered(string text, string fact)
    {
        var said = System.Text.RegularExpressions.Regex.Replace(fact, "[ \\t\\n\\r　]+", " ").Trim();
        if (said.Length == 0) throw new ArgumentException("要记住的话是空的。");
        var lines = text.Split('\n').Select(l => l.TrimEnd()).Where(l => l.Length > 0).ToList();
        if (lines.Any(l => Plain(l) == Plain(said))) return string.Join("\n", lines);
        var next = string.Join("\n", lines.Append($"- {said}"));
        if (next.Length > Limit) throw new ArgumentException("记忆已经满了，请对方在“记忆”里删掉一些再记。");
        return next;
    }
}
