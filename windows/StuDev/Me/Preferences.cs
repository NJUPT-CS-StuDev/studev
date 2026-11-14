// One's own settings on this device, in the same shape the web keeps them (src/campus/world/preferences.ts), so that
// they sync alike: the class one is in, the campus one is usually on.
using System.Text.Json;
using System.Text.Json.Nodes;

namespace StuDev.Me;

public sealed class Preferences
{
    private static readonly string File = Data.Storage.PathFor("preferences.json");
    private JsonObject value;
    private Preferences(JsonObject value) => this.value = value;
    public static Preferences Load()
    {
        try { return new((JsonNode.Parse(System.IO.File.ReadAllText(File)) as JsonObject) ?? []); }
        catch (Exception e) when (e is FileNotFoundException or DirectoryNotFoundException) { return new([]); }
    }
    public string? Class => value["class"]?.GetValue<string>();
    public string Campus => value["campus"]?.GetValue<string>() ?? "仙林";
    public event Action? Changed;
    public event Action<bool>? Saved;
    public T? Get<T>(string section, System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> shape) => value[section] is { } node ? node.Deserialize(shape) : default;
    public JsonObject Snapshot() => (JsonObject)value.DeepClone();
    public void Set<T>(string section, T next, System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> shape) => Change(section, JsonSerializer.SerializeToNode(next, shape));
    public void Change(string section, JsonNode? next)
    {
        if (JsonNode.DeepEquals(value[section], next)) return;
        var changed = (JsonObject)value.DeepClone();
        if (next is null) changed.Remove(section); else changed[section] = next.DeepClone();
        var modified = changed["modified"] as JsonObject ?? [];
        modified[section] = Stamp();
        changed["modified"] = modified;
        Save(changed);
    }
    public static string Stamp() => DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
    public void SetClass(string klass)
    {
        Change("class", JsonValue.Create(klass));
    }
    public void Adopt(JsonObject next)
    {
        if (JsonNode.DeepEquals(value, next)) return;
        Save((JsonObject)next.DeepClone(), true);
    }
    private void Save(JsonObject next, bool adopt = false)
    {
        Data.Storage.Write(File, next.ToJsonString(Data.Storage.Json));
        value = next;
        Changed?.Invoke();
        Saved?.Invoke(adopt);
    }
}

/** How settings travel between devices, as settingsOf, mergeSettings and settingsTaken on the web: part by part, the later change wins. */
public static class SettingsSync
{
    public static readonly string[] Sections = ["class", "campus", "timetable", "examAttendance", "examReminders", "labs", "layers", "events", "run"];
    private const string Never = "1970-01-01T00:00:00.000Z";

    /** Every part present, with when it last changed; a part kept from before changes were stamped counts as changed never. */
    public static JsonObject PartsOf(JsonObject settings)
    {
        var parts = new JsonObject(); var modified = settings["modified"] as JsonObject;
        foreach (var section in Sections)
        {
            var at = (string?)modified?[section];
            if (settings[section] is null && at is null) continue;
            parts[section] = new JsonObject { ["value"] = settings[section]?.DeepClone(), ["modified"] = at ?? Never };
        }
        return parts;
    }

    /** Two sides' parts merged: each part from whichever side changed it later. */
    public static JsonObject Merge(JsonObject mine, JsonObject theirs)
    {
        var merged = new JsonObject();
        foreach (var section in Sections)
        {
            var left = mine[section] as JsonObject; var right = theirs[section] as JsonObject;
            var kept = left is null ? right : right is null ? left : string.CompareOrdinal((string)right["modified"]!, (string)left["modified"]!) > 0 ? right : left;
            if (kept is not null) merged[section] = kept.DeepClone();
        }
        return merged;
    }

    /** The settings with the parts that changed later elsewhere taken in, or null when none did. */
    public static JsonObject? Taken(JsonObject settings, JsonObject merged)
    {
        JsonObject? next = null;
        var modified = settings["modified"] as JsonObject ?? [];
        foreach (var section in Sections)
        {
            if (merged[section] is not JsonObject part || part["modified"] is not JsonValue stamp || !stamp.TryGetValue<string>(out var at)) continue;
            var mine = (string?)modified[section] ?? "";
            if (string.CompareOrdinal(at, mine) < 0) continue;
            if (at == mine && JsonNode.DeepEquals(part["value"], settings[section])) continue;
            next ??= (JsonObject)settings.DeepClone();
            if (part["value"] is null) next.Remove(section); else next[section] = part["value"]!.DeepClone();
            var stamps = next["modified"] as JsonObject ?? []; stamps[section] = at; next["modified"] = stamps;
        }
        return next;
    }
}

/** One's account as this device keeps it, encrypted (Account.cs): who, and the session's tokens. */
public sealed record AccountUser(string Id, string Nickname, string StudentId = "", bool TotpEnabled = false, string RealName = "", string Qq = "", string Role = "user", int Revision = 0,
    string Department = "", string Title = "", string Signature = "", string Email = "", string Status = "active", bool ProfileComplete = true)
{
    public string RoleName => Role switch { "owner" => "所有者", "admin" => "管理员", _ => "用户" };
    /** The one letter shown when there is no picture. */
    public string Letter => (Nickname.Length > 0 ? Nickname : RealName.Length > 0 ? RealName : "我")[..1];
}
public sealed record AccountSession(string AccessToken, string RefreshToken, long ExpiresAt, string DeviceSessionId, AccountUser User);
public sealed record StoredAccount(string DeviceId, AccountSession? Session);
