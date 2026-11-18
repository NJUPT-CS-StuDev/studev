using System.Text.Json.Nodes;

namespace StuDev.Ai;

internal sealed record ToolMenuItem(string Name, string Label, bool AllowsEmpty);
internal sealed record PermissionMode(string Id, string Label, string Description);

internal static class ToolMenu
{
    private static readonly Lazy<List<(string Group, Dictionary<string, string> Labels)>> Presentation = new(() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "world", "tool-menu.json")))!.AsArray()
            .Select(group => ((string)group!["label"]!, group["tools"]!.AsObject().ToDictionary(tool => tool.Key, tool => (string)tool.Value!, StringComparer.Ordinal)))
            .ToList());
    private static readonly Lazy<List<PermissionMode>> Permissions = new(() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "world", "permission-modes.json")))!.AsArray()
            .Select(mode => new PermissionMode((string)mode!["id"]!, (string)mode["label"]!, (string)mode["description"]!)).ToList());
    public static IReadOnlyList<PermissionMode> Modes => Permissions.Value;

    public static string? Label(string name)
    {
        foreach (var (_, labels) in Presentation.Value)
            if (labels.TryGetValue(name, out var label)) return label;
        return null;
    }

    public static IEnumerable<(string Group, List<ToolMenuItem> Items)> For(IEnumerable<JsonObject> offered,
        IEnumerable<BrowserCapability>? browser = null)
    {
        var available = offered.ToDictionary(Assistant.ToolName, StringComparer.Ordinal);
        foreach (var (group, labels) in Presentation.Value)
        {
            var items = new List<ToolMenuItem>();
            foreach (var (name, label) in labels)
            {
                if (!available.TryGetValue(name, out var definition)) continue;
                items.Add(new(name, label, definition["function"]!["parameters"]?["required"] is not JsonArray { Count: > 0 }));
            }
            if (items.Count > 0) yield return (group, items);
        }
        var web = browser?.Where(tool => available.ContainsKey(tool.Alias))
            .Select(tool => new ToolMenuItem(tool.Alias, tool.Title, tool.InputSchema["required"] is not JsonArray { Count: > 0 })).ToList();
        if (web is { Count: > 0 }) yield return ("Web MCP", web);
    }
}
