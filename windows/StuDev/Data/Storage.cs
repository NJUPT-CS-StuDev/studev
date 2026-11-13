using System.Text.Json;

namespace StuDev.Data;

/** Device state has one home; a process may choose its home for a portable instance or isolated verification. */
public static class Storage
{
    public static string Root { get; } = Path.GetFullPath(Environment.GetEnvironmentVariable("STUDEV_DATA_DIR")
        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StuDev"));
    public static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

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
