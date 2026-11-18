using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using StuDev.Data;

namespace StuDev.Ai;

internal sealed record ExternalMcpServer(string Id, string Name, Uri Endpoint, string Token, bool Enabled)
{
    public static ExternalMcpServer Parse(string id, string name, string address, string token, bool enabled)
    {
        name = name.Trim(); address = address.Trim(); token = token.Trim();
        if (name.Length is 0 or > 80) throw new InvalidOperationException("请填写 1 到 80 个字的服务器名称。");
        if (address.Length > 2048 || !Uri.TryCreate(address, UriKind.Absolute, out var url) ||
            url.Scheme != Uri.UriSchemeHttps || url.Host.Length == 0 || url.UserInfo.Length + url.Fragment.Length != 0)
            throw new InvalidOperationException("请填写完整的 HTTPS MCP 地址。");
        if (token.Length > 2048 || token.Any(c => !char.IsAsciiLetterOrDigit(c) && !"-._~+/=".Contains(c)))
            throw new InvalidOperationException("访问令牌的格式不正确。");
        return new(id, name, url, token, enabled);
    }
}

internal sealed record ExternalMcpTool(ExternalMcpServer Server, string Name, string Alias, string Title, string Description, JsonObject InputSchema)
{
    public JsonObject Definition() => new()
    {
        ["type"] = "function",
        ["function"] = new JsonObject { ["name"] = Alias, ["description"] = Description, ["parameters"] = InputSchema.DeepClone() },
    };
}

internal sealed class ExternalMcp
{
    private const string File = "ai/external-mcp.bin";
    internal const int ToolLimit = 16;
    private readonly List<ExternalMcpServer> servers = [];
    private readonly Dictionary<string, IReadOnlyList<ExternalMcpTool>> catalogues = new(StringComparer.Ordinal);
    private bool refreshing;
    public static readonly ExternalMcp Shared = new();
    public IEnumerable<ExternalMcpServer> Servers => servers;
    public IEnumerable<ExternalMcpTool> Available => servers.Where(server => server.Enabled).SelectMany(Catalogue).Take(ToolLimit);
    public event Action? Changed;

    private ExternalMcp()
    {
        if (Secure.Read(File) is not { } kept || JsonNode.Parse(kept) is not JsonArray saved) return;
        foreach (var row in saved.OfType<JsonObject>())
        {
            if ((string?)row["id"] is not { } id || !Guid.TryParseExact(id, "N", out _) || servers.Any(server => server.Id == id)) continue;
            try { servers.Add(ExternalMcpServer.Parse(id, (string)row["name"]!, (string)row["endpoint"]!, (string?)row["token"] ?? "", (bool?)row["enabled"] == true)); }
            catch (InvalidOperationException) { }
        }
    }

    public IReadOnlyList<ExternalMcpTool> Catalogue(ExternalMcpServer server) => catalogues.GetValueOrDefault(server.Id) ?? [];

    public async Task Refresh()
    {
        if (refreshing) return;
        refreshing = true;
        try
        {
            await Task.WhenAll(servers.Where(server => server.Enabled).Select(async server =>
            {
                IReadOnlyList<ExternalMcpTool> found;
                try { found = await ExternalMcpConnection.Discover(server, CancellationToken.None); }
                catch (InvalidOperationException) { found = []; }
                if (servers.Contains(server)) catalogues[server.Id] = found;
            }).ToArray());
            Changed?.Invoke();
        }
        finally { refreshing = false; }
    }

    public void Save(ExternalMcpServer server, IReadOnlyList<ExternalMcpTool> found)
    {
        var next = servers.ToList();
        var at = next.FindIndex(current => current.Id == server.Id);
        if (at < 0)
        {
            if (next.Count >= 16) throw new InvalidOperationException("最多可以添加 16 个外部 MCP 服务器。");
            next.Add(server);
        }
        else next[at] = server;
        Persist(next);
        catalogues[server.Id] = found;
        Changed?.Invoke();
    }

    public void Remove(ExternalMcpServer server)
    {
        Persist(servers.Where(current => current.Id != server.Id).ToList());
        catalogues.Remove(server.Id);
        Changed?.Invoke();
    }

    public async Task<JsonObject> Invoke(ExternalMcpTool tool, JsonObject input, CancellationToken cancel)
    {
        if (!Available.Any(current => current.Alias == tool.Alias && current.Server == tool.Server && JsonNode.DeepEquals(current.InputSchema, tool.InputSchema)))
            throw new InvalidOperationException("这个外部工具已停用或有改动，请重新选择。");
        return await ExternalMcpConnection.Invoke(tool, input, cancel);
    }

    private void Persist(List<ExternalMcpServer> next)
    {
        Secure.Write(File, new JsonArray([.. next.Select(server => (JsonNode)new JsonObject
        {
            ["id"] = server.Id, ["name"] = server.Name, ["endpoint"] = server.Endpoint.AbsoluteUri,
            ["token"] = server.Token, ["enabled"] = server.Enabled,
        })]).ToJsonString());
        servers.Clear();
        servers.AddRange(next);
    }
}

internal sealed class ExternalMcpConnection(ExternalMcpServer server) : IAsyncDisposable
{
    private const string Version = "2025-11-25";
    private const int ResultLimit = 24000;
    private const int ResponseLimit = 1024 * 1024;
    private static readonly Regex ToolName = new("^[A-Za-z0-9_.-]+$", RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
    private static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        AllowAutoRedirect = false, UseCookies = false, ConnectTimeout = TimeSpan.FromSeconds(8),
    }) { Timeout = Timeout.InfiniteTimeSpan };
    private string? sessionId;
    private string protocol = Version;
    private int requestId;

    public static Task<IReadOnlyList<ExternalMcpTool>> Discover(ExternalMcpServer server, CancellationToken cancel) =>
        Run<IReadOnlyList<ExternalMcpTool>>(server, cancel, async (connection, token) =>
        {
            var found = new Dictionary<string, ExternalMcpTool>(StringComparer.Ordinal);
            var seen = new HashSet<string>(StringComparer.Ordinal);
            string? cursor = null;
            for (var page = 0; page < 8; page++)
            {
                var result = await connection.Send("tools/list", cursor is null ? new() : new JsonObject { ["cursor"] = cursor }, token).ConfigureAwait(false);
                if (result?["tools"] is not JsonArray rows) throw new InvalidOperationException("外部 MCP 没有返回工具列表。");
                foreach (var row in rows.OfType<JsonObject>())
                {
                    if (row["annotations"] is not JsonObject annotation || !Flag(annotation["readOnlyHint"]) ||
                        Flag(annotation["destructiveHint"]) || Text(row["name"]) is not { Length: > 0 and <= 64 } name ||
                        !ToolName.IsMatch(name) || row["inputSchema"] is not JsonObject schema || Text(schema["type"]) != "object" ||
                        Encoding.UTF8.GetByteCount(schema.ToJsonString()) > 8000) continue;
                    var alias = "mcp_" + server.Id[..12] + "_" + name.Replace("_", "__").Replace(".", "_d");
                    if (alias.Length > 64) continue;
                    var title = Short(Text(row["title"]) ?? Text(annotation["title"]), 120, name);
                    var description = Short(Text(row["description"]), 600, title);
                    found.TryAdd(alias, new(server, name, alias, title, description, schema));
                    if (found.Count == ExternalMcp.ToolLimit) break;
                }
                cursor = Text(result["nextCursor"]);
                if (found.Count == ExternalMcp.ToolLimit || string.IsNullOrEmpty(cursor) || !seen.Add(cursor)) break;
            }
            return [.. found.Values];
        });

    public static Task<JsonObject> Invoke(ExternalMcpTool tool, JsonObject input, CancellationToken cancel) =>
        Run(tool.Server, cancel, async (connection, token) =>
        {
            if (input.ToJsonString().Length > ResultLimit) throw new InvalidOperationException("外部工具的输入过长。");
            var result = await connection.Send("tools/call", new() { ["name"] = tool.Name, ["arguments"] = input.DeepClone() }, token).ConfigureAwait(false)
                ?? throw new InvalidOperationException("外部 MCP 没有返回工具结果。");
            if (Flag(result["isError"])) return new JsonObject { ["error"] = "外部工具未能完成请求。" };
            var raw = result["structuredContent"]?.ToJsonString() ??
                string.Join("\n", (result["content"] as JsonArray ?? []).OfType<JsonObject>()
                    .Where(item => Text(item["type"]) == "text").Select(item => Text(item["text"])));
            if (tool.Server.Token.Length > 0) raw = raw.Replace(tool.Server.Token, "••••", StringComparison.Ordinal);
            if (raw.Trim().Length == 0) return new JsonObject { ["error"] = "外部工具没有返回文本结果。" };
            return new JsonObject { ["content"] = raw.Length <= ResultLimit ? raw : raw[..ResultLimit] };
        });

    private static async Task<T> Run<T>(ExternalMcpServer server, CancellationToken cancel, Func<ExternalMcpConnection, CancellationToken, Task<T>> operation)
    {
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(cancel);
        limit.CancelAfter(TimeSpan.FromSeconds(30));
        var connection = new ExternalMcpConnection(server);
        await using var session = connection.ConfigureAwait(false);
        try
        {
            var result = await connection.Send("initialize", new()
            {
                ["protocolVersion"] = Version, ["capabilities"] = new JsonObject(),
                ["clientInfo"] = new JsonObject { ["name"] = "StuDev", ["version"] = "1" },
            }, limit.Token).ConfigureAwait(false);
            var supported = Text(result?["protocolVersion"]);
            if (supported is not ("2025-11-25" or "2025-06-18"))
                throw new InvalidOperationException("外部 MCP 的协议版本暂不可用。");
            connection.protocol = supported;
            await connection.Send("notifications/initialized", null, limit.Token).ConfigureAwait(false);
            return await operation(connection, limit.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!cancel.IsCancellationRequested) { throw new InvalidOperationException("外部 MCP 等待超时，请重试。"); }
        catch (HttpRequestException) { throw new InvalidOperationException("连不上外部 MCP，请检查地址和网络。"); }
        catch (Exception failure) when (failure is JsonException or IOException)
        { throw new InvalidOperationException("外部 MCP 没有返回可读的结果。"); }
    }

    private HttpRequestMessage Request(HttpMethod method)
    {
        var request = new HttpRequestMessage(method, server.Endpoint);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        if (server.Token.Length > 0) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", server.Token);
        if (sessionId is not null) request.Headers.Add("Mcp-Session-Id", sessionId);
        request.Headers.Add("MCP-Protocol-Version", protocol);
        return request;
    }

    private async Task<JsonObject?> Send(string method, JsonObject? parameters, CancellationToken cancel)
    {
        using var request = Request(HttpMethod.Post);
        var body = new JsonObject { ["jsonrpc"] = "2.0", ["method"] = method };
        var expectsResult = method != "notifications/initialized";
        var id = ++requestId;
        if (expectsResult) body["id"] = id;
        if (parameters is not null) body["params"] = parameters;
        request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancel).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException(response.StatusCode switch
        {
            HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => "外部 MCP 未授权，请检查访问令牌。",
            HttpStatusCode.NotFound => "找不到这个 MCP 地址。",
            HttpStatusCode.TooManyRequests => "外部 MCP 请求太频繁，请稍后再试。",
            _ => $"外部 MCP 暂时不可用（{(int)response.StatusCode}）。",
        });
        if (method == "initialize" && response.Headers.TryGetValues("Mcp-Session-Id", out var session))
        {
            var value = session.FirstOrDefault();
            if (value is not { Length: > 0 and <= 1024 } || value.Any(c => c < '!' || c > '~'))
                throw new InvalidOperationException("外部 MCP 的会话标识无效。");
            sessionId = value;
        }
        if (!expectsResult) return null;
        JsonObject? envelope;
        switch (response.Content.Headers.ContentType?.MediaType)
        {
            case "application/json":
                await response.Content.LoadIntoBufferAsync(ResponseLimit, cancel).ConfigureAwait(false);
                envelope = JsonNode.Parse(await response.Content.ReadAsStringAsync(cancel).ConfigureAwait(false)) as JsonObject;
                break;
            case "text/event-stream":
                using (var reader = new StreamReader(await response.Content.ReadAsStreamAsync(cancel).ConfigureAwait(false), Encoding.UTF8))
                    envelope = await ReadEvent(reader, id, cancel).ConfigureAwait(false);
                break;
            default: throw new InvalidOperationException("外部 MCP 没有返回 JSON 或事件流。");
        }
        if (!Matches(envelope, id) || envelope?["result"] is not JsonObject result)
            throw new InvalidOperationException("外部 MCP 未能完成请求。");
        return result;
    }

    private static async Task<JsonObject?> ReadEvent(StreamReader reader, int id, CancellationToken cancel)
    {
        var data = new StringBuilder();
        var line = new StringBuilder();
        var buffer = new char[4096];
        var total = 0;
        while (true)
        {
            var size = await reader.ReadAsync(buffer.AsMemory(), cancel).ConfigureAwait(false);
            if (size == 0) return null;
            total += size;
            if (total > ResponseLimit) throw new IOException("MCP response limit exceeded.");
            for (var i = 0; i < size; i++)
            {
                if (buffer[i] == '\r') continue;
                if (buffer[i] != '\n') { line.Append(buffer[i]); continue; }
                if (line.Length == 0 && data.Length != 0)
                {
                    var eventData = data.ToString();
                    if (!string.IsNullOrWhiteSpace(eventData))
                    {
                        var envelope = JsonNode.Parse(eventData) as JsonObject;
                        if (Matches(envelope, id)) return envelope;
                    }
                    data.Clear();
                }
                else if (line.Length != 0 && line.ToString().StartsWith("data:", StringComparison.Ordinal))
                    data.AppendLine(line.ToString(5, line.Length - 5).TrimStart(' '));
                line.Clear();
            }
        }
    }

    private static bool Matches(JsonObject? envelope, int id) => Text(envelope?["jsonrpc"]) == "2.0" &&
        envelope?["id"] is JsonValue value && value.TryGetValue<int>(out var observed) && id == observed;
    private static bool Flag(JsonNode? value) => value is JsonValue literal && literal.TryGetValue<bool>(out var state) && state;
    private static string? Text(JsonNode? value) => value is JsonValue literal && literal.TryGetValue<string>(out var text) ? text : null;
    private static string Short(string? value, int limit, string fallback)
    {
        var words = value?.Trim();
        return string.IsNullOrEmpty(words) ? fallback : words[..Math.Min(words.Length, limit)];
    }

    public async ValueTask DisposeAsync()
    {
        if (sessionId is null) return;
        using var request = Request(HttpMethod.Delete);
        using var cancel = new CancellationTokenSource(TimeSpan.FromSeconds(1));
        try { using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancel.Token).ConfigureAwait(false); }
        catch (Exception failure) when (failure is HttpRequestException or OperationCanceledException) { }
    }
}
