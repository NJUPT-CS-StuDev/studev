using Microsoft.UI.Xaml;

namespace StuDev;

public partial class App : Application
{
    internal static Shell? Window { get; private set; }
    internal static Me.Sync? Syncing { get; private set; }
    private static readonly Dictionary<string, Widgets.DeskWidget> widgets = [];
    private static bool Quitting;

    /** The tray icon and the desktop widgets as the settings in 我 say: each widget made, kept current or closed. */
    private static void Presence()
    {
        var settings = Me.Device.Settings;
        var placed = settings.WidgetsHidden ? [] : Me.Device.Widgets;
        if (settings.Tray || placed.Count > 0 || Me.Device.Background) Tray.Show(); else Tray.Hide();
        foreach (var id in widgets.Keys.Where(id => placed.All(w => w.Id != id)).ToList()) { widgets[id].Close(); widgets.Remove(id); }
        foreach (var widget in placed)
        {
            if (!widgets.TryGetValue(widget.Id, out var shown))
            {
                shown = widget.Kind == "calendar" ? new Widgets.CalendarWidget(widget.Id) : new Widgets.ListWidget(widget.Id);
                // Owned by the desktop, a widget goes when Explorer restarts; it is made again when the taskbar returns.
                var id = widget.Id; shown.Closed += (_, _) => { if (!Quitting) widgets.Remove(id); };
                widgets[widget.Id] = shown;
                shown.ShowWidget();
            }
            else shown.Apply();
        }
    }

    public static void Quit()
    {
        Quitting = true;
        Tray.Hide();
        foreach (var widget in widgets.Values.ToList()) widget.Close();
        Window?.Close();
        Current.Exit();
    }
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
        Window.AppWindow.Closing += (_, e) => { if (Me.Device.Settings.Tray && !Quitting) { e.Cancel = true; Window.AppWindow.Hide(); } };
        Me.Appearance.Apply();
        Window.Open("timetable");
        Syncing = new Me.Sync(World.Campus.Shared, Window.DispatcherQueue);
        Watch(Me.Updates.Check());
        // Started at sign-in, StuDev stays in the tray with its card; otherwise its window opens.
        if (!Me.Device.Background) Window.Activate();
        Tray.Opened += () => Window.DispatcherQueue.TryEnqueue(() => Window.Bring());
        Tray.WidgetsToggled += () => Window.DispatcherQueue.TryEnqueue(() => Me.Device.Set(Me.Device.Settings with { WidgetsHidden = !Me.Device.Settings.WidgetsHidden }));
        Tray.WidgetsAsked += () => Window.DispatcherQueue.TryEnqueue(() => { Window.Bring(); Me.WidgetSheet.Open(); });
        Tray.QuitAsked += () => Window.DispatcherQueue.TryEnqueue(Quit);
        Tray.Restarted += () => Window.DispatcherQueue.TryEnqueue(Presence);
        Tray.WidgetsShown = () => Me.Device.Widgets.Count > 0 && !Me.Device.Settings.WidgetsHidden;
        Me.Device.Changed += Presence;
        Presence();
        Reminders.Start(Window.DispatcherQueue);
    }
}
