// What this computer does in the background, kept on it alone (not synced): staying in the tray when the window is
// closed, the desktop widgets and where they sit, starting at sign-in, and reminders before lessons and exams.
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Win32;
using StuDev.Data;

namespace StuDev.Me;

public sealed record DeviceSettings(bool Tray = true, bool Reminders = false, int Lead = 15, List<WidgetSettings>? Widgets = null, bool WidgetsHidden = false);

/** One desktop widget: a list or a calendar, the view it shows, where it sits and how it looks. */
public sealed record WidgetSettings(string Id, string Kind, string View, int[]? Bounds = null, bool OnTop = false, bool Locked = false, int Opacity = 88);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(DeviceSettings))]
[JsonSerializable(typeof(WidgetSettings))]
[JsonSerializable(typeof(List<string>))]
internal sealed partial class DeviceJson : JsonSerializerContext;

public static class Device
{
    private const string File = "device.json";
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    public static DeviceSettings Settings { get; private set; } = Storage.Read(File) is { } text ? JsonSerializer.Deserialize(text, DeviceJson.Default.DeviceSettings)! : new();
    public static event Action? Changed;

    public static List<WidgetSettings> Widgets => Settings.Widgets ?? [];
    public static WidgetSettings? Widget(string id) => Widgets.FirstOrDefault(w => w.Id == id);
    public static void PutWidget(WidgetSettings widget) => Set(Settings with { Widgets = [.. Widgets.Select(w => w.Id == widget.Id ? widget : w)] });
    public static void RemoveWidget(string id) => Set(Settings with { Widgets = [.. Widgets.Where(w => w.Id != id)] });
    public static WidgetSettings AddWidget(string kind)
    {
        var widget = new WidgetSettings(Guid.NewGuid().ToString("N")[..8], kind, kind == "calendar" ? "week" : "today");
        Set(Settings with { Widgets = [.. Widgets, widget], WidgetsHidden = false });
        return widget;
    }

    public static void Set(DeviceSettings next)
    {
        Settings = next;
        Storage.Write(Storage.PathFor(File), JsonSerializer.Serialize(next, DeviceJson.Default.DeviceSettings));
        Changed?.Invoke();
    }

    /** The program to start: the launcher beside current\ when StuDev updates itself, so an update keeps sign-in start working. */
    private static string Program
    {
        get
        {
            var exe = Environment.ProcessPath!;
            var folder = Path.GetDirectoryName(exe)!;
            var launcher = Path.Combine(Path.GetDirectoryName(folder) ?? folder, "StuDev.exe");
            return Path.GetFileName(folder).Equals("current", StringComparison.OrdinalIgnoreCase) && System.IO.File.Exists(launcher) ? launcher : exe;
        }
    }

    public static bool StartsAtSignIn
    {
        get => Registry.CurrentUser.OpenSubKey(RunKey)?.GetValue("StuDev") is string;
        set
        {
            using var key = Registry.CurrentUser.CreateSubKey(RunKey);
            if (value) key.SetValue("StuDev", $"\"{Program}\" --background"); else key.DeleteValue("StuDev", false);
            Changed?.Invoke();
        }
    }

    /** Started at sign-in: no window, only the tray, the card and reminders. */
    public static bool Background => Environment.GetCommandLineArgs().Contains("--background");
}
