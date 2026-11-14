// The window: one bar across the top drawn into the title bar, as the website's header — the wordmark, the four
// entries in words, and one's face at the end — and under it the page. Sheets open over everything, centred.
using Microsoft.UI.Input;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using StuDev.Ui;

namespace StuDev;

/** A page of the window: made once, kept, and told when it is shown again. */
public abstract partial class Screen : Grid
{
    public virtual void Shown(object? argument) { }
}

public sealed partial class Shell : Window
{
    public static readonly (string Key, string Label)[] Entries = [("timetable", "课表"), ("map", "地图"), ("search", "搜索"), ("ai", "AI")];
    private readonly Grid root = new();
    private readonly Grid body = new();
    private readonly StackPanel nav = new() { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Stretch };
    private readonly Grid layer = new() { Visibility = Visibility.Collapsed };
    private readonly Dictionary<string, Screen> screens = new();
    private readonly Border face = new();
    private readonly ColumnDefinition inset = new() { Width = new GridLength(140) };
    private string shown = "";
    private Action? closing;

    public Shell()
    {
        Title = "StuDev";
        ExtendsContentIntoTitleBar = true;
        AppWindow.TitleBar.PreferredHeightOption = TitleBarHeightOption.Tall;
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "StuDev.ico"));
        root.Background = Paint.Brush("paper");
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(48) });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        var bar = new Grid { BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 0, 0, 1), Padding = new Thickness(20, 0, 0, 0) };
        foreach (var width in new[] { GridLength.Auto, GridLength.Auto, new GridLength(1, GridUnitType.Star), GridLength.Auto }) bar.ColumnDefinitions.Add(new ColumnDefinition { Width = width });
        bar.ColumnDefinitions.Add(inset);
        var mark = Kit.Text("StuDev", Role.Body, bold: true); mark.FontSize = 17; mark.FontWeight = Microsoft.UI.Text.FontWeights.Bold; mark.CharacterSpacing = -30;
        mark.VerticalAlignment = VerticalAlignment.Center; mark.Margin = new Thickness(0, 0, 28, 2); mark.IsHitTestVisible = false;
        bar.Children.Add(mark);
        Grid.SetColumn(nav, 1); bar.Children.Add(nav);
        var drag = new Grid { Background = Paint.Clear }; Grid.SetColumn(drag, 2); bar.Children.Add(drag);
        var me = new Tap { Content = face, Width = 32, Height = 32, CornerRadius = new CornerRadius(16), VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 8, 0) };
        AutomationProperties.SetName(me, "我"); AutomationProperties.SetAutomationId(me, "me");
        me.Click += (_, _) => Open("me");
        Grid.SetColumn(me, 3); bar.Children.Add(me);
        Face(Me.Account.Shared.User?.Letter);
        Me.Account.Shared.Changed += () => DispatcherQueue.TryEnqueue(() => Face(Me.Account.Shared.User?.Letter));
        root.Children.Add(bar);
        SetTitleBar(drag);

        Grid.SetRow(body, 1); root.Children.Add(body);
        Grid.SetRowSpan(layer, 2); root.Children.Add(layer);
        Content = root;
        root.KeyDown += (_, e) => { if (e.Key == Windows.System.VirtualKey.Escape && layer.Visibility == Visibility.Visible) { Close(); e.Handled = true; } };
        root.ActualThemeChanged += (_, _) => Turned();
        // The caption buttons' width can read 0 while a window comes back from the tray or from minimized, and changes
        // with the display's scale; it is read again on every change and a reading of none keeps the last.
        AppWindow.Changed += (_, e) => { if (e.DidSizeChange || e.DidPositionChange || e.DidVisibilityChange || e.DidPresenterChange) Inset(); };
        Activated += (_, _) => Inset();
        Place();
    }

    /** Opens an entry, or 我; its page is made the first time and kept. */
    public void Open(string entry, object? argument = null)
    {
        if (!screens.TryGetValue(entry, out var screen))
        {
            screen = entry switch
            {
                "timetable" => new Timetable.TimetableScreen(),
                "me" => new Me.MeScreen(),
                "search" => new Search.SearchScreen(),
                "ai" => new Ai.AiScreen(),
                "map" => new Map.MapScreen(),
                _ => new Later(Entries.FirstOrDefault(e => e.Key == entry).Label ?? entry),
            };
            screens[entry] = screen;
        }
        if (shown != entry)
        {
            body.Children.Clear(); body.Children.Add(screen); shown = entry;
            var rise = new TransitionCollection { new EntranceThemeTransition { FromVerticalOffset = 12 } };
            screen.Transitions = rise;
            Tabs();
        }
        screen.Shown(argument);
    }

    /** One's face in the bar: the QQ picture, the nickname's first character, or the outline of nobody. */
    public void Face(string? letter)
    {
        face.Width = 32; face.Height = 32; face.CornerRadius = new CornerRadius(16); face.Background = Paint.Brush("surfaceSunken");
        face.Child = letter is null ? Kit.Icon(Icons.Person, 18, "muted", 24, 1.8) : new TextBlock { Text = letter, FontSize = 12.5, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = Paint.Brush("muted"), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        if (face.Child is FrameworkElement child) { child.HorizontalAlignment = HorizontalAlignment.Center; child.VerticalAlignment = VerticalAlignment.Center; }
    }

    private void Tabs()
    {
        nav.Children.Clear();
        foreach (var (key, label) in Entries)
        {
            var on = key == shown;
            var words = Kit.Text(label, Role.Label, on ? "ink" : "muted", bold: on); words.FontSize = 14; words.VerticalAlignment = VerticalAlignment.Center;
            var tap = new Tap(Paint.Clear, Paint.Brush("surfaceSunken")) { Content = words, Padding = new Thickness(12, 0, 12, 0), Height = 34, CornerRadius = new CornerRadius(8), VerticalAlignment = VerticalAlignment.Center };
            AutomationProperties.SetName(tap, label); AutomationProperties.SetAutomationId(tap, key);
            tap.Click += (_, _) => Open(key);
            nav.Children.Add(tap);
        }
    }

    /** A sheet over the page: a card in the middle on a dimmed ground; Esc, the ground or `Close` puts it away. */
    public void Sheet(FrameworkElement content, double width = 460, Action? closed = null)
    {
        closing?.Invoke();
        closing = closed;
        layer.Children.Clear();
        var scrim = new Grid { Background = Paint.Brush("scrim") };
        scrim.Tapped += (_, _) => Close();
        layer.Children.Add(scrim);
        var scroller = new ScrollViewer { Content = content, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollMode = ScrollMode.Disabled };
        var card = new Border
        {
            Width = width, MaxHeight = Math.Max(320, root.ActualHeight * .88), Background = Paint.Brush("paper"), CornerRadius = new CornerRadius(Paint.Number("radius", "sheet")),
            BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(Paint.Dark ? 1 : 0), Child = scroller,
            HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Translation = new System.Numerics.Vector3(0, 0, 48),
        };
        card.Shadow = new ThemeShadow();
        card.Transitions = [new PopupThemeTransition()];
        layer.Children.Add(card);
        layer.Visibility = Visibility.Visible;
        // Focus goes where one types, else to the sheet itself, so Esc works and no ring sits on a button.
        scroller.IsTabStop = true;
        card.Loaded += (_, _) => { if (FirstBox(content) is { } box) box.Focus(FocusState.Programmatic); else scroller.Focus(FocusState.Programmatic); };
    }
    private static TextBox? FirstBox(DependencyObject at)
    {
        if (at is TextBox { Text.Length: 0 } box) return box;
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(at); i++) if (FirstBox(VisualTreeHelper.GetChild(at, i)) is { } found) return found;
        return null;
    }
    public new void Close()
    {
        layer.Visibility = Visibility.Collapsed; layer.Children.Clear();
        var done = closing; closing = null; done?.Invoke();
    }
    public bool SheetOpen => layer.Visibility == Visibility.Visible;

    private void Turned()
    {
        Paint.Turn(root.ActualTheme == ElementTheme.Dark);
        var bar = AppWindow.TitleBar;
        bar.ButtonBackgroundColor = Paint.Clear.Color; bar.ButtonInactiveBackgroundColor = Paint.Clear.Color;
        bar.ButtonForegroundColor = Paint.Of("ink", Paint.Dark); bar.ButtonInactiveForegroundColor = Paint.Of("faint", Paint.Dark);
        bar.ButtonHoverBackgroundColor = Paint.Of("surface", Paint.Dark); bar.ButtonHoverForegroundColor = Paint.Of("ink", Paint.Dark);
        bar.ButtonPressedBackgroundColor = Paint.Of("line", Paint.Dark); bar.ButtonPressedForegroundColor = Paint.Of("ink", Paint.Dark);
    }
    public void Apply(ElementTheme theme) { root.RequestedTheme = theme; Turned(); }

    /** Shown and brought forward, from the tray, the card or a reminder. */
    public void Bring()
    {
        AppWindow.Show();
        if (AppWindow.Presenter is OverlappedPresenter { State: OverlappedPresenterState.Minimized } presenter) presenter.Restore();
        Activate();
    }

    private void Inset()
    {
        var scale = root.XamlRoot?.RasterizationScale ?? 1;
        if (AppWindow.TitleBar.RightInset > 0) inset.Width = new GridLength(AppWindow.TitleBar.RightInset / scale);
    }

    private void Place()
    {
        var display = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Nearest);
        var scale = Dpi(WinRT.Interop.WindowNative.GetWindowHandle(this)) / 96.0;
        var width = (int)Math.Min(display.WorkArea.Width * .92, 1280 * scale);
        var height = (int)Math.Min(display.WorkArea.Height * .92, 880 * scale);
        AppWindow.MoveAndResize(new Windows.Graphics.RectInt32(display.WorkArea.X + (display.WorkArea.Width - width) / 2,
            display.WorkArea.Y + (display.WorkArea.Height - height) / 2, width, height));
        root.Loaded += (_, _) => { Inset(); Turned(); root.XamlRoot.Changed += (_, _) => Inset(); };
    }
    [System.Runtime.InteropServices.DllImport("user32.dll", EntryPoint = "GetDpiForWindow")]
    private static extern uint Dpi(IntPtr window);
}

/** An entry whose page is still being made. */
public sealed partial class Later : Screen
{
    public Later(string name)
    {
        var words = Kit.Text($"{name}正在做", Role.Heading, "muted");
        words.HorizontalAlignment = HorizontalAlignment.Center; words.VerticalAlignment = VerticalAlignment.Center;
        Children.Add(words);
    }
}
