// One's StuDev account on this device, as Android's AccountClient.kt: signing in with student number and password,
// the session's tokens kept encrypted, renewed once when they run out and never replayed after an uncertain renewal,
// and the platform's event streams (the free AI quota) asked as the one signed in.
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using StuDev.Data;

namespace StuDev.Me;

public sealed class PlatformFailure(int status, string code, string message) : Exception(message) { public int Status => status; public string Code => code; }

public sealed record AccountUser(string Id, string Nickname, string StudentId = "", bool TotpEnabled = false, string RealName = "", string Qq = "", string Role = "user", int Revision = 0,
    string Signature = "", string Email = "", string Status = "active", bool ProfileComplete = true, List<AccountMembership>? Memberships = null)
{
    [JsonIgnore] public string RoleName => Role switch { "owner" => "所有者", "admin" => "管理员", _ => "用户" };
    /** The first text element, also for names beginning with a surrogate pair. */
    [JsonIgnore] public string Letter => System.Globalization.StringInfo.GetNextTextElement(Nickname.Length > 0 ? Nickname : "我");
}
public sealed record AccountMembership(string OrganizationName, string Position = "");
public sealed record AccountState(AccountUser User, bool EnrollmentRequired = false, bool PasswordChangeRequired = false, bool ProfileRequired = false, bool MfaRequired = false);
public sealed record AccountDevice(string Id, string DeviceName, string Kind, bool Current, string CreatedAt, long ExpiresAt);
public sealed record AccountSession(string AccessToken, string RefreshToken, long ExpiresAt, string DeviceSessionId, AccountUser User,
    bool EnrollmentRequired = false, bool PasswordChangeRequired = false, bool ProfileRequired = false, bool MfaRequired = false)
{
    [JsonIgnore] public AccountState State => new(User, EnrollmentRequired, PasswordChangeRequired, ProfileRequired, MfaRequired);
}
public sealed record StoredAccount(string DeviceId, AccountSession? Session, Dictionary<string, string>? TrustedDevices = null);

public sealed class Account
{
    private static readonly Lazy<Account> SharedAccount = new(() => new());
    public static Account Shared => SharedAccount.Value;
    private const string File = "account.bin";
    private static readonly HttpClient Http = new() { Timeout = Timeout.InfiniteTimeSpan };
    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly object storageGate = new();
    private readonly Action<StoredAccount> write;
    private readonly Func<string, JsonObject?, string?, Task<(int Status, JsonObject Body)>> send;
    private readonly Func<long> now;
    private StoredAccount stored;
    private AccountState? renewing;
    private int generation;
    private sealed record Pass(AccountSession Session, int Generation);
    public event Action? Changed;
    public AccountUser? User => CachedState?.User;
    public AccountState? CachedState { get { lock (storageGate) return stored.Session?.State ?? renewing; } }

    private Account() : this(
        Secure.Read(File) is { } text ? JsonSerializer.Deserialize(text, StorageJson.Default.StoredAccount)! : new(Guid.NewGuid().ToString(), null),
        value => Secure.Write(File, JsonSerializer.Serialize(value, StorageJson.Default.StoredAccount)), SendHttp) { }

    /** Storage and transport are the same boundaries used by the native client and its account tests. */
    internal Account(StoredAccount initial, Action<StoredAccount> write, Func<string, JsonObject?, string?, Task<(int Status, JsonObject Body)>> send, Func<long>? now = null)
    { stored = initial; this.write = write; this.send = send; this.now = now ?? (() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()); }

    private StoredAccount Stored() { lock (storageGate) return stored; }
    private (StoredAccount Stored, int Generation) Snapshot() { lock (storageGate) return (stored, generation); }
    private static PlatformFailure AccountChanged() => new(401, "ACCOUNT_CHANGED", "登录账号已更改，请重新操作。");
    private void Keep(StoredAccount value, int expectedGeneration)
    {
        lock (storageGate)
        {
            if (generation != expectedGeneration) throw AccountChanged();
            if (stored == value && renewing is null) return;
            if (stored != value) write(value);
            stored = value; renewing = null;
        }
        Changed?.Invoke();
    }

    private async Task EnsureCurrent(Pass pass)
    {
        await gate.WaitAsync();
        try { lock (storageGate) if (generation != pass.Generation || stored.Session?.DeviceSessionId != pass.Session.DeviceSessionId) throw AccountChanged(); }
        finally { gate.Release(); }
    }

    private static async Task<(int Status, JsonObject Body)> SendHttp(string path, JsonObject? body, string? bearer)
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

    private AccountSession Tokens(JsonObject value, AccountState state) => new((string)value["accessToken"]!, (string)value["refreshToken"]!,
        now() + (long)value["expiresIn"]! * 1000, (string)value["deviceSessionId"]!, state.User, state.EnrollmentRequired, state.PasswordChangeRequired, state.ProfileRequired, state.MfaRequired);

    /// <summary>Asks for a password-reset link, mailed to the account's QQ mailbox; the reset itself happens on the website.</summary>
    public static async Task Forgot(string studentId) => Checked(await Shared.send("/auth/password/forgot", new JsonObject { ["studentId"] = studentId.Trim().ToUpperInvariant() }, null));

    public static async Task Register(string studentId, string realName, string nickname, string qq, string password) => Checked(await Shared.send("/auth/register",
        new JsonObject { ["studentId"] = studentId.Trim(), ["realName"] = realName.Trim(), ["nickname"] = nickname.Trim(), ["qq"] = qq.Trim(), ["password"] = password }, null));

    private static StoredAccount WithTrust(StoredAccount value, string studentId, string? token)
    {
        if (value.TrustedDevices?.GetValueOrDefault(studentId) == token) return value;
        var devices = value.TrustedDevices is { } existing ? new Dictionary<string, string>(existing) : [];
        if (token is null) devices.Remove(studentId);
        else devices[studentId] = token;
        return value with { TrustedDevices = devices.Count == 0 ? null : devices };
    }

    public async Task<AccountUser> SignIn(string studentId, string password, string totp, bool trustDevice = false)
    {
        int expectedGeneration;
        lock (storageGate) expectedGeneration = ++generation;
        await gate.WaitAsync();
        try
        {
            var stored = Stored();
            studentId = studentId.Normalize(NormalizationForm.FormKC).Trim().ToUpperInvariant();
            var deviceName = $"Windows · {Environment.MachineName}";
            var body = new JsonObject { ["studentId"] = studentId, ["password"] = password, ["deviceId"] = stored.DeviceId, ["deviceName"] = deviceName[..Math.Min(80, deviceName.Length)] };
            var prior = stored.TrustedDevices?.GetValueOrDefault(studentId);
            if (prior is not null) body["trustedDeviceToken"] = prior;
            if (totp.Trim() is { Length: > 0 } code)
            {
                body["totp"] = code;
                if (trustDevice) body["trustDevice"] = true;
            }
            var reply = await send("/auth/login", body, null);
            if (reply.Status == 401 && (string?)reply.Body["error"]?["code"] == "MFA_REQUIRED" && prior is not null)
                Keep(WithTrust(stored, studentId, null), expectedGeneration);
            var value = Checked(reply);
            var state = value.Deserialize(StorageJson.Default.AccountState)!;
            if ((string?)value["trustedDeviceToken"] is { Length: > 0 } trusted)
                stored = WithTrust(stored, studentId, trusted);
            Keep(stored with { Session = Tokens(value, state) }, expectedGeneration);
            return state.User;
        }
        finally { gate.Release(); }
    }

    private async Task<Pass> Access(Pass? forceFor = null)
    {
        await gate.WaitAsync();
        try
        {
            var (stored, expectedGeneration) = Snapshot();
            var session = stored.Session ?? throw new PlatformFailure(401, "AUTH_REQUIRED", "请先登录。");
            if (forceFor is not null && (expectedGeneration != forceFor.Generation || session.DeviceSessionId != forceFor.Session.DeviceSessionId)) throw AccountChanged();
            if (session.ExpiresAt > now() + 30_000 && (forceFor is null || session.AccessToken != forceFor.Session.AccessToken)) return new(session, expectedGeneration);
            // Persist the spent intent before sending this one-use ticket. Keep
            // only the profile visible while waiting for the replacement.
            var profile = session.State;
            lock (storageGate)
            {
                if (generation != expectedGeneration) throw AccountChanged();
                var cleared = stored with { Session = null };
                write(cleared);
                this.stored = cleared;
                renewing = profile;
            }
            AccountSession fresh;
            try
            {
                var value = Checked(await send("/auth/refresh", new JsonObject { ["refreshToken"] = session.RefreshToken, ["deviceId"] = stored.DeviceId }, null));
                fresh = Tokens(value, profile);
                Keep(stored with { Session = fresh }, expectedGeneration);
            }
            catch
            {
                var changed = false;
                lock (storageGate)
                {
                    if (ReferenceEquals(renewing, profile))
                    {
                        renewing = null;
                        changed = true;
                    }
                }
                if (changed) Changed?.Invoke();
                throw;
            }
            return new(fresh, expectedGeneration);
        }
        finally { gate.Release(); }
    }

    private static bool Expired((int Status, JsonObject Body) reply) => reply.Status == 401 && (string?)reply.Body["error"]?["code"] is "TOKEN_INVALID" or "AUTH_REQUIRED";

    private async Task<(JsonObject Body, Pass Pass)> Authenticated(string path, JsonObject? body)
    {
        var credential = await Access();
        var reply = await send(path, body, credential.Session.AccessToken);
        if (Expired(reply)) { credential = await Access(credential); reply = await send(path, body, credential.Session.AccessToken); }
        await EnsureCurrent(credential);
        return (Checked(reply), credential);
    }

    public async Task<JsonObject> Request(string path, JsonObject? body = null) => (await Authenticated(path, body)).Body;

    /** The account as the platform now has it, kept. */
    public async Task<AccountState> State()
    {
        var (value, pass) = await Authenticated("/auth/session", null);
        var state = value.Deserialize(StorageJson.Default.AccountState)!;
        await gate.WaitAsync();
        try
        {
            var stored = Stored();
            if (stored.Session?.DeviceSessionId != pass.Session.DeviceSessionId) throw AccountChanged();
            // A slower verification must not undo a profile saved by a later request.
            if (stored.Session.User.Revision > state.User.Revision) return stored.Session.State;
            Keep(stored with { Session = stored.Session with { User = state.User, EnrollmentRequired = state.EnrollmentRequired, PasswordChangeRequired = state.PasswordChangeRequired, ProfileRequired = state.ProfileRequired, MfaRequired = state.MfaRequired } }, pass.Generation);
            return state;
        }
        finally { gate.Release(); }
    }

    public async Task Refresh() => await State();

    public async Task<AccountUser> SaveProfile(int revision, string studentId, string realName, string nickname, string signature)
    {
        var (value, pass) = await Authenticated("/auth/profile", new JsonObject { ["revision"] = revision, ["studentId"] = studentId, ["realName"] = realName, ["nickname"] = nickname, ["signature"] = signature });
        var user = value["user"].Deserialize(StorageJson.Default.AccountUser)!;
        await gate.WaitAsync();
        try
        {
            var stored = Stored();
            if (stored.Session?.DeviceSessionId != pass.Session.DeviceSessionId) throw AccountChanged();
            if (stored.Session.User.Revision > user.Revision) return stored.Session.User;
            Keep(stored with { Session = stored.Session with { User = user, ProfileRequired = !user.ProfileComplete } }, pass.Generation);
            return user;
        }
        finally { gate.Release(); }
    }

    public async Task<List<AccountDevice>> Devices() => (await Request("/auth/devices"))["items"].Deserialize(StorageJson.Default.ListAccountDevice)!;

    public async Task<List<AccountDevice>> TrustedDevices() => (await Request("/auth/trusted-devices"))["items"].Deserialize(StorageJson.Default.ListAccountDevice)!;

    public async Task RevokeDevice(string id)
    {
        if (!Guid.TryParseExact(id, "D", out _)) throw new ArgumentException("登录设备无效。", nameof(id));
        var (_, pass) = await Authenticated($"/auth/devices/{id}/revoke", new JsonObject());
        if (id == pass.Session.DeviceSessionId) await Forget(pass);
    }

    public async Task RevokeTrust(AccountDevice device)
    {
        if (!Guid.TryParseExact(device.Id, "D", out _)) throw new ArgumentException("受信任的设备无效。", nameof(device));
        var (_, pass) = await Authenticated($"/auth/trusted-devices/{device.Id}/revoke", new JsonObject());
        if (!device.Current) return;
        await gate.WaitAsync();
        try
        {
            var stored = Stored();
            if (stored.Session?.DeviceSessionId != pass.Session.DeviceSessionId) throw AccountChanged();
            Keep(WithTrust(stored, pass.Session.User.StudentId, null), pass.Generation);
        }
        finally { gate.Release(); }
    }

    public async Task ChangePassword(string currentPassword, string newPassword, string totp)
    {
        var (_, pass) = await Authenticated("/auth/password", new JsonObject { ["currentPassword"] = currentPassword, ["newPassword"] = newPassword, ["totp"] = totp });
        await Forget(pass, forgetTrust: true);
    }

    public async Task<string> SetupTotp(string password) => (string)(await Request("/auth/totp/setup", new JsonObject { ["password"] = password }))["secret"]!;

    public async Task<List<string>> ConfirmTotp(string code)
    {
        var (reply, pass) = await Authenticated("/auth/totp/confirm", new JsonObject { ["code"] = code });
        var recovery = reply["recoveryCodes"].Deserialize(StorageJson.Default.ListString)!;
        await gate.WaitAsync();
        try
        {
            var stored = Stored();
            if (stored.Session?.DeviceSessionId != pass.Session.DeviceSessionId) throw AccountChanged();
            Keep(WithTrust(stored, pass.Session.User.StudentId, null) with { Session = stored.Session with { User = stored.Session.User with { TotpEnabled = true }, EnrollmentRequired = false, MfaRequired = false } }, pass.Generation);
        }
        finally { gate.Release(); }
        return recovery;
    }

    public async Task DisableTotp(string password, string code)
    {
        var (_, pass) = await Authenticated("/auth/totp/disable", new JsonObject { ["password"] = password, ["code"] = code });
        await Forget(pass, forgetTrust: true);
    }

    public async Task RequestDeletion(string password) => await Request("/auth/account/delete", new JsonObject { ["password"] = password });

    /** An event stream for someone signed in, renewing the pass once if it ran out before the stream began. */
    public async Task Stream(string path, JsonObject body, Action<string, JsonObject> onEvent, CancellationToken cancel)
    {
        var credential = await Access();
        var refused = await StreamOnce(path, body, credential.Session.AccessToken, onEvent, cancel);
        if (refused is { } first && Expired(first)) refused = await StreamOnce(path, body, (await Access(credential)).Session.AccessToken, onEvent, cancel);
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
        var (_, credential) = await Authenticated("/auth/logout", new JsonObject());
        await Forget(credential);
    }

    private async Task Forget(Pass pass, bool forgetTrust = false)
    {
        await gate.WaitAsync();
        try
        {
            var stored = Stored();
            if (stored.Session?.DeviceSessionId == pass.Session.DeviceSessionId)
            {
                if (forgetTrust) stored = WithTrust(stored, pass.Session.User.StudentId, null);
                Keep(stored with { Session = null }, pass.Generation);
            }
        }
        finally { gate.Release(); }
    }

    public void Forget()
    {
        lock (storageGate)
        {
            generation++;
            var next = stored with { Session = null };
            if (stored == next && renewing is null) return;
            if (stored != next) write(next);
            stored = next; renewing = null;
        }
        Changed?.Invoke();
    }
}
