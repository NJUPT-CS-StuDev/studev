using System.Text.Json;
using System.Text.Json.Nodes;
using StuDev.Data;
using StuDev.Me;

/** The production account client, with the same request/response boundary as the platform. */
internal static class AccountTest
{
    private const long Now = 1_700_000_000_000;
    private const string Family = "11111111-1111-4111-8111-111111111111";
    private const string OtherFamily = "22222222-2222-4222-8222-222222222222";
    private static readonly AccountUser User = new("user-a", "同学", "B240000", Qq: "123456789", Revision: 1);
    private static StoredAccount Stored(AccountUser? user = null, long expiresAt = Now + 600_000) => new("test-device", new("access-a", "refresh-a", expiresAt, Family, user ?? User));
    private static JsonObject UserBody(AccountUser user) => new() { ["user"] = JsonSerializer.SerializeToNode(user, StorageJson.Default.AccountUser) };
    private static JsonObject Credentials(string family = Family) => new() { ["accessToken"] = "access-b", ["refreshToken"] = "refresh-b", ["expiresIn"] = 600L, ["deviceSessionId"] = family };
    private static JsonObject Failure(string code) => new() { ["error"] = new JsonObject { ["code"] = code, ["message"] = "操作未完成。" } };
    private static Task<(int Status, JsonObject Body)> Ok(JsonObject body) => Task.FromResult((200, body));
    private static async Task<string> Code(Func<Task> action)
    {
        try { await action(); return "NO_ERROR"; }
        catch (PlatformFailure failure) { return failure.Code; }
    }

    public static async Task Check(Action<string, object?, JsonNode?> equal)
    {
        void Same(string label, object? actual, object? expected) => equal("account " + label, actual, JsonSerializer.SerializeToNode(expected, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
        {
            StoredAccount? saved = null; var calls = new List<string>();
            var account = new Account(new("test-device", null), value => saved = value, (path, body, bearer) =>
            {
                calls.Add(path);
                var reply = Credentials(); reply["user"] = JsonSerializer.SerializeToNode(User, StorageJson.Default.AccountUser);
                reply["enrollmentRequired"] = true; reply["passwordChangeRequired"] = true; reply["profileRequired"] = true; reply["mfaRequired"] = true;
                return Ok(reply);
            }, () => Now);
            await account.SignIn(" B240000 ", "test-password", "123456");
            Same("login retains full user", account.User?.Qq, User.Qq);
            Same("login retains setup flags", new[] { account.CachedState!.EnrollmentRequired, account.CachedState.PasswordChangeRequired, account.CachedState.ProfileRequired, account.CachedState.MfaRequired }, new[] { true, true, true, true });
            Same("login requires one response", calls, new[] { "/auth/login" });
            var roundtrip = JsonSerializer.Deserialize(JsonSerializer.Serialize(saved, StorageJson.Default.StoredAccount), StorageJson.Default.StoredAccount)!;
            Same("encrypted shape keeps setup state", roundtrip.Session?.State, account.CachedState);
        }
        foreach (var code in new[] { "PASSWORD_INVALID", "MFA_INVALID", "MFA_REPLAYED" })
        {
            var calls = new List<string>();
            var account = new Account(Stored(), _ => { }, (path, body, bearer) => { calls.Add(path); return Task.FromResult((401, Failure(code))); }, () => Now);
            Same($"{code} is preserved", await Code(() => account.ChangePassword("wrong-password", "new-test-password", "123456")), code);
            Same($"{code} is not retried or refreshed", calls, new[] { "/auth/password" });
            Same($"{code} retains login", account.User?.Id, User.Id);
        }
        foreach (var code in new[] { "TOKEN_INVALID", "AUTH_REQUIRED" })
        {
            var calls = new List<string>();
            var account = new Account(Stored(), _ => { }, (path, body, bearer) =>
            {
                calls.Add(path);
                return path == "/auth/refresh" ? Ok(Credentials()) : bearer == "access-a" ? Task.FromResult((401, Failure(code))) : Ok(new());
            }, () => Now);
            await account.Request("/auth/devices");
            Same($"{code} refreshes once", calls, new[] { "/auth/devices", "/auth/refresh", "/auth/devices" });
        }
        {
            var refreshing = 0; var firstRequests = 0;
            var both = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var account = new Account(Stored(), _ => { }, async (path, body, bearer) =>
            {
                if (path == "/auth/refresh") { Interlocked.Increment(ref refreshing); await Task.Yield(); return (200, Credentials()); }
                if (bearer == "access-a")
                {
                    if (Interlocked.Increment(ref firstRequests) == 2) both.SetResult();
                    await both.Task; return (401, Failure("TOKEN_INVALID"));
                }
                return (200, new JsonObject());
            }, () => Now);
            await Task.WhenAll(account.Request("/auth/devices"), account.Request("/auth/session"));
            Same("concurrent expired reads share one refresh", refreshing, 1);
        }
        {
            StoredAccount? saved = null; var refreshes = 0;
            var account = new Account(Stored(expiresAt: Now), value => saved = value, (path, body, bearer) =>
            {
                refreshes++; return Task.FromException<(int, JsonObject)>(new HttpRequestException("Uncertain response"));
            }, () => Now);
            try { await account.Request("/auth/devices"); } catch (HttpRequestException) { }
            Same("uncertain refresh persists spent intent", saved?.Session is null, true);
            Same("uncertain refresh requires sign-in", await Code(() => account.Request("/auth/devices")), "AUTH_REQUIRED");
            Same("uncertain refresh is never replayed", refreshes, 1);
        }
        {
            JsonObject? submitted = null; var requests = 0;
            var updated = User with { Nickname = "新昵称", Signature = "新的签名", Revision = 2 };
            var account = new Account(Stored(), _ => { }, (path, body, bearer) => { requests++; submitted = body; return Ok(UserBody(updated)); }, () => Now);
            await account.SaveProfile(1, User.StudentId, User.RealName, updated.Nickname, updated.Signature);
            Same("saved profile updates cached header immediately", account.User, updated);
            Same("saved profile uses one response", requests, 1);
            Same("profile revision is sent", submitted!["revision"]!.GetValue<int>(), 1);
        }
        {
            var waiting = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var reply = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var updated = User with { Nickname = "更新后的昵称", Revision = 2 };
            var account = new Account(Stored(), _ => { }, async (path, body, bearer) =>
            {
                if (path == "/auth/session") { waiting.SetResult(); await reply.Task; return (200, UserBody(User)); }
                return (200, UserBody(updated));
            }, () => Now);
            var state = account.State(); await waiting.Task;
            await account.SaveProfile(1, User.StudentId, User.RealName, updated.Nickname, "");
            reply.SetResult(); var result = await state;
            Same("late verification cannot undo saved profile", result.User, updated);
            Same("cached profile stays at newest revision", account.User?.Revision, 2);
        }
        {
            var waiting = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var reply = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var account = new Account(Stored(), _ => { }, async (path, body, bearer) =>
            {
                if (path == "/auth/session") { waiting.SetResult(); await reply.Task; return (200, UserBody(User)); }
                var response = Credentials(OtherFamily); response["user"] = JsonSerializer.SerializeToNode(User, StorageJson.Default.AccountUser); return (200, response);
            }, () => Now);
            var stale = account.State(); await waiting.Task;
            await account.SignIn(User.StudentId, "test-password", ""); reply.SetResult();
            Same("late state cannot cross a fresh login of same user", await Code(async () => await stale), "ACCOUNT_CHANGED");
            Same("fresh login survives stale response", account.User?.Id, User.Id);
        }
        {
            var waiting = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var reply = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var account = new Account(new("test-device", null), _ => { }, async (path, body, bearer) =>
            {
                waiting.SetResult(); await reply.Task;
                var response = Credentials(); response["user"] = JsonSerializer.SerializeToNode(User, StorageJson.Default.AccountUser); return (200, response);
            }, () => Now);
            var pending = account.SignIn(User.StudentId, "test-password", ""); await waiting.Task;
            account.Forget(); reply.SetResult();
            Same("forgotten pending login cannot restore session", await Code(async () => await pending), "ACCOUNT_CHANGED");
            Same("forgotten login remains signed out", account.User is null, true);
        }
        foreach (var operation in new[] { "password", "totp" })
        {
            var account = new Account(Stored(), _ => { }, (path, body, bearer) => Ok(new()), () => Now);
            if (operation == "password") await account.ChangePassword("test-password", "new-test-password", "");
            else await account.DisableTotp("test-password", "123456");
            Same($"successful {operation} change clears revoked session", account.User is null, true);
        }
        {
            var calls = new List<string>();
            var account = new Account(Stored(), _ => { }, (path, body, bearer) =>
            {
                calls.Add(path);
                return Ok(path == "/auth/devices" ? new JsonObject { ["items"] = new JsonArray(new JsonObject { ["id"] = Family, ["deviceName"] = "Windows", ["kind"] = "bearer", ["current"] = true, ["createdAt"] = "2026-11-16T00:00:00.000Z", ["expiresAt"] = Now + 600_000 }) } : new());
            }, () => Now);
            var devices = await account.Devices();
            Same("device response preserves current native family", devices[0].Current, true);
            await account.RevokeDevice(OtherFamily);
            Same("revoking another device keeps this session", account.User?.Id, User.Id);
            await account.RevokeDevice(Family);
            Same("revoking current device signs out locally", account.User is null, true);
        }
        {
            var calls = 0;
            var account = new Account(Stored(), _ => { }, (path, body, bearer) => { calls++; return Ok(new() { ["recoveryCodes"] = new JsonArray("TEST-A", "TEST-B") }); }, () => Now);
            var codes = await account.ConfirmTotp("123456");
            Same("TOTP confirmation retains one-time recovery codes", codes, new[] { "TEST-A", "TEST-B" });
            Same("TOTP confirmation updates cached security state", account.User?.TotpEnabled, true);
            Same("TOTP codes need no second network response", calls, 1);
        }
        Same("avatar fallback preserves complete emoji", (User with { Nickname = "😀同学" }).Letter, "😀");
    }
}
