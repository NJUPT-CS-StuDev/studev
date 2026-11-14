// StuDev's own parts, made from the tokens: words in the five type roles, the plain bordered button (.ib, .btn), the
// round chips of a choice (.picks), tabs underlined in ink, the switch, the check box of a task, hairlines and cards.
// The web's campus.css and Android's ui are the same parts; these are drawn by WinUI, nothing of its stock look kept.
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Documents;
using TextDecorations = Windows.UI.Text.TextDecorations;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Markup;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;

namespace StuDev.Ui;

public enum Role { Title, Heading, Body, Label, Caption }

/** A pressable surface: a button with no look of its own, which takes the look it is given and lightens under the pointer. */
public partial class Tap : Button
{
    private static ControlTemplate? template;
    private static ControlTemplate Look => template ??= (ControlTemplate)XamlReader.Load(
        """
        <ControlTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" TargetType="Button">
          <Grid Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="{TemplateBinding BorderThickness}"
                CornerRadius="{TemplateBinding CornerRadius}" Padding="{TemplateBinding Padding}">
            <ContentPresenter Content="{TemplateBinding Content}" HorizontalAlignment="{TemplateBinding HorizontalContentAlignment}"
                              VerticalAlignment="{TemplateBinding VerticalContentAlignment}" Foreground="{TemplateBinding Foreground}" />
          </Grid>
        </ControlTemplate>
        """);
    private Brush rest;
    private Brush? hover;
    private bool over;
    public Tap(Brush? rest = null, Brush? hover = null)
    {
        base.Template = Look;
        this.rest = rest ?? Paint.Clear; this.hover = hover;
        Background = this.rest; BorderBrush = Paint.Clear; BorderThickness = new Thickness(0);
        Padding = new Thickness(0); HorizontalAlignment = HorizontalAlignment.Stretch; VerticalAlignment = VerticalAlignment.Stretch; HorizontalContentAlignment = HorizontalAlignment.Stretch; VerticalContentAlignment = VerticalAlignment.Stretch;
        MinWidth = 0; MinHeight = 0; IsTabStop = true; UseSystemFocusVisuals = true;
        PointerEntered += (_, _) => { over = true; Shade(); };
        PointerExited += (_, _) => { over = false; Shade(); };
        PointerCanceled += (_, _) => { over = false; Shade(); };
        AddHandler(PointerPressedEvent, new PointerEventHandler((_, _) => Opacity = .86), true);
        AddHandler(PointerReleasedEvent, new PointerEventHandler((_, _) => Opacity = 1), true);
        PointerCaptureLost += (_, _) => Opacity = 1;
    }
    /** The ground at rest and under the pointer, changed when the thing it shows changes (chosen, open). */
    public void Ground(Brush rest, Brush? hover = null) { this.rest = rest; this.hover = hover; Shade(); }
    private void Shade() => Background = over && hover is not null ? hover : rest;
}

public static class Kit
{
    public static double Size(Role role) => Paint.Number("type", Key(role), "size");
    private static string Key(Role role) => role switch { Role.Title => "title", Role.Heading => "heading", Role.Body => "body", Role.Label => "label", _ => "caption" };
    public static readonly FontFamily Mono = new("Cascadia Mono, Consolas");

    public static TextBlock Text(string text, Role role = Role.Body, string colour = "ink", bool bold = false, bool wrap = false)
    {
        var size = Size(role);
        var block = new TextBlock
        {
            Text = text, FontSize = size, Foreground = Paint.Brush(colour), LineHeight = Paint.Number("type", Key(role), "line"),
            LineStackingStrategy = LineStackingStrategy.BlockLineHeight, TextTrimming = wrap ? TextTrimming.None : TextTrimming.CharacterEllipsis,
            TextWrapping = wrap ? TextWrapping.Wrap : TextWrapping.NoWrap,
            FontWeight = bold || role is Role.Title or Role.Heading ? FontWeights.SemiBold : FontWeights.Normal,
        };
        if (role == Role.Title) block.CharacterSpacing = -15;
        Typography.SetNumeralAlignment(block, FontNumeralAlignment.Tabular);
        return block;
    }

    /** A line icon from the web's icon set (src/campus/world/ui.tsx): strokes in a square of `box` units, drawn `size` wide. */
    public static FrameworkElement Icon(string data, double size = 16, string colour = "ink", double box = 16, double stroke = 1.6, Brush? brush = null)
    {
        var path = new Microsoft.UI.Xaml.Shapes.Path
        {
            Data = (Geometry)XamlBindingHelper.ConvertValue(typeof(Geometry), data), Stroke = brush ?? Paint.Brush(colour), StrokeThickness = stroke,
            StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round, StrokeLineJoin = PenLineJoin.Round,
        };
        var canvas = new Canvas { Width = box, Height = box };
        canvas.Children.Add(path);
        return new Viewbox { Width = size, Height = size, Child = canvas, IsHitTestVisible = false };
    }

    /** The plain button of a page's header (.ib): 32 high, a hairline, the paper; an icon, words, or both. */
    public static Tap Button(string label, Action act, string? icon = null, double iconBox = 16, bool iconOnly = false)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        if (icon is not null) row.Children.Add(Icon(icon, 14, box: iconBox));
        if (!iconOnly) row.Children.Add(Text(label, Role.Label));
        var tap = new Tap(Paint.Brush("paper"), Paint.Brush("surfaceSunken"))
        {
            Content = row, Height = 32, MinWidth = 32, Padding = new Thickness(iconOnly ? 0 : 10, 0, iconOnly ? 0 : 10, 0),
            CornerRadius = new CornerRadius(Paint.Number("radius", "control")), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(1),
        };
        AutomationProperties.SetName(tap, label);
        tap.Click += (_, _) => act();
        return tap;
    }

    /** The button that does what a sheet is for (.btn, .btn.go): 36 high, brand when it is the one to press. */
    public static Tap Action(string label, Action act, bool go = false, string colour = "ink")
    {
        var words = Text(label, Role.Label, go ? "onBrand" : colour, bold: true);
        words.HorizontalAlignment = HorizontalAlignment.Center; words.VerticalAlignment = VerticalAlignment.Center; words.FontSize = 14;
        var tap = new Tap(go ? Paint.Brush("brand") : Paint.Brush("paper"), go ? Paint.Mix("brand.hover", dark => Paint.Blend(Paint.Of("brand", dark), Paint.Of("ink", dark), .92)) : Paint.Brush("surfaceSunken"))
        {
            Content = words, Height = 36, Padding = new Thickness(16, 0, 16, 0), CornerRadius = new CornerRadius(Paint.Number("radius", "control")),
            BorderBrush = go ? Paint.Brush("brand") : Paint.Brush("line"), BorderThickness = new Thickness(1),
        };
        AutomationProperties.SetName(tap, label);
        tap.Click += (_, _) => act();
        return tap;
    }

    /** One choice among a few (.picks button): brand ground when chosen. */
    public static Tap Pick(string label, bool on, Action act, double height = 32)
    {
        var words = Text(label, Role.Label, on ? "onBrand" : "ink");
        words.HorizontalAlignment = HorizontalAlignment.Center; words.VerticalAlignment = VerticalAlignment.Center; words.FontSize = 13;
        var tap = new Tap(on ? Paint.Brush("brand") : Paint.Brush("paper"), on ? null : Paint.Brush("surfaceSunken"))
        {
            Content = words, Height = height, Padding = new Thickness(12, 0, 12, 0), CornerRadius = new CornerRadius(Paint.Number("radius", "control")),
            BorderBrush = on ? Paint.Brush("brand") : Paint.Brush("line"), BorderThickness = new Thickness(1),
        };
        AutomationProperties.SetName(tap, label);
        tap.Click += (_, _) => act();
        return tap;
    }

    /** A row of choices that wraps. */
    public static Panel Picks(params UIElement[] picks)
    {
        var wrap = new WrapRow { Gap = 8 };
        foreach (var pick in picks) wrap.Children.Add(pick);
        return wrap;
    }

    /** Tabs: muted words, the chosen one in ink with a line under it, all over one hairline (.tabs). */
    public static FrameworkElement Tabs(IReadOnlyList<(string Key, string Label)> tabs, string chosen, Action<string> pick, double gap = 22)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = gap };
        foreach (var (key, label) in tabs)
        {
            var on = key == chosen;
            var words = Text(label, Role.Label, on ? "ink" : "muted", bold: on); words.FontSize = 14; words.VerticalAlignment = VerticalAlignment.Center;
            var cell = new Grid { Height = 38 };
            cell.Children.Add(words);
            if (on) cell.Children.Add(new Rectangle { Height = 2, Fill = Paint.Brush("ink"), VerticalAlignment = VerticalAlignment.Bottom });
            var tap = new Tap { Content = cell };
            AutomationProperties.SetName(tap, label);
            tap.Click += (_, _) => pick(key);
            row.Children.Add(tap);
        }
        var all = new Grid { BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 0, 0, 1) };
        all.Children.Add(row);
        return all;
    }

    /** A choice of a few, side by side on a sunken ground, the chosen one raised on the paper (.choice). */
    public static FrameworkElement Choice(IReadOnlyList<(string Key, string Label)> options, string chosen, Action<string> pick)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2 };
        foreach (var (key, label) in options)
        {
            var on = key == chosen;
            var words = Text(label, Role.Label, on ? "ink" : "muted", bold: on); words.FontSize = 13;
            var tap = new Tap(on ? Paint.Brush("paper") : Paint.Clear, on ? null : Paint.Brush("line")) { Content = words, Padding = new Thickness(14, 5, 14, 6), CornerRadius = new CornerRadius(6) };
            AutomationProperties.SetName(tap, label);
            tap.Click += (_, _) => pick(key);
            row.Children.Add(tap);
        }
        return new Border { Child = row, Padding = new Thickness(2), CornerRadius = new CornerRadius(8), Background = Paint.Brush("surfaceSunken"), HorizontalAlignment = HorizontalAlignment.Left };
    }

    /** The switch (.toggle): 36 by 22, the line when off, the brand when on. */
    public static Tap Switch(bool on, Action<bool> turn, string label)
    {
        var knob = new Ellipse { Width = 18, Height = 18, Fill = new SolidColorBrush(Microsoft.UI.Colors.White), HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(on ? 16 : 2, 0, 0, 0) };
        var track = new Border { Width = 36, Height = 22, CornerRadius = new CornerRadius(11), Background = on ? Paint.Brush("brand") : Paint.Brush("line"), Child = knob };
        var tap = new Tap { Content = track, CornerRadius = new CornerRadius(11) };
        AutomationProperties.SetName(tap, label);
        tap.Click += (_, _) => turn(!on);
        return tap;
    }

    /** A task's box (.tcheck): its priority's colour round it, filled and ticked when done. */
    public static Tap Check(bool done, int priority, Action toggle)
    {
        var ring = priority switch { 1 => Paint.Mix("p1", _ => Paint.Parse("#4f8cff")), 2 => Paint.Mix("p2", _ => Paint.Parse("#e8a33a")), 3 => Paint.Brush("danger"), _ => Paint.Brush("faint") };
        var box = new Grid { Width = 20, Height = 20 };
        box.Children.Add(new Border { CornerRadius = new CornerRadius(5), BorderThickness = new Thickness(done ? 0 : 1.5), BorderBrush = ring, Background = done ? Paint.Brush("faint") : Paint.Clear });
        if (done) box.Children.Add(Icon("m4.5 10.5 3.5 3.5 7.5-8", 14, "paper", 20, 2.4));
        var tap = new Tap { Content = box, Width = 28, Height = 28, CornerRadius = new CornerRadius(6) };
        box.HorizontalAlignment = HorizontalAlignment.Center; box.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(tap, done ? "标为未完成" : "完成");
        tap.Click += (_, _) => toggle();
        return tap;
    }

    public static Rectangle Hairline() => new() { Height = 1, Fill = Paint.Brush("line"), HorizontalAlignment = HorizontalAlignment.Stretch };

    /** A key and its value in a sheet (.kv): a hairline above, the key muted, the value in ink. */
    public static FrameworkElement Row(string key, UIElement value, Action? open = null)
    {
        var grid = new Grid { ColumnSpacing = 12, Padding = new Thickness(0, 11, 0, 11), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 1, 0, 0) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = key.Length > 0 ? new GridLength(64) : new GridLength(0) });
        if (key.Length == 0) grid.ColumnSpacing = 0;
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var k = Text(key, Role.Label, "muted"); k.FontSize = 14;
        grid.Children.Add(k);
        Grid.SetColumn((FrameworkElement)value, 1); grid.Children.Add(value);
        if (open is null) return grid;
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var chevron = Icon(Icons.Chevron, 14, "faint"); Grid.SetColumn(chevron, 2); chevron.VerticalAlignment = VerticalAlignment.Center; grid.Children.Add(chevron);
        var tap = new Tap(Paint.Brush("paper"), Paint.Faded("surfaceSunken", .55)) { Content = grid };
        // Read aloud and found by name as what it says: its key, then the first words of its value.
        AutomationProperties.SetName(tap, string.Join(" ", new[] { key, FirstWords(value) }.Where(t => t.Length > 0)));
        tap.Click += (_, _) => open();
        return tap;
    }

    private static string FirstWords(UIElement element) => element switch
    {
        TextBlock text => text.Text,
        Panel panel => panel.Children.Select(FirstWords).FirstOrDefault(t => t.Length > 0) ?? "",
        Border border when border.Child is not null => FirstWords(border.Child),
        _ => "",
    };

    /** A text box in the tokens' clothes (.tf). */
    public static TextBox Field(string text, string placeholder, string label)
    {
        var box = new TextBox { Text = text, PlaceholderText = placeholder, FontSize = 14.5, MinHeight = 40 };
        AutomationProperties.SetName(box, label);
        return box;
    }

    public static StackPanel Column(double spacing, params UIElement[] children)
    {
        var column = new StackPanel { Spacing = spacing };
        foreach (var child in children) column.Children.Add(child);
        return column;
    }
    public static StackPanel Line(double spacing, params UIElement[] children)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = spacing };
        foreach (var child in children) row.Children.Add(child);
        return row;
    }
}

/** Children in a row that wraps onto the next line when full: chips, picks. */
public partial class WrapRow : Panel
{
    public double Gap { get; set; } = 8;
    protected override Windows.Foundation.Size MeasureOverride(Windows.Foundation.Size available)
    {
        double x = 0, y = 0, line = 0, widest = 0;
        foreach (var child in Children)
        {
            child.Measure(new Windows.Foundation.Size(available.Width, double.PositiveInfinity));
            var size = child.DesiredSize;
            if (x > 0 && x + size.Width > available.Width) { y += line + Gap; x = 0; line = 0; }
            x += size.Width + Gap; line = Math.Max(line, size.Height); widest = Math.Max(widest, x - Gap);
        }
        return new(double.IsInfinity(available.Width) ? widest : Math.Min(widest, available.Width), y + line);
    }
    protected override Windows.Foundation.Size ArrangeOverride(Windows.Foundation.Size final)
    {
        double x = 0, y = 0, line = 0;
        foreach (var child in Children)
        {
            var size = child.DesiredSize;
            if (x > 0 && x + size.Width > final.Width) { y += line + Gap; x = 0; line = 0; }
            child.Arrange(new Windows.Foundation.Rect(x, y, size.Width, size.Height));
            x += size.Width + Gap; line = Math.Max(line, size.Height);
        }
        return final;
    }
}

/** The web's icons (src/campus/world/ui.tsx), the same strokes. */
public static class Icons
{
    public const string Chevron = "M6,3.5 L10.5,8 L6,12.5";
    public const string Back = "M10,3.5 L5.5,8 L10,12.5";
    public const string Cross = "M4,4 L12,12 M12,4 L4,12";
    public const string Bell = "M4.5,11 V7.5 A3.5,3.5 0 0 1 11.5,7.5 V11 L12.5,12.5 H3.5 Z M6.8,14 H9.2";
    public const string Note = "M3.5,4.5 H12.5 M3.5,8 H12.5 M3.5,11.5 H8.5";
    /** 20-unit icons. */
    public const string Tick = "M4.5,10.5 L8,14 L15.5,6";
    public const string Pencil = "M12.5,4.5 L15.5,7.5 L7.5,15.5 H4.5 V12.5 Z M11,6 L14,9";
    public const string Magnifier = "M14.5,9 A5.5,5.5 0 1 1 3.5,9 A5.5,5.5 0 1 1 14.5,9 Z M13.2,13.2 L16.5,16.5";
    public const string Compose = "M9,4 H5.5 A2,2 0 0 0 3.5,6 V14.5 A2,2 0 0 0 5.5,16.5 H14 A2,2 0 0 0 16,14.5 V11 M14.5,3.5 L16.5,5.5 L10,12 H8 V10 Z";
    public const string Plus = "M10,4.5 V15.5 M4.5,10 H15.5";
    public const string Again = "M15.5,10 A5.5,5.5 0 1 1 13.9,6.1 M14.5,3.5 V6.5 H11.5";
    public const string Copy = "M9,7 H14.5 A2,2 0 0 1 16.5,9 V14.5 A2,2 0 0 1 14.5,16.5 H9 A2,2 0 0 1 7,14.5 V9 A2,2 0 0 1 9,7 Z M13,7 V5.5 A2,2 0 0 0 11,3.5 H5.5 A2,2 0 0 0 3.5,5.5 V11 A2,2 0 0 0 5.5,13 H7";
    public const string Up = "M10,15.5 V4.5 M5.5,9 L10,4.5 L14.5,9";
    public const string Square = "M7.5,6 H12.5 A1.5,1.5 0 0 1 14,7.5 V12.5 A1.5,1.5 0 0 1 12.5,14 H7.5 A1.5,1.5 0 0 1 6,12.5 V7.5 A1.5,1.5 0 0 1 7.5,6 Z";
    /** 24-unit: nobody signed in (the site header's avatar). */
    public const string Person = "M15.6,8.5 A3.6,3.6 0 1 1 8.4,8.5 A3.6,3.6 0 1 1 15.6,8.5 Z M5,20 C5.8,16.2 8.6,14.2 12,14.2 C15.4,14.2 18.2,16.2 19,20";
}
