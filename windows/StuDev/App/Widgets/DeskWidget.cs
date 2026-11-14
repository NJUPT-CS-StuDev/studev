// A widget on the desktop, as TickTick's are: a window of its own that belongs to the desktop, see-through over the
// wallpaper, dragged by its head and snapped to the screen's edges and to the other widgets, never in the taskbar or
// Alt+Tab. What it shows is a lens of the app's own (the list or the calendar) read through the shared glance rules;
// each kind of widget only draws its body. StuDev keeps every widget current from the tray.
using Microsoft.UI.Input;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using StuDev.Me;
using StuDev.Ui;
using StuDev.World;
using Windows.Foundation;
using Windows.UI;
using static StuDev.Native;

namespace StuDev.Widgets;

public abstract partial class DeskWidget : Window
{
    public string Id { get; }
    protected readonly Grid root = new();
    protected readonly StackPanel body = new();
    protected readonly Grid head = new() { Padding = new Thickness(16, 12, 8, 8), Background = Paint.Clear };
    protected readonly StackPanel tools = new() { Orientation = Orientation.Horizontal, Spacing = 2, VerticalAlignment = VerticalAlignment.Top };
    private readonly TextBlock title = new() { FontSize = 17, FontWeight = Microsoft.UI.Text.FontWeights.Bold };
    private readonly TextBlock subtitle = new() { FontSize = 12 };
    private readonly Tap pick;
    private readonly List<FrameworkElement> clickable = [];
    private readonly DispatcherTimer clock = new() { Interval = TimeSpan.FromSeconds(30) };
    private readonly DispatcherTimer keep = new() { Interval = TimeSpan.FromMilliseconds(600) };
    private readonly Frost frost = new();
    protected readonly nint hwnd;
    private Flyout? shown;

    protected abstract string Kind { get; }
    protected abstract (string Key, string Name)[] Views { get; }
    protected WidgetSettings Settings => Device.Widget(Id) ?? new WidgetSettings(Id, Kind, Views[0].Key);
    protected string View => Views.Any(v => v.Key == Settings.View) ? Settings.View : Views[0].Key;
    /** What sits under the head, above the scrolled body: the list's one-line adder. */
    protected virtual FrameworkElement? Under() => null;
    protected abstract void Draw(Campus campus, CampusLine line, Moment now);
    protected virtual string Subtitle(CampusLine? line, Moment now) =>
        $"{Clock.DateLabel(now.Date)} {Clock.Weekdays[Clock.Weekday(now.Date)]} · {(line?.WeekOf(now.Date) is { } w ? $"第 {w} 周" : "假期")}";

    protected DeskWidget(string id)
    {
        Id = id;
        Title = "StuDev 桌面小组件";
        hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        var presenter = OverlappedPresenter.Create();
        presenter.SetBorderAndTitleBar(true, false);
        presenter.IsMaximizable = false; presenter.IsMinimizable = false; presenter.IsResizable = true;
        AppWindow.SetPresenter(presenter);
        AppWindow.IsShownInSwitchers = false;
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "StuDev.ico"));
        var bounds = Settings.Bounds ?? DefaultBounds();
        AppWindow.MoveAndResize(new Windows.Graphics.RectInt32(bounds[0], bounds[1], bounds[2], bounds[3]));

        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition());
        pick = Picker();
        BuildHead();
        root.Children.Add(head);
        if (Under() is { } under) { Grid.SetRow(under, 1); root.Children.Add(under); }
        var scroll = new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Padding = new Thickness(0, 2, 0, 10) };
        Grid.SetRow(scroll, 2); root.Children.Add(scroll);
        Content = root;
        SystemBackdrop = frost;
        Snapping.Attach(hwnd);

        Paint.Turned += () => { Theme(); Redraw(); };
        Campus.Shared.Changed += () => DispatcherQueue.TryEnqueue(Redraw);
        clock.Tick += (_, _) => Redraw(); clock.Start();
        AppWindow.Changed += (_, e) => { if (e.DidPositionChange || e.DidSizeChange) { keep.Stop(); keep.Start(); } };
        keep.Tick += (_, _) => { keep.Stop(); var p = AppWindow.Position; var s = AppWindow.Size; if (Device.Widget(Id) is { } mine) Device.PutWidget(mine with { Bounds = [p.X, p.Y, s.Width, s.Height] }); };
        head.SizeChanged += (_, _) => Regions();
        root.Loaded += (_, _) => Regions();
        Closed += (_, _) => Snapping.Detach(hwnd);
        Theme();
        Redraw();
    }

    private int[] DefaultBounds()
    {
        var scale = GetDpiForWindow(hwnd) / 96.0;
        var area = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Primary).WorkArea;
        var placed = Device.Widgets.Count(w => w.Bounds is not null);
        int w = (int)(340 * scale), h = (int)(440 * scale), m = (int)(24 * scale);
        return [area.X + area.Width - (w + m) * (placed % 3 + 1), area.Y + m, w, h];
    }

    /** Follows the settings: where it belongs, how see-through it is, whether it can be moved. */
    public void Apply()
    {
        var settings = Settings;
        if (AppWindow.Presenter is OverlappedPresenter presenter) { presenter.IsAlwaysOnTop = settings.OnTop; presenter.IsResizable = !settings.Locked; }
        // Owned by the desktop's icon view it stays on the desktop and survives Win+D; on top it floats over every window.
        SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, settings.OnTop ? 0 : DesktopIcons());
        frost.Opacity = settings.Opacity / 100.0;
        Regions();
        Redraw();
    }

    public void ShowWidget() { Apply(); AppWindow.Show(false); }

    private static nint DesktopIcons()
    {
        var view = FindWindowExW(FindWindowW("Progman", null), 0, "SHELLDLL_DefView", null);
        for (nint worker = 0; view == 0 && (worker = FindWindowExW(0, worker, "WorkerW", null)) != 0;)
            view = FindWindowExW(worker, 0, "SHELLDLL_DefView", null);
        return view == 0 ? 0 : FindWindowExW(view, 0, "SysListView32", null);
    }

    private void Theme()
    {
        root.RequestedTheme = Paint.Dark ? ElementTheme.Dark : ElementTheme.Light;
        frost.Dark = Paint.Dark;
        title.Foreground = Paint.Brush("ink"); subtitle.Foreground = Paint.Brush("muted");
    }

    /** The head is the handle: the system drags the window from it, except where its buttons are. */
    private void Regions()
    {
        if (root.XamlRoot is null) return;
        var source = InputNonClientPointerSource.GetForWindowId(AppWindow.Id);
        if (Settings.Locked) { source.ClearRegionRects(NonClientRegionKind.Caption); source.ClearRegionRects(NonClientRegionKind.Passthrough); return; }
        var scale = root.XamlRoot.RasterizationScale;
        Windows.Graphics.RectInt32 Of(FrameworkElement element)
        {
            var box = element.TransformToVisual(root).TransformBounds(new Rect(0, 0, element.ActualWidth, element.ActualHeight));
            return new((int)(box.X * scale), (int)(box.Y * scale), (int)Math.Ceiling(box.Width * scale), (int)Math.Ceiling(box.Height * scale));
        }
        source.SetRegionRects(NonClientRegionKind.Caption, [Of(head)]);
        source.SetRegionRects(NonClientRegionKind.Passthrough, [.. clickable.Where(e => e.ActualWidth > 0).Select(Of)]);
    }

    private Tap Picker()
    {
        var named = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        named.Children.Add(title);
        var chevron = Kit.Icon("m4 6 4 4 4-4", 12, "muted", 16); chevron.VerticalAlignment = VerticalAlignment.Center; chevron.Margin = new Thickness(0, 3, 0, 0);
        named.Children.Add(chevron);
        var tap = new Tap(Paint.Clear, Paint.Faded("ink", .08)) { Content = named, Padding = new Thickness(6, 2, 6, 2), Margin = new Thickness(-6, 0, 0, 0), CornerRadius = new CornerRadius(6), HorizontalAlignment = HorizontalAlignment.Left };
        AutomationProperties.SetName(tap, "切换显示内容");
        tap.Click += (_, _) =>
        {
            var menu = new MenuFlyout();
            foreach (var (key, name) in Views)
            {
                var item = new RadioMenuFlyoutItem { Text = name, IsChecked = View == key, GroupName = "view" };
                item.Click += (_, _) => SetView(key);
                menu.Items.Add(item);
            }
            menu.ShowAt(tap, new FlyoutShowOptions { Placement = FlyoutPlacementMode.BottomEdgeAlignedLeft });
        };
        return tap;
    }

    protected void SetView(string key) { if (Device.Widget(Id) is { } mine) Device.PutWidget(mine with { View = key }); Moved(); Redraw(); }
    /** A view's own state (which day or week is shown) starts over when the view changes. */
    protected virtual void Moved() { }

    private void BuildHead()
    {
        head.ColumnDefinitions.Add(new ColumnDefinition()); head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var words = new StackPanel { Spacing = 1 };
        words.Children.Add(pick); words.Children.Add(subtitle);
        head.Children.Add(words);
        clickable.Add(pick);
        tools.Children.Add(Tool("M4 10h.01M10 10h.01M16 10h.01", "更多", More, 2.6));
        Grid.SetColumn(tools, 1); head.Children.Add(tools);
    }

    /** A small button in the head, kept out of the drag handle. */
    protected Tap Tool(string icon, string name, Action<Tap> act, double stroke = 1.6)
    {
        var tap = new Tap(Paint.Clear, Paint.Faded("ink", .08)) { Content = Kit.Icon(icon, 16, "muted", 20, stroke), Width = 30, Height = 30, CornerRadius = new CornerRadius(6) };
        ((FrameworkElement)tap.Content).HorizontalAlignment = HorizontalAlignment.Center; ((FrameworkElement)tap.Content).VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(tap, name); ToolTipService.SetToolTip(tap, name);
        tap.Click += (_, _) => act(tap);
        clickable.Add(tap);
        return tap;
    }

    private void More(Tap anchor)
    {
        var settings = Settings;
        var menu = new MenuFlyout();
        var open = new MenuFlyoutItem { Text = "打开 StuDev" }; open.Click += (_, _) => { App.Window?.Bring(); App.Open("timetable"); };
        var top = new ToggleMenuFlyoutItem { Text = "保持在最上层", IsChecked = settings.OnTop };
        top.Click += (_, _) => Device.PutWidget(Settings with { OnTop = top.IsChecked });
        var locked = new ToggleMenuFlyoutItem { Text = "锁定位置和大小", IsChecked = settings.Locked };
        locked.Click += (_, _) => Device.PutWidget(Settings with { Locked = locked.IsChecked });
        var opacity = new MenuFlyoutSubItem { Text = "不透明度" };
        foreach (var level in new[] { 100, 92, 84, 72, 60 })
        {
            var item = new RadioMenuFlyoutItem { Text = level == 100 ? "不透明" : $"{level}%", IsChecked = settings.Opacity == level, GroupName = "opacity" };
            item.Click += (_, _) => Device.PutWidget(Settings with { Opacity = level });
            opacity.Items.Add(item);
        }
        var remove = new MenuFlyoutItem { Text = "移除这个小组件" }; remove.Click += (_, _) => Device.RemoveWidget(Id);
        menu.Items.Add(open); menu.Items.Add(new MenuFlyoutSeparator());
        menu.Items.Add(top); menu.Items.Add(locked); menu.Items.Add(opacity);
        menu.Items.Add(new MenuFlyoutSeparator()); menu.Items.Add(remove);
        menu.ShowAt(anchor, new FlyoutShowOptions { Placement = FlyoutPlacementMode.BottomEdgeAlignedRight });
    }

    protected void Redraw()
    {
        body.Children.Clear();
        var campus = Campus.Shared;
        var now = Moment.Now();
        title.Text = Views.First(v => v.Key == View).Name;
        subtitle.Text = Subtitle(campus.Line, now);
        if (campus.Line is not { } line) { Empty(campus.Preferences.Class is null ? "在 StuDev 里选好班级，这里就会显示课表。" : "正在读取课表…"); return; }
        Draw(campus, line, now);
    }

    // The pieces every body is made of.

    protected static Color Wash(bool dark, double alpha) { var ink = Paint.Of("ink", dark); return Color.FromArgb((byte)(alpha * 255), ink.R, ink.G, ink.B); }
    protected static SolidColorBrush WashBrush(string key, double alpha) => Paint.Mix($"widget.{key}", dark => Wash(dark, alpha));
    protected static TextBlock Words(string text, string colour, double size = 12.5) => new() { Text = text, FontSize = size, Foreground = Paint.Brush(colour), VerticalAlignment = VerticalAlignment.Center };

    protected void Section(string text) =>
        body.Children.Add(new TextBlock { Text = text, FontSize = 12.5, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = Paint.Brush("muted"), Margin = new Thickness(20, 12, 16, 4) });

    protected void Empty(string text) =>
        body.Children.Add(new TextBlock { Text = text, FontSize = 13, Foreground = Paint.Brush("faint"), TextWrapping = TextWrapping.Wrap, Margin = new Thickness(20, 16, 20, 0) });

    /** One row: a lead mark, the title with an aside after it, how soon on the right, a hairline from the text on. */
    protected void Row(FrameworkElement lead, string name, string? aside, TextBlock? when, Action open, bool struck = false)
    {
        var grid = new Grid { ColumnSpacing = 8, MinHeight = 40 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(22) });
        grid.ColumnDefinitions.Add(new ColumnDefinition());
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.Children.Add(lead);
        var words = new TextBlock { FontSize = 14, TextTrimming = TextTrimming.CharacterEllipsis, TextWrapping = TextWrapping.NoWrap, VerticalAlignment = VerticalAlignment.Center, Foreground = Paint.Brush(struck ? "faint" : "ink"), TextDecorations = struck ? Windows.UI.Text.TextDecorations.Strikethrough : Windows.UI.Text.TextDecorations.None };
        words.Inlines.Add(new Run { Text = name });
        if (aside is not null) words.Inlines.Add(new Run { Text = $"  {aside}", FontSize = 12.5, Foreground = Paint.Brush("faint") });
        Grid.SetColumn(words, 1); grid.Children.Add(words);
        if (when is not null) { Grid.SetColumn(when, 2); grid.Children.Add(when); }
        var rule = new Border { Height = 1, VerticalAlignment = VerticalAlignment.Bottom, Background = WashBrush("rule", .08) };
        Grid.SetColumn(rule, 1); Grid.SetColumnSpan(rule, 2); grid.Children.Add(rule);
        var tap = new Tap(Paint.Clear, WashBrush("hover", .06)) { Content = grid, Padding = new Thickness(16, 0, 14, 0), CornerRadius = new CornerRadius(6), Margin = new Thickness(4, 0, 4, 0) };
        AutomationProperties.SetName(tap, aside is null ? name : $"{name} {aside}");
        tap.Click += (_, _) => open();
        body.Children.Add(tap);
    }

    protected static Border Bar(Brush brush) => new() { Width = 4, Height = 18, CornerRadius = new CornerRadius(2), Background = brush, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(4, 0, 0, 0) };

    protected static Brush ToneOf(CampusLine line, LineEvent e) =>
        e.Kind == "exam" ? Paint.Brush("exam") : Paint.Tone(CourseTones.ToneOf(e, CourseTones.Of(line), line.CourseMeetings) ?? 0, "fg");

    /** The details beside the widget: when and where, with the way there. */
    protected void EventDetail(LineEvent e, Moment now)
    {
        var column = Detail(e.Name);
        column.Children.Add(Kit.Text($"{Clock.DayWord(e.Date, now.Date)} {Clock.DateLabel(e.Date)} · {Clock.Hm(e.Start)}–{Clock.Hm(e.End)}", Role.Label, "muted"));
        if (e.Room is not null) column.Children.Add(Kit.Text(Names.Room(e.Room), Role.Label));
        if (e.Teachers.Count > 0) column.Children.Add(Kit.Text(string.Join("、", e.Teachers), Role.Caption, "muted"));
        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(0, 8, 0, 0) };
        if (Names.Placed(e.Room)) actions.Children.Add(Kit.Action("导航", () => { shown?.Hide(); App.Window?.Bring(); App.Open("map", ("nav", e.Room!)); }, go: true));
        actions.Children.Add(Kit.Action("在课表中查看", () => { shown?.Hide(); App.Window?.Bring(); App.Open("timetable"); }));
        column.Children.Add(actions);
        Show(column);
    }

    protected void TaskDetail(Campus campus, PersonalTask task, Moment now)
    {
        var column = Detail(task.Title);
        if (task.Due is { } due) column.Children.Add(Kit.Text($"{Clock.DayWord(due.Date, now.Date)} {Clock.DateLabel(Clock.Parse(due.Date))}{(due.Time is { } t ? $" {Clock.Hm(t)}" : "")} 截止", Role.Label, "muted"));
        if (task.Date is { } day) column.Children.Add(Kit.Text($"{Clock.DayWord(day, now.Date)} {Clock.Hm(task.Start ?? 0)}{(task.End is { } end ? $"–{Clock.Hm(end)}" : "")}", Role.Label, "muted"));
        if (!string.IsNullOrWhiteSpace(task.Note)) { var note = Kit.Text(task.Note!, Role.Label, wrap: true); note.MaxLines = 8; column.Children.Add(note); }
        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(0, 8, 0, 0) };
        actions.Children.Add(Kit.Action(task.Done is null ? "完成" : "标为未完成", () => { campus.Tasks.Toggle(task); shown?.Hide(); }, go: true));
        actions.Children.Add(Kit.Action("打开", () => { shown?.Hide(); App.Window?.Bring(); Timetable.TaskSheet.Open(campus, task.Id, now); }));
        column.Children.Add(actions);
        Show(column);
    }

    private static StackPanel Detail(string name)
    {
        var column = new StackPanel { Spacing = 6, Width = 280 };
        column.Children.Add(new TextBlock { Text = name, FontSize = 16, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap, Foreground = Paint.Brush("ink") });
        return column;
    }

    private void Show(FrameworkElement content)
    {
        shown?.Hide();
        shown = new Flyout { Content = content, Placement = FlyoutPlacementMode.Auto };
        var style = new Style(typeof(FlyoutPresenter));
        style.Setters.Add(new Setter(FlyoutPresenter.PaddingProperty, new Thickness(16, 14, 16, 14)));
        style.Setters.Add(new Setter(FlyoutPresenter.CornerRadiusProperty, new CornerRadius(10)));
        style.Setters.Add(new Setter(FrameworkElement.RequestedThemeProperty, root.RequestedTheme));
        shown.FlyoutPresenterStyle = style;
        shown.ShowAt(root);
    }
}
