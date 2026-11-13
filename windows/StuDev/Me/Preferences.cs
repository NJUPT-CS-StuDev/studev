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
    public T? Get<T>(string section) => value[section] is { } node ? node.Deserialize<T>(Data.Storage.Json) : default;
    public JsonObject Snapshot() => (JsonObject)value.DeepClone();
    public void Set<T>(string section, T? next) => Change(section, JsonSerializer.SerializeToNode(next, Data.Storage.Json));
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
