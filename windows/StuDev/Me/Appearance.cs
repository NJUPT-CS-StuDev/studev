using Microsoft.UI.Xaml;
using StuDev.Data;

namespace StuDev.Me;

/**
 * Light, dark, or as the system is: 0 follows the system, 1 is light, 2 is dark. One of the parts of oneself
 * (preferences "appearance": "light", "dark" or absent), so it goes with one to one's other devices and a choice made
 * on one of them shows here at once.
 */
internal static class Appearance
{
    private static Preferences Kept => World.Campus.Shared.Preferences;
    internal static int Current => Kept.Get("appearance", StorageJson.Default.String) switch { "light" => 1, "dark" => 2, _ => 0 };
    internal static void Apply() => App.Window?.Apply(Current == 1 ? ElementTheme.Light : Current == 2 ? ElementTheme.Dark : ElementTheme.Default);
    internal static void Set(int value)
    {
        if (value is < 0 or > 2) return;
        Kept.Change("appearance", value == 0 ? null : System.Text.Json.Nodes.JsonValue.Create(value == 1 ? "light" : "dark"));
    }
    /** Shows the appearance whenever it changes, chosen here or taken from another device. */
    internal static void Follow() => Kept.Changed += changed => { if (changed.Contains("appearance")) App.Window?.DispatcherQueue.TryEnqueue(Apply); };
}
