using Microsoft.UI.Xaml;
using StuDev.Data;

namespace StuDev.Me;

/** Light, dark, or as the system is: 0 follows the system, 1 is light, 2 is dark. */
internal static class Appearance
{
    private static readonly string File = Storage.PathFor("appearance");
    internal static int Current { get; private set; } = System.IO.File.Exists(File) && int.TryParse(System.IO.File.ReadAllText(File), out var value) && value is >= 0 and <= 2 ? value : 0;
    internal static void Apply() => App.Window?.Apply(Current == 1 ? ElementTheme.Light : Current == 2 ? ElementTheme.Dark : ElementTheme.Default);
    internal static void Set(int value) { if (value is < 0 or > 2) return; Storage.Write(File, value.ToString()); Current = value; Apply(); }
}
