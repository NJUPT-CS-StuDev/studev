using Microsoft.UI.Xaml;

namespace StuDev;

public partial class App : Application
{
    internal static Shell? Window { get; private set; }
    internal static Me.Sync? Syncing { get; private set; }
    private static Desk? desk;
    private static bool Quitting;

    /** The tray icon and the desktop card as the settings in 我 say. */
    private static void Presence()
    {
        var settings = Me.Device.Settings;
        if (settings.Tray || settings.Card || Me.Device.Background) Tray.Show(); else Tray.Hide();
        if (settings.Card) { desk ??= new Desk(); desk.OnTop(settings.CardOnTop); desk.ShowCard(); }
        else if (desk is not null) { desk.AppWindow.Hide(); }
    }

    public static void Quit()
    {
        Quitting = true;
        Tray.Hide();
        desk?.Close();
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
        Tray.CardToggled += () => Window.DispatcherQueue.TryEnqueue(() => Me.Device.Set(Me.Device.Settings with { Card = !Me.Device.Settings.Card }));
        Tray.QuitAsked += () => Window.DispatcherQueue.TryEnqueue(Quit);
        Tray.CardShown = () => Me.Device.Settings.Card;
        Me.Device.Changed += Presence;
        Presence();
        Reminders.Start(Window.DispatcherQueue);
    }
}
