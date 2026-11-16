// The product as product.json says it, read once: what is a choice of ours rather than a fact of the campus, such as
// which campus is shown first and where its map opens. Facts (where the campus is) come from the data release.
using System.Text.Json;

namespace StuDev;

public static class Product
{
    public static JsonElement Root { get; } = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "product.json"))).RootElement;
    public static string Version { get; } = Root.GetProperty("android").GetProperty("versionName").GetString()!;
    /** The campus shown when one has chosen none. */
    public static string Campus { get; } = Root.GetProperty("campus").GetProperty("id").GetString()!;
    /** The place the campus map opens over. */
    public static string Opens { get; } = Root.GetProperty("campus").GetProperty("opens").GetString()!;
}
