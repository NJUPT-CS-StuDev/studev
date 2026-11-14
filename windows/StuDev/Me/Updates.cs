// StuDev keeping itself current: installed per user by Velopack, it looks for a newer release on the site's download
// store once it has started, fetches it quietly, and the next start runs it; 我 says so and can restart at once.
using Velopack;
using Velopack.Sources;

namespace StuDev.Me;

public static class Updates
{
    public const string Feed = $"{Data.Repository.Site}/download/windows";
    private static readonly UpdateManager Manager = new(new SimpleWebSource(Feed));
    public static string? Ready { get; private set; }
    public static event Action? Changed;
    public static string Version => Manager.CurrentVersion?.ToString() ?? "开发版";
    public static bool Installed => Manager.IsInstalled;

    /** After start: is there a newer release? If so, fetch it now; it is applied when StuDev next starts. */
    public static async Task Check()
    {
        if (!Manager.IsInstalled) return;
        try
        {
            if (Manager.UpdatePendingRestart is { } pending) { Ready = pending.Version.ToString(); Changed?.Invoke(); return; }
            if (await Manager.CheckForUpdatesAsync() is not { } update) return;
            await Manager.DownloadUpdatesAsync(update);
            Ready = update.TargetFullRelease.Version.ToString();
            Changed?.Invoke();
        }
        catch (Exception error) when (error is HttpRequestException or IOException or TaskCanceledException or InvalidOperationException) { /* Offline: next start looks again. */ }
    }

    public static void RestartNow()
    {
        if (Manager.UpdatePendingRestart is { } pending) Manager.ApplyUpdatesAndRestart(pending);
    }

    /** The StuDev before this one was a Tauri shell installed in %LOCALAPPDATA%\StuDev; this one replaces it. */
    public static void RetireTauri()
    {
        var old = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StuDev", "uninstall.exe");
        if (!File.Exists(old)) return;
        using var uninstall = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(old, "/S") { UseShellExecute = false, CreateNoWindow = true });
        uninstall?.WaitForExit(20_000);
    }
}
