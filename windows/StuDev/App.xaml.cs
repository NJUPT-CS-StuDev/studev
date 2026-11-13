using Microsoft.UI.Xaml;

namespace StuDev;

public partial class App : Application
{
    internal static Shell? Window { get; private set; }
    internal static Me.Sync? Syncing { get; private set; }
    public static void Open(string entry, object? argument = null) => Window?.Open(entry, argument);
    /** A task run without being awaited: if it fails, the failure is written down and ends the app, never swallowed. */
    public static async void Watch(Task task)
    {
        try { await task; }
        catch (Exception error) { Data.Storage.Write(Data.Storage.PathFor("crash.log"), $"{DateTime.Now:O}\n{error}\n"); throw; }
    }
    public App()
    {
        InitializeComponent();
        // A crash is not caught to carry on; it is written down where it can be read, then the app ends.
        UnhandledException += (_, e) => Data.Storage.Write(Data.Storage.PathFor("crash.log"), $"{DateTime.Now:O}\n{e.Exception}\n");
    }
    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        // The tokens' dictionary is merged once the app is running; merged in the constructor, WinUI fails to start.
        Resources.MergedDictionaries.Add(Ui.Theme.Build());
        Window = new Shell();
        Me.Appearance.Apply();
        Window.Open("timetable");
        Syncing = new Me.Sync(World.Campus.Shared, Window.DispatcherQueue);
        Window.Activate();
    }
}
