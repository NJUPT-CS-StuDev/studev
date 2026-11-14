// What this computer does in the background, kept on it alone (not synced): staying in the tray when the window is
// closed, the desktop card and where it sits, starting at sign-in, and reminders before lessons and exams.
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Win32;
using StuDev.Data;

namespace StuDev.Me;

public sealed record DeviceSettings(bool Tray = true, bool Card = false, bool CardOnTop = false, int[]? CardBounds = null, bool Reminders = false, int Lead = 15);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(DeviceSettings))]
[JsonSerializable(typeof(List<string>))]
internal sealed partial class DeviceJson : JsonSerializerContext;

public static class Device
{
    private const string File = "device.json";
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    public static DeviceSettings Settings { get; private set; } = Storage.Read(File) is { } text ? JsonSerializer.Deserialize(text, DeviceJson.Default.DeviceSettings)! : new();
    public static event Action? Changed;

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
