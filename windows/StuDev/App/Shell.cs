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
    public static readonly (string Key, string Label)[] Entries = [("timetable", "课表"), ("map", "地图"), ("knowledge", "知识"), ("search", "搜索"), ("ai", "AI")];
    private readonly Grid root = new();
    private readonly Grid body = new();
    private readonly StackPanel nav = new() { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Stretch };
    private readonly Grid layer = new() { Visibility = Visibility.Collapsed };
    private readonly Dictionary<string, Screen> screens = new();
    private readonly Me.AccountAvatar face = new(28);
    private readonly TextBlock faceName = new() { FontSize = 12, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center };
    private readonly StackPanel faceRow = new() { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
    private readonly Tap me = new();
    private readonly Tap share = new();
    private readonly TextBlock shareLabel = Kit.Text("分享", Role.Label, "muted");
    private readonly ColumnDefinition inset = new() { Width = new GridLength(140) };
    private FrameworkElement? wordmark;
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
        foreach (var width in new[] { GridLength.Auto, GridLength.Auto, new GridLength(1, GridUnitType.Star), GridLength.Auto, GridLength.Auto }) bar.ColumnDefinitions.Add(new ColumnDefinition { Width = width });
        bar.ColumnDefinitions.Add(inset);
        var mark = Kit.Text("StuDev", Role.Body, bold: true); mark.FontSize = 17; mark.FontWeight = Microsoft.UI.Text.FontWeights.Bold; mark.CharacterSpacing = -30;
        mark.VerticalAlignment = VerticalAlignment.Center; mark.Margin = new Thickness(0, 0, 28, 2); mark.IsHitTestVisible = false;
        wordmark = mark;
        bar.Children.Add(mark);
        Grid.SetColumn(nav, 1); bar.Children.Add(nav);
        var drag = new Grid { Background = Paint.Clear }; Grid.SetColumn(drag, 2); bar.Children.Add(drag);
        var shareRow = Kit.Line(5, Kit.Icon(Paint.Glyph("share"), 18, "muted", 24, 1.8), shareLabel);
        shareRow.VerticalAlignment = shareLabel.VerticalAlignment = VerticalAlignment.Center;
        share.Content = shareRow; share.Height = 34; share.MinWidth = 36; share.CornerRadius = new CornerRadius(8);
        share.Padding = new Thickness(7, 0, 7, 0); share.Margin = new Thickness(0, 0, 5, 0);
        share.VerticalAlignment = VerticalAlignment.Center; share.Ground(Paint.Clear, Paint.Brush("surfaceSunken"));
        AutomationProperties.SetName(share, "分享 StuDev"); ToolTipService.SetToolTip(share, "分享 StuDev");
        share.Click += (_, _) => ShareSite();
        Grid.SetColumn(share, 3); bar.Children.Add(share);
        faceRow.Children.Add(face); faceRow.Children.Add(faceName);
        me.Content = faceRow; me.Height = Paint.Number("size", "search"); me.MinWidth = Paint.Number("size", "target"); me.Padding = new Thickness(4, 0, 12, 0); me.CornerRadius = Kit.Capsule(me.Height); me.VerticalAlignment = VerticalAlignment.Center; me.Margin = new Thickness(0, 0, 8, 0);
        AutomationProperties.SetName(me, "我"); AutomationProperties.SetAutomationId(me, "me");
        me.Click += (_, _) => Open("me");
        Grid.SetColumn(me, 4); bar.Children.Add(me);
        face.Changed += () => AutomationProperties.SetHelpText(me, face.Status);
        Face();
        Me.Account.Shared.Changed += () => DispatcherQueue.TryEnqueue(Face);
        root.Children.Add(bar);
        SetTitleBar(drag);

        Grid.SetRow(body, 1); root.Children.Add(body);
        Grid.SetRowSpan(layer, 2); root.Children.Add(layer);
        Content = root;
        root.KeyDown += (_, e) => { if (e.Key == Windows.System.VirtualKey.Escape && layer.Visibility == Visibility.Visible) { Close(); e.Handled = true; } };
        root.ActualThemeChanged += (_, _) => Turned();
        bar.SizeChanged += (_, _) => AccountWidth();
        nav.SizeChanged += (_, _) => AccountWidth();
        // The caption buttons' width can read 0 while a window comes back from the tray or from minimized, and changes
        // with the display's scale; it is read again on every change and a reading of none keeps the last.
        AppWindow.Changed += (_, e) => { if (e.DidSizeChange || e.DidPositionChange || e.DidVisibilityChange || e.DidPresenterChange) Inset(); };
        Activated += (_, state) => {
            Inset();
            if (state.WindowActivationState == WindowActivationState.Deactivated) return;
            World.Campus.Shared.Resume();
            App.Syncing?.Soon();
        };
        Place();
    }

    /** Opens an entry, or 我; its page is made the first time and kept. */
    public void Open(string entry, object? argument = null)
    {
        if (entry != "me") AccountPages(false);
        if (!screens.TryGetValue(entry, out var screen))
        {
            screen = entry switch
            {
                "timetable" => new Timetable.TimetableScreen(),
                "me" => new Me.MeScreen(),
                "knowledge" => new Knowledge.KnowledgeScreen(),
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
    private void Face()
    {
        var user = Me.Account.Shared.User;
        me.Ground(Paint.Brush("surfaceSunken"), Paint.Brush("surface"));
        faceName.Text = user?.Nickname ?? "未登录"; faceName.Foreground = Paint.Brush("muted");
        AutomationProperties.SetName(me, $"我 · {faceName.Text}");
        face.Show(user);
        AutomationProperties.SetHelpText(me, face.Status);
        AccountWidth();
    }

    /** Account pages already show who is signed in; their header does not repeat the entry to one's settings. */
    public void AccountPages(bool shown) { me.Visibility = shown ? Visibility.Collapsed : Visibility.Visible; AccountWidth(); }

    private void AccountWidth()
    {
        if (root.ActualWidth <= 0) return;
        if (wordmark is not null) wordmark.Visibility = root.ActualWidth < 720 ? Visibility.Collapsed : Visibility.Visible;
        shareLabel.Visibility = root.ActualWidth < 960 ? Visibility.Collapsed : Visibility.Visible;
        foreach (var tap in nav.Children.OfType<Tap>()) tap.Padding = new Thickness(root.ActualWidth < 800 ? 8 : 12, 0, root.ActualWidth < 800 ? 8 : 12, 0);
        // Navigation and a usable title-bar drag area precede the optional nickname.
        var markWidth = wordmark?.Visibility == Visibility.Visible ? wordmark.ActualWidth + 28 : 0;
        var remaining = root.ActualWidth - inset.Width.Value - 20 - markWidth - nav.ActualWidth - share.ActualWidth - 5 - 60 - 8 - Paint.Number("size", "accountBase");
        var compact = remaining < Paint.Number("size", "accountNameMin");
        faceName.Visibility = compact ? Visibility.Collapsed : Visibility.Visible;
        faceName.MaxWidth = Math.Max(0, Math.Min(remaining, Paint.Number("size", "accountNameMax")));
        faceRow.Spacing = compact ? 0 : 6;
        me.Padding = compact ? new Thickness(4, 0, 4, 0) : new Thickness(4, 0, 12, 0);
    }

    private void ShareSite()
    {
        var address = Product.Origin.TrimEnd('/') + "/";
        var url = Kit.Field(address, "", "StuDev 官网链接");
        url.IsReadOnly = true;
        var status = Kit.Text("", Role.Caption, "muted", wrap: true);
        var copy = Kit.Action("复制链接", () =>
        {
            var package = new Windows.ApplicationModel.DataTransfer.DataPackage();
            package.SetText(address);
            try
            {
                Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(package);
                status.Text = "链接已复制";
            }
            catch (System.Runtime.InteropServices.COMException)
            {
                url.Focus(FocusState.Programmatic); url.SelectAll();
                status.Text = "已选中链接，可手动复制";
            }
        }, go: true);
        var content = Kit.Column(12, Pages.SheetHead(Pages.SheetTitle("分享 StuDev"), Close), url, copy, status);
        content.Padding = new Thickness(22, 18, 22, 12);
        Sheet(content, 420);
    }

    private void Tabs()
    {
        nav.Children.Clear();
        foreach (var (key, label) in Entries)
        {
            var on = key == shown;
            var tone = on ? "brand" : "muted";
            var words = Kit.Text(label, Role.Label, tone, bold: on); words.FontSize = 14; words.VerticalAlignment = VerticalAlignment.Center;
            var content = Kit.Line(6, Kit.Icon(Paint.Glyph(key), 17, tone, 24, 1.8), words);
            content.VerticalAlignment = VerticalAlignment.Center;
            var tap = new Tap(Paint.Clear, Paint.Brush("surfaceSunken")) { Content = content, Padding = new Thickness(12, 0, 12, 0), Height = 34, CornerRadius = new CornerRadius(8), VerticalAlignment = VerticalAlignment.Center };
            AutomationProperties.SetName(tap, label); AutomationProperties.SetAutomationId(tap, key);
            AutomationProperties.SetItemStatus(tap, on ? "当前页面" : "");
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
        Face();
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
        AccountWidth();
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
