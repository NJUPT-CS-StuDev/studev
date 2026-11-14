// The card on the desktop: what is next, the rest of today and what is due, at a glance without opening StuDev, as the
// Android home-screen widget is. A window of its own with no frame, dragged by its head, kept down on the desktop (or
// on top, if one asks), out of the taskbar; StuDev keeps it up to date from the tray.
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using StuDev.Me;
using StuDev.Ui;
using StuDev.World;
using static StuDev.Native;

namespace StuDev;

public sealed partial class Desk : Window
{
    private readonly Grid root = new();
    private readonly StackPanel body = new() { Spacing = 0 };
    private readonly DispatcherTimer clock = new() { Interval = TimeSpan.FromSeconds(30) };
    private readonly nint hwnd;
    private readonly DispatcherTimer keep = new() { Interval = TimeSpan.FromMilliseconds(600) };

    public Desk()
    {
        Title = "StuDev 桌面卡片";
        hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        var presenter = OverlappedPresenter.Create();
        presenter.SetBorderAndTitleBar(true, false);
        presenter.IsMaximizable = false; presenter.IsMinimizable = false; presenter.IsResizable = true;
        presenter.IsAlwaysOnTop = Device.Settings.CardOnTop;
        AppWindow.SetPresenter(presenter);
        AppWindow.IsShownInSwitchers = false;
        AppWindow.SetIcon(System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "StuDev.ico"));
        var scale = XamlScale();
        var bounds = Device.Settings.CardBounds ?? DefaultBounds(scale);
        AppWindow.MoveAndResize(new Windows.Graphics.RectInt32(bounds[0], bounds[1], bounds[2], bounds[3]));
        root.Background = Paint.Brush("paper");
        root.Children.Add(new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Hidden });
        Content = root;
        Theme();
        Paint.Turned += () => { Theme(); Draw(); };
        Campus.Shared.Changed += () => DispatcherQueue.TryEnqueue(Draw);
        clock.Tick += (_, _) => Draw(); clock.Start();
        AppWindow.Changed += (_, e) => { if (e.DidPositionChange || e.DidSizeChange) { keep.Stop(); keep.Start(); } };
        keep.Tick += (_, _) => { keep.Stop(); var p = AppWindow.Position; var s = AppWindow.Size; Device.Set(Device.Settings with { CardBounds = [p.X, p.Y, s.Width, s.Height] }); };
        // Kept on the desktop: whenever it is let go, it goes back beneath the other windows, unless it is to stay on top.
        Activated += (_, e) => { if (e.WindowActivationState == WindowActivationState.Deactivated && !Device.Settings.CardOnTop) Down(); };
        Draw();
    }

    private double XamlScale() => Dpi(hwnd) / 96.0;
    [System.Runtime.InteropServices.LibraryImport("user32.dll", EntryPoint = "GetDpiForWindow")]
    private static partial uint Dpi(nint window);
    private int[] DefaultBounds(double scale)
    {
        var area = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Primary).WorkArea;
        int w = (int)(320 * scale), h = (int)(400 * scale), m = (int)(24 * scale);
        return [area.X + area.Width - w - m, area.Y + m, w, h];
    }
    private void Theme() => root.RequestedTheme = Appearance.Current == 1 ? ElementTheme.Light : Appearance.Current == 2 ? ElementTheme.Dark : ElementTheme.Default;
    public void Down() => SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    public void OnTop(bool on) { if (AppWindow.Presenter is OverlappedPresenter p) p.IsAlwaysOnTop = on; if (!on) Down(); }
    public void ShowCard() { AppWindow.Show(false); if (!Device.Settings.CardOnTop) Down(); }

    /** Dragged by its head, as a title bar is. */
    private void Drag() { ReleaseCapture(); SendMessageW(hwnd, WM_NCLBUTTONDOWN, HTCAPTION, 0); }

    private void Draw()
    {
        body.Children.Clear();
        var campus = Campus.Shared;
        var now = Moment.Now();
        var head = new Grid { Padding = new Thickness(16, 14, 10, 10), Background = Paint.Clear };
        head.ColumnDefinitions.Add(new ColumnDefinition()); head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var week = campus.Line?.WeekOf(now.Date);
        head.Children.Add(Kit.Column(1, Kit.Text($"{Clock.DateLabel(now.Date)} {Clock.Weekdays[Clock.Weekday(now.Date)]}", Role.Body, bold: true), Kit.Text(week is { } w ? $"第 {w} 周" : "假期", Role.Caption, "muted")));
        var open = new Tap(Paint.Clear, Paint.Brush("surfaceSunken")) { Content = Kit.Icon("M8,4 H16 V12 M16,4 L7,13 M13,16 H4 V7", 14, "muted", 20), Width = 28, Height = 28, CornerRadius = new CornerRadius(6), VerticalAlignment = VerticalAlignment.Top };
        ((FrameworkElement)open.Content).HorizontalAlignment = HorizontalAlignment.Center; ((FrameworkElement)open.Content).VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(open, "打开 StuDev"); ToolTipService.SetToolTip(open, "打开 StuDev");
        open.Click += (_, _) => { App.Window?.Bring(); App.Open("timetable"); };
        Grid.SetColumn(open, 1); head.Children.Add(open);
        head.PointerPressed += (_, e) => { if (e.OriginalSource is not FrameworkElement { Parent: Tap } && e.GetCurrentPoint(head).Properties.IsLeftButtonPressed) Drag(); };
        body.Children.Add(head);
        var content = new StackPanel { Padding = new Thickness(16, 0, 16, 16), Spacing = 0 };
        body.Children.Add(content);
        if (campus.Line is not { } line)
        {
            content.Children.Add(Kit.Text(campus.Preferences.Class is null ? "在 StuDev 里选好班级，这里就会显示课表。" : "正在读取课表…", Role.Label, "muted", wrap: true));
            return;
        }
        // What is next: on now, or how soon.
        if (line.Next(now) is { } next)
        {
            var today = next.Date == now.Date; var during = today && next.Start <= now.Min;
            var said = during ? $"正在上 · 到 {Clock.Hm(next.End)}" : today ? $"下一节 · 还有 {Clock.Duration(next.Start - now.Min)}" : $"下一节 · {Clock.DayWord(next.Date, now.Date)}";
            var tone = CourseTones.ToneOf(next, CourseTones.Of(line), line.CourseMeetings);
            var look = Timetable.Tiles.LookOf(next, tone, false);
            var card = Kit.Column(2, new TextBlock { Text = said, FontSize = 12, Foreground = look.Words, Opacity = .82 },
                new TextBlock { Text = $"{Clock.Hm(next.Start)} {next.Name}", FontSize = 16, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = look.Words, TextTrimming = TextTrimming.CharacterEllipsis },
                new TextBlock { Text = next.Room is not null ? Names.Room(next.Room) : "课表没写地点", FontSize = 12.5, Foreground = look.Words, Opacity = .82 });
            var tile = new Tap(look.Ground, null) { Content = card, Padding = new Thickness(12, 10, 12, 10), CornerRadius = new CornerRadius(10), BorderBrush = look.Edge, BorderThickness = new Thickness(1), Margin = new Thickness(0, 0, 0, 12) };
            AutomationProperties.SetName(tile, next.Name);
            tile.Click += (_, _) => { App.Window?.Bring(); if (Names.Placed(next.Room)) App.Open("map", ("nav", next.Room!)); else App.Open("timetable"); };
            content.Children.Add(tile);
        }
        // The rest of today.
        var rest = line.On(now.Date).Where(e => e.End > now.Min && e.Kind != "run").Skip(line.Next(now)?.Date == now.Date ? 1 : 0).Take(4).ToList();
        if (rest.Count > 0)
        {
            content.Children.Add(Section("今天还有"));
            foreach (var e in rest)
            {
                var row = new Grid { ColumnSpacing = 10, Padding = new Thickness(0, 5, 0, 5) };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(42) }); row.ColumnDefinitions.Add(new ColumnDefinition());
                var t = Kit.Text(Clock.Hm(e.Start), Role.Label, "muted"); t.FontSize = 13; row.Children.Add(t);
                var n = Kit.Column(0, Kit.Text(e.Name, Role.Label), Kit.Text(e.Room is not null ? Names.Room(e.Room) : e.Kind == "task" ? "任务" : "", Role.Caption, "faint"));
                ((TextBlock)n.Children[0]).FontSize = 13.5; Grid.SetColumn(n, 1); row.Children.Add(n);
                content.Children.Add(row);
            }
        }
        // What is due today and tomorrow, to tick off here.
        var due = campus.Tasks.Live.Where(t => t.Parent is null && t.Done is null && t.Due is { } d && (d.Date == Clock.Text(now.Date) || d.Date == Clock.Text(now.Date.AddDays(1)))).Take(4).ToList();
        if (due.Count > 0)
        {
            content.Children.Add(Section("截止"));
            foreach (var task in due)
            {
                var row = new Grid { ColumnSpacing = 6, MinHeight = 32 };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); row.ColumnDefinitions.Add(new ColumnDefinition()); row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                var item = task; row.Children.Add(Kit.Check(false, task.Priority ?? 0, () => campus.Tasks.Toggle(item)));
                var name = Kit.Text(task.Title, Role.Label); name.FontSize = 13.5; name.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(name, 1); row.Children.Add(name);
                var when = Kit.Text($"{Clock.DayWord(task.Due!.Date, now.Date)}{(task.Due.Time is { } m ? $" {Clock.Hm(m)}" : "")}", Role.Caption, task.Due.Date == Clock.Text(now.Date) ? "brand" : "faint"); when.VerticalAlignment = VerticalAlignment.Center;
                Grid.SetColumn(when, 2); row.Children.Add(when);
                content.Children.Add(row);
            }
        }
        if (line.Next(now) is null && rest.Count == 0 && due.Count == 0) content.Children.Add(Kit.Text("接下来没有安排", Role.Label, "muted"));
    }

    private static TextBlock Section(string text) { var t = Kit.Text(text, Role.Caption, "muted", bold: true); t.Margin = new Thickness(0, 6, 0, 2); return t; }
}
