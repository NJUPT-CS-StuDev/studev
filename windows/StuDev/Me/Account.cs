// One's StuDev account on this device, as Android's AccountClient.kt: signing in with student number and password,
// the session's tokens kept encrypted, renewed once when they run out and never replayed after an uncertain renewal,
// and the platform's event streams (the free AI quota) asked as the one signed in.
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using StuDev.Data;

namespace StuDev.Me;

public sealed record AccountUser(string Id, string Nickname, string StudentId = "", bool TotpEnabled = false, string RealName = "", string Qq = "", string Role = "user", int Revision = 0,
    string Department = "", string Title = "", string Signature = "", string Email = "", string Status = "active", bool ProfileComplete = true)
{
    public string RoleName => Role switch { "owner" => "所有者", "admin" => "管理员", _ => "用户" };
    /** The one letter shown when there is no picture. */
    public string Letter => (Nickname.Length > 0 ? Nickname : RealName.Length > 0 ? RealName : "我")[..1];
}
public sealed record AccountSession(string AccessToken, string RefreshToken, long ExpiresAt, string DeviceSessionId, AccountUser User);
public sealed record StoredAccount(string DeviceId, AccountSession? Session);
public sealed class PlatformFailure(int status, string code, string message) : Exception(message) { public int Status => status; public string Code => code; }

public sealed class Account
{
    public static Account Shared { get; } = new();
    private const string File = "account.bin";
    private static readonly HttpClient Http = new() { Timeout = Timeout.InfiniteTimeSpan };
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly SemaphoreSlim gate = new(1, 1);
    public event Action? Changed;
    public AccountUser? User => Stored().Session?.User;

    private static StoredAccount Stored() => Secure.Read(File) is { } text ? JsonSerializer.Deserialize<StoredAccount>(text, Json)! : new(Guid.NewGuid().ToString(), null);
    private void Keep(StoredAccount stored) { Secure.Write(File, JsonSerializer.Serialize(stored, Json)); Changed?.Invoke(); }

    private static async Task<(int Status, JsonObject Body)> Send(string path, JsonObject? body, string? bearer)
    {
        using var request = new HttpRequestMessage(body is null ? HttpMethod.Get : HttpMethod.Post, $"{Repository.Site}/api/platform{path}");
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (bearer is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        if (body is not null) request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        using var cancel = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        using var response = await Http.SendAsync(request, cancel.Token);
        var text = await response.Content.ReadAsStringAsync(cancel.Token);
        try { return ((int)response.StatusCode, JsonNode.Parse(text)!.AsObject()); }
        catch (Exception error) when (error is JsonException or InvalidOperationException or NullReferenceException) { throw new PlatformFailure((int)response.StatusCode, "INVALID_RESPONSE", "服务暂时无法响应，请稍后重试。"); }
    }

    private static JsonObject Checked((int Status, JsonObject Body) reply)
    {
        if (reply.Status is >= 200 and < 300) return reply.Body;
        var error = reply.Body["error"];
        throw new PlatformFailure(reply.Status, (string?)error?["code"] ?? "REQUEST_FAILED", (string?)error?["message"] ?? "操作未完成，请稍后重试。");
    }

    private static AccountSession Tokens(JsonObject value, AccountUser user) => new((string)value["accessToken"]!, (string)value["refreshToken"]!,
        DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + (long)value["expiresIn"]! * 1000, (string)value["deviceSessionId"]!, user);

    public async Task<AccountUser> SignIn(string studentId, string password, string totp)
    {
        await gate.WaitAsync();
        try
        {
            var stored = Stored();
            var body = new JsonObject { ["studentId"] = studentId.Trim(), ["password"] = password, ["deviceId"] = stored.DeviceId, ["deviceName"] = $"Windows · {Environment.MachineName}"[..Math.Min(80, $"Windows · {Environment.MachineName}".Length)] };
            if (totp.Trim().Length > 0) body["totp"] = totp.Trim();
            var value = Checked(await Send("/auth/login", body, null));
            var user = value["user"].Deserialize<AccountUser>(Json)!;
            Keep(stored with { Session = Tokens(value, user) });
            return user;
        }
        finally { gate.Release(); }
    }

    private async Task<AccountSession> Access(AccountSession? forceFor = null)
    {
        await gate.WaitAsync();
        try
        {
            var stored = Stored();
            var session = stored.Session ?? throw new PlatformFailure(401, "AUTH_REQUIRED", "请先登录。");
            if (forceFor is not null && session.DeviceSessionId != forceFor.DeviceSessionId) throw new PlatformFailure(401, "ACCOUNT_CHANGED", "登录账号已更改，请重新操作。");
            if (session.ExpiresAt > DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 30_000 && (forceFor is null || session.AccessToken != forceFor.AccessToken)) return session;
            // A refresh is never retried after an uncertain result: the spent ticket is forgotten before it is sent.
            Keep(stored with { Session = null });
            var value = Checked(await Send("/auth/refresh", new JsonObject { ["refreshToken"] = session.RefreshToken, ["deviceId"] = stored.DeviceId }, null));
            var fresh = Tokens(value, session.User);
            Keep(stored with { Session = fresh });
            return fresh;
        }
        finally { gate.Release(); }
    }

    public async Task<JsonObject> Request(string path, JsonObject? body = null)
    {
        var credential = await Access();
        var reply = await Send(path, body, credential.AccessToken);
        if (reply.Status == 401) reply = await Send(path, body, (await Access(credential)).AccessToken);
        return Checked(reply);
    }

    /** The account as the platform now has it, kept. */
    public async Task Refresh()
    {
        var value = await Request("/auth/session");
        var user = value["user"].Deserialize<AccountUser>(Json)!;
        await gate.WaitAsync();
        try { var stored = Stored(); if (stored.Session?.User.Id == user.Id) Keep(stored with { Session = stored.Session with { User = user } }); }
        finally { gate.Release(); }
    }

    /** An event stream for someone signed in, renewing the pass once if it ran out before the stream began. */
    public async Task Stream(string path, JsonObject body, Action<string, JsonObject> onEvent, CancellationToken cancel)
    {
        var credential = await Access();
        var refused = await StreamOnce(path, body, credential.AccessToken, onEvent, cancel);
        if (refused?.Status == 401) refused = await StreamOnce(path, body, (await Access(credential)).AccessToken, onEvent, cancel);
        if (refused is { } r) Checked(r);
    }

    private static async Task<(int Status, JsonObject Body)?> StreamOnce(string path, JsonObject body, string bearer, Action<string, JsonObject> onEvent, CancellationToken cancel)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{Repository.Site}/api/platform{path}") { Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json") };
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancel);
        if (!response.IsSuccessStatusCode)
        {
            var text = await response.Content.ReadAsStringAsync(cancel);
            try { return ((int)response.StatusCode, JsonNode.Parse(text)!.AsObject()); } catch (Exception e) when (e is JsonException or InvalidOperationException or NullReferenceException) { return ((int)response.StatusCode, new JsonObject()); }
        }
        using var reader = new StreamReader(await response.Content.ReadAsStreamAsync(cancel), Encoding.UTF8);
        string? @event = null;
        while (await reader.ReadLineAsync(cancel) is { } line)
        {
            if (line.StartsWith("event: ")) @event = line["event: ".Length..];
            else if (line.StartsWith("data: ") && @event is not null) onEvent(@event, JsonNode.Parse(line["data: ".Length..])!.AsObject());
            else if (line.Length == 0) @event = null;
        }
        return null;
    }

    public async Task SignOut()
    {
        var credential = await Access();
        var reply = await Send("/auth/logout", new JsonObject(), credential.AccessToken);
        if (reply.Status == 401) reply = await Send("/auth/logout", new JsonObject(), (await Access(credential)).AccessToken);
        Checked(reply);
        await gate.WaitAsync();
        try { var stored = Stored(); if (stored.Session?.DeviceSessionId == credential.DeviceSessionId) Keep(stored with { Session = null }); }
        finally { gate.Release(); }
    }
    public void Forget() => Keep(Stored() with { Session = null });
}
