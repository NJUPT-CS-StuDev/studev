using System.Text.Json;

namespace StuDev.Data;

/**
 * Where this device keeps things. One's own records (settings, tasks, conversations, account) live in the roaming
 * application data, apart from the app's folder, so moving, updating or deleting the app never touches them; what can
 * be fetched again (the campus data, map tiles) is cache, in local application data. A process may choose one home
 * for both, as a separate instance or an isolated check does.
 */
public static class Storage
{
    private static readonly string? Chosen = Environment.GetEnvironmentVariable("STUDEV_DATA_DIR");
    public static string Root { get; } = Path.GetFullPath(Chosen ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "StuDev"));
    public static string Cache { get; } = Path.GetFullPath(Chosen is not null ? Path.Combine(Chosen, "cache") : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StuDev", "Cache"));
    public static string CacheFor(string name) => Path.Combine(Cache, name);
    public static JsonSerializerOptions Json => StorageJson.Default.Options;

    public static string PathFor(string name) => Path.Combine(Root, name);
    /** A record kept under its name, or null when there is none yet. */
    public static string? Read(string name) => File.Exists(PathFor(name)) ? File.ReadAllText(PathFor(name)) : null;

    /** A write replaces its predecessor only after the complete new record is on disk. */
    public static void Write(string path, string value)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var pending = path + "." + Guid.NewGuid().ToString("N") + ".pending";
        try { File.WriteAllText(pending, value, new System.Text.UTF8Encoding(false)); File.Move(pending, path, true); }
        finally { if (File.Exists(pending)) File.Delete(pending); }
    }
}
