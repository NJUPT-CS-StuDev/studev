// StuDev keeping itself current: installed per user by Velopack, it looks for a newer release on the site's download
// store when it starts and every six hours while it stays open (it lives in the tray for days), fetches it quietly and
// says so once in a notification; the next start runs it, or a restart from the notification, 我 or the update sheet.
using Velopack;
using Velopack.Sources;

namespace StuDev.Me;

public static class Updates
{
    public static string Feed => $"{Data.Repository.Site}/download/windows";
    private static readonly UpdateManager Manager = new(new SimpleWebSource(Feed));
    public static string? Ready { get; private set; }
    public static event Action? Changed;
    public static string Version => Manager.CurrentVersion?.ToString() ?? "开发版";
    public static bool Installed => Manager.IsInstalled;

    public enum Outcome { NotInstalled, Latest, Ready, Offline }

    /** Is there a newer release? If so, fetch it now; it is applied when StuDev next starts or restarts for it. */
    public static async Task<Outcome> Check()
    {
        if (!Manager.IsInstalled) return Outcome.NotInstalled;
        try
        {
            if (Manager.UpdatePendingRestart is { } pending) { Found(pending.Version.ToString()); return Outcome.Ready; }
            if (await Manager.CheckForUpdatesAsync() is not { } update) return Outcome.Latest;
            await Manager.DownloadUpdatesAsync(update);
            Found(update.TargetFullRelease.Version.ToString());
            return Outcome.Ready;
        }
        catch (Exception error) when (error is HttpRequestException or IOException or TaskCanceledException or InvalidOperationException) { return Outcome.Offline; }
    }

    private static void Found(string version)
    {
        if (Ready == version) return;
        Ready = version;
        Changed?.Invoke();
    }

    /** While StuDev stays open, look again every six hours. */
    public static void Keep(Microsoft.UI.Dispatching.DispatcherQueue queue)
    {
        var timer = queue.CreateTimer();
        timer.Interval = TimeSpan.FromHours(6);
        timer.Tick += (_, _) => App.Watch(Check());
        timer.Start();
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
