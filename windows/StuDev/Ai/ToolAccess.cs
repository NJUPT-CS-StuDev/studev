using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using StuDev.Data;

namespace StuDev.Ai;

internal sealed record BrowserCapability(string Name, string Alias, string Title, string Description, JsonObject InputSchema)
{
    public JsonObject Definition() => new()
    {
        ["type"] = "function",
        ["function"] = new JsonObject { ["name"] = Alias, ["description"] = Description, ["parameters"] = InputSchema.DeepClone() },
    };
}

/** Device permissions for campus tools and the dedicated read-only browser grant. */
internal sealed class ToolAccess
{
    private const string File = "ai/tools.bin";
    private const string Origin = "http://127.0.0.1:9317";
    private static readonly Regex Name = new("^[a-z][a-z0-9_.-]*$", RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
    private static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        AllowAutoRedirect = false,
        ConnectTimeout = TimeSpan.FromSeconds(3),
        UseProxy = false,
    }) { Timeout = TimeSpan.FromSeconds(30), MaxResponseContentBufferSize = 2 * 1024 * 1024 };
    public static readonly ToolAccess Shared = new();
    private string mode = "read";
    private string browserKey = "";
    private HashSet<string> disabledCampus = new(StringComparer.Ordinal);
    private HashSet<string> allowedBrowser = new(StringComparer.Ordinal);
    private IReadOnlyList<BrowserCapability> catalogue = [];
    private bool refreshing;
    public event Action? Changed;

    private ToolAccess()
    {
        if (Secure.Read(File) is not { } kept || JsonNode.Parse(kept) is not JsonObject value) return;
        if ((string?)value["mode"] is "review" or "read" or "approved") mode = (string)value["mode"]!;
        browserKey = (string?)value["browserKey"] ?? "";
        disabledCampus = SetOf(value["disabledCampus"]);
        allowedBrowser = SetOf(value["allowedBrowser"]);
    }

    public string Mode => mode;
    public string BrowserKey => browserKey;
    public IReadOnlyList<BrowserCapability> Catalogue => catalogue;
    public IEnumerable<BrowserCapability> BrowserAvailable => catalogue.Where(tool => allowedBrowser.Contains(tool.Name));
    public bool CampusAllowed(string name) => !disabledCampus.Contains(name);
    public bool BrowserAllowed(string name) => allowedBrowser.Contains(name);

    public void SetMode(string value)
    {
        if (value is not ("review" or "read" or "approved") || value == mode) return;
        Save(value, browserKey, disabledCampus, allowedBrowser);
    }
    public void SetCampus(string name, bool enabled)
    {
        var next = new HashSet<string>(disabledCampus, StringComparer.Ordinal);
        if (enabled ? next.Remove(name) : next.Add(name)) Save(mode, browserKey, next, allowedBrowser);
    }
    public void SetBrowser(string name, bool enabled)
    {
        if (enabled && !catalogue.Any(tool => tool.Name == name)) return;
        var next = new HashSet<string>(allowedBrowser, StringComparer.Ordinal);
        if (enabled ? next.Add(name) : next.Remove(name)) Save(mode, browserKey, disabledCampus, next);
    }

    public async Task Connect(string entered, CancellationToken cancel = default)
    {
        var key = entered.Trim();
        if (key.Length == 0) throw new InvalidOperationException("请填写 Local Runtime MCP 的浏览器工具专用密钥。");
        if (key.Length > 512 || key.Any(c => c <= ' ' || c >= '\x7f'))
            throw new InvalidOperationException("浏览器工具专用密钥格式不正确。");
        var found = await Find(key, cancel);
        var optIns = key == browserKey ? allowedBrowser : new HashSet<string>(StringComparer.Ordinal);
        Save(mode, key, disabledCampus, optIns, found);
    }

    public void Disconnect() => Save(mode, "", disabledCampus, new(StringComparer.Ordinal), []);

    public async Task Refresh()
    {
        if (browserKey.Length == 0 || refreshing) return;
        var key = browserKey;
        refreshing = true;
        try
        {
            var next = await Find(key, CancellationToken.None);
            if (browserKey != key) return;
            catalogue = next;
            Changed?.Invoke();
        }
        catch (Exception failure) when (failure is InvalidOperationException or HttpRequestException or IOException or OperationCanceledException or JsonException)
        {
            if (browserKey == key && catalogue.Count > 0) { catalogue = []; Changed?.Invoke(); }
        }
        finally { refreshing = false; }
    }

    public async Task<JsonObject> Invoke(BrowserCapability tool, JsonObject input, CancellationToken cancel)
    {
        if (!BrowserAvailable.Any(available => available.Name == tool.Name && JsonNode.DeepEquals(available.InputSchema, tool.InputSchema)))
            throw new InvalidOperationException("这个浏览器工具已停用或授权有变化。");
        var body = new JsonObject { ["name"] = tool.Name, ["input"] = input.DeepClone() };
        var result = await Request(HttpMethod.Post, "/capabilities/invoke", browserKey, body, cancel);
        return result as JsonObject ?? throw new InvalidOperationException("浏览器工具未返回可读结果。");
    }

    private static async Task<IReadOnlyList<BrowserCapability>> Find(string key, CancellationToken cancel)
    {
        if (await Request(HttpMethod.Get, "/capabilities", key, null, cancel) is not JsonArray rows)
            throw new InvalidOperationException("无法读取浏览器工具列表。");
        var byName = new Dictionary<string, BrowserCapability>(StringComparer.Ordinal);
        foreach (var row in rows.OfType<JsonObject>())
        {
            if ((bool?)row["annotations"]?["readOnlyHint"] != true || (string?)row["name"] is not { Length: > 0 and <= 60 } name ||
                !Name.IsMatch(name) || row["inputSchema"] is not JsonObject schema || (string?)schema["type"] != "object") continue;
            var alias = "web_" + name.Replace("_", "__").Replace(".", "_d");
            if (alias.Length > 64) continue;
            var title = (string?)row["title"];
            var description = (string?)row["description"];
            byName.TryAdd(name, new(name, alias, string.IsNullOrWhiteSpace(title) ? "浏览器工具" : title,
                string.IsNullOrWhiteSpace(description) ? title ?? "读取已授权页面。" : description, schema));
        }
        return [.. byName.Values];
    }

    private static async Task<JsonNode?> Request(HttpMethod method, string path, string key, JsonObject? value, CancellationToken cancel)
    {
        using var request = new HttpRequestMessage(method, Origin + path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (value is not null) request.Content = new StringContent(value.ToJsonString(), Encoding.UTF8, "application/json");
        try
        {
            using var response = await Http.SendAsync(request, cancel);
            var text = await response.Content.ReadAsStringAsync(cancel);
            var json = JsonNode.Parse(text);
            if (response.IsSuccessStatusCode) return json;
            var code = (json as JsonObject)?["error"]?["code"]?.GetValue<string>();
            throw new InvalidOperationException(code switch
            {
                "unauthorized" => "浏览器工具专用密钥无效，请核对 Local Runtime MCP 设置。",
                "capability_not_granted" => "Local Runtime MCP 已撤回这个工具的授权。",
                "browser_unavailable" or "target_unavailable" => "请打开并连接已授权的浏览器页面。",
                "browser_ambiguous" or "target_ambiguous" => "有多个匹配的页面，请在 Local Runtime MCP 中选定目标。",
                "capability_timeout" => "浏览器工具等待超时，请重试。",
                "invalid_input" => "浏览器工具的参数不完整或无效。",
                _ => "浏览器工具暂时不可用。",
            });
        }
        catch (HttpRequestException) { throw new InvalidOperationException("连不上本机的浏览器工具，请检查 Local Runtime MCP 连接。"); }
        catch (OperationCanceledException) when (!cancel.IsCancellationRequested) { throw new InvalidOperationException("浏览器工具等待超时，请重试。"); }
    }

    private static HashSet<string> SetOf(JsonNode? node) => node is JsonArray a
        ? a.Select(value => (string)value!).ToHashSet(StringComparer.Ordinal) : new(StringComparer.Ordinal);

    private void Save(string nextMode, string key, HashSet<string> campus, HashSet<string> browser, IReadOnlyList<BrowserCapability>? found = null)
    {
        static JsonArray ArrayOf(IEnumerable<string> values) => new([.. values.Order(StringComparer.Ordinal).Select(value => (JsonNode)JsonValue.Create(value)!)]);
        Secure.Write(File, new JsonObject
        {
            ["mode"] = nextMode, ["browserKey"] = key,
            ["disabledCampus"] = ArrayOf(campus), ["allowedBrowser"] = ArrayOf(browser),
        }.ToJsonString());
        mode = nextMode; browserKey = key; disabledCampus = campus; allowedBrowser = browser;
        if (found is not null) catalogue = found;
        Changed?.Invoke();
    }
}
