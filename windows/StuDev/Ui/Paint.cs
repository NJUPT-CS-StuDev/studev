// The design language every client shares, design/tokens.json, as live brushes: one brush per token, whose colour is
// switched when the theme turns, so everything painted with it follows without being rebuilt. The web's CSS variables
// and Android's colour scheme are the same idea on their platforms.
using System.Text.Json;
using Microsoft.UI.Xaml.Media;
using Windows.UI;

namespace StuDev.Ui;

public static class Paint
{
    private static readonly JsonElement Root = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "design", "tokens.json"))).RootElement;
    private static readonly Dictionary<string, SolidColorBrush> Named = new();
    private static readonly Dictionary<string, SolidColorBrush> Mixed = new();
    private static readonly Dictionary<string, Func<bool, Color>> Mixes = new();
    public static bool Dark { get; private set; }
    public static event Action? Turned;

    public static int ToneCount { get; } = Root.GetProperty("course").GetProperty("light").EnumerateObject().Count();
    public static Color Of(string name, bool dark) => Parse(Root.GetProperty("color").GetProperty(dark ? "dark" : "light").GetProperty(name).GetString()!);
    public static Color Scene(string name, bool night) => Parse(Root.GetProperty("scene").GetProperty(night ? "night" : "day").GetProperty(name).GetString()!);
    public static Color ToneOf(int tone, string part, bool dark) =>
        Parse(Root.GetProperty("course").GetProperty(dark ? "dark" : "light").GetProperty($"tone{tone % ToneCount}").GetProperty(part).GetString()!);
    public static double Number(params string[] path) { var at = Root; foreach (var key in path) at = at.GetProperty(key); return at.GetDouble(); }

    /** The brush of one colour token: ink, muted, faint, paper, surface, line, brand, now, free, exam … */
    public static SolidColorBrush Brush(string name)
    {
        if (!Named.TryGetValue(name, out var brush)) Named[name] = brush = new SolidColorBrush(Of(name, Dark));
        return brush;
    }
    /** A colour made from tokens, as the web's color-mix: kept, and remade when the theme turns. */
    public static SolidColorBrush Mix(string key, Func<bool, Color> make)
    {
        if (!Mixed.TryGetValue(key, out var brush)) { Mixes[key] = make; Mixed[key] = brush = new SolidColorBrush(make(Dark)); }
        return brush;
    }
    public static SolidColorBrush Tone(int tone, string part) => Mix($"tone{tone % ToneCount}.{part}", dark => ToneOf(tone, part, dark));
    /** A course tone faded towards the paper, as a lesson already over. */
    public static SolidColorBrush ToneFaded(int tone, string part, double keep) => Mix($"tone{tone % ToneCount}.{part}@{keep}", dark => Blend(ToneOf(tone, part, dark), Of("paper", dark), keep));
    /** One token faded towards the paper: color-mix(in srgb, token keep%, paper). */
    public static SolidColorBrush Faded(string name, double keep) => Mix($"{name}@{keep}", dark => Blend(Of(name, dark), Of("paper", dark), keep));
    public static SolidColorBrush Clear { get; } = new(Color.FromArgb(0, 0, 0, 0));

    public static void Turn(bool dark)
    {
        if (dark == Dark && Named.Count > 0) return;
        Dark = dark;
        foreach (var (name, brush) in Named) brush.Color = Of(name, dark);
        foreach (var (key, brush) in Mixed) brush.Color = Mixes[key](dark);
        Turned?.Invoke();
    }

    public static Color Blend(Color a, Color b, double keep) => Color.FromArgb(
        (byte)Math.Round(a.A * keep + b.A * (1 - keep)), (byte)Math.Round(a.R * keep + b.R * (1 - keep)),
        (byte)Math.Round(a.G * keep + b.G * (1 - keep)), (byte)Math.Round(a.B * keep + b.B * (1 - keep)));
    public static Color Alpha(Color c, double alpha) => Color.FromArgb((byte)Math.Round(255 * alpha), c.R, c.G, c.B);
    public static Color Parse(string hex)
    {
        var h = hex.TrimStart('#');
        byte at(int i) => Convert.ToByte(h.Substring(i, 2), 16);
        return h.Length == 8 ? Color.FromArgb(at(6), at(0), at(2), at(4)) : Color.FromArgb(255, at(0), at(2), at(4));
    }
}
