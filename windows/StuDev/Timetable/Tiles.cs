// One event drawn as a tile, the same tile as the web's .t: its course's tone with a hairline of the tone's border,
// the name above and where below; a lab with its edge, an exam in amber, a task on the paper with a brand edge,
// what is over faded into the paper, a lesson off this week dashed.
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Documents;
using TextDecorations = Windows.UI.Text.TextDecorations;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using StuDev.Ui;
using StuDev.World;

namespace StuDev.Timetable;

public static class Tiles
{
    public sealed record Look(Brush Ground, Brush Edge, Brush Words, Brush? Stripe = null, bool Dashed = false, bool Struck = false);

    public static Look LookOf(LineEvent e, int? tone, bool past)
    {
        if (e.Kind == "exam") return new(Paint.Brush("exam"), Paint.Brush("exam"), Paint.Brush("onExam"));
        if (e.Kind == "task")
            return e.Task?.Done is not null ? new(Paint.Brush("paper"), Paint.Brush("line"), Paint.Brush("faint"), Paint.Brush("line"), Struck: true)
                : new(Paint.Brush("paper"), Paint.Mix("task.edge", dark => Paint.Blend(Paint.Of("brand", dark), Paint.Of("line", dark), .45)), Paint.Brush("ink"), Paint.Brush("brand"));
        if (e.Kind == "run") return new(Paint.Brush("paper"), Paint.Brush("line"), Paint.Brush("muted"));
        Look look = tone is { } t
            ? past ? new(Paint.ToneFaded(t, "bg", .65), Paint.ToneFaded(t, "border", .45), Paint.ToneFaded(t, "fg", .58))
                   : new(Paint.Tone(t, "bg"), Paint.Tone(t, "border"), Paint.Tone(t, "fg"))
            : past ? new(Paint.Faded("surfaceSunken", .65), Paint.Faded("line", .45), Paint.Faded("ink", .58)) : new(Paint.Brush("surfaceSunken"), Paint.Brush("line"), Paint.Brush("ink"));
        return e.Kind == "lab" ? look with { Stripe = look.Edge } : look;
    }

    /** A tile: its look, its two lines, and what lies behind it said in a corner. */
    public static Tap Make(Look look, string name, string note, double nameSize, double noteSize, Action open, int behind = 0, string? behindSaid = null, bool left = false, string? badge = null)
    {
        var radius = new CornerRadius(Paint.Number("radius", "tile"));
        var face = new Grid();
        if (look.Dashed)
            face.Children.Add(new Rectangle { RadiusX = radius.TopLeft, RadiusY = radius.TopLeft, Stroke = look.Edge, StrokeThickness = 1, StrokeDashArray = [4, 3] });
        if (look.Stripe is not null)
            face.Children.Add(new Border { Width = 3, HorizontalAlignment = HorizontalAlignment.Left, Background = look.Stripe, CornerRadius = new CornerRadius(radius.TopLeft, 0, 0, radius.BottomLeft) });
        var words = new StackPanel { VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = left ? HorizontalAlignment.Left : HorizontalAlignment.Center, Margin = new Thickness(look.Stripe is null ? 4 : 7, 3, 4, 3) };
        var title = new TextBlock
        {
            Text = name, FontSize = nameSize, FontWeight = FontWeights.SemiBold, Foreground = look.Words, TextWrapping = TextWrapping.WrapWholeWords, TextAlignment = left ? TextAlignment.Left : TextAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis, MaxLines = 3, LineHeight = nameSize * 1.3, LineStackingStrategy = LineStackingStrategy.BlockLineHeight,
            TextDecorations = look.Struck ? TextDecorations.Strikethrough : TextDecorations.None,
        };
        words.Children.Add(title);
        if (note.Length > 0)
        {
            var small = new TextBlock { Text = note, FontSize = noteSize, Foreground = look.Words, Opacity = .82, Margin = new Thickness(0, 2, 0, 0), TextAlignment = left ? TextAlignment.Left : TextAlignment.Center, TextWrapping = TextWrapping.Wrap, MaxLines = 2, TextTrimming = TextTrimming.CharacterEllipsis };
            Typography.SetNumeralAlignment(small, FontNumeralAlignment.Tabular);
            words.Children.Add(small);
        }
        face.Children.Add(words);
        if (behind > 0) face.Children.Add(Corner(behindSaid ?? $"+{behind}", HorizontalAlignment.Right, VerticalAlignment.Bottom, "ink"));
        if (badge is not null) face.Children.Add(Corner(badge, HorizontalAlignment.Right, VerticalAlignment.Top, "warning"));
        var tap = new Tap(look.Ground, null) { Content = face, CornerRadius = radius, BorderBrush = look.Dashed ? Paint.Clear : look.Edge, BorderThickness = new Thickness(look.Dashed ? 0 : 1) };
        tap.PointerEntered += (_, _) => tap.Opacity = .94; tap.PointerExited += (_, _) => tap.Opacity = 1;
        AutomationProperties.SetName(tap, name);
        tap.Click += (_, _) => open();
        return tap;
    }

    private static Border Corner(string text, HorizontalAlignment h, VerticalAlignment v, string colour) => new()
    {
        HorizontalAlignment = h, VerticalAlignment = v, Margin = new Thickness(3), Padding = new Thickness(3, 0, 3, 0), CornerRadius = new CornerRadius(3),
        Background = Paint.Brush("paper"), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(colour == "ink" ? 1 : 0),
        Child = new TextBlock { Text = text, FontSize = 10, LineHeight = 13, FontWeight = FontWeights.SemiBold, Foreground = Paint.Brush(colour) },
    };
}

/** Children placed along a stretch of time: each at its top and height, from the left and short of the right by its inset. */
public sealed partial class Lane : Panel
{
    private readonly Dictionary<UIElement, (double Top, double Height, double Left, double Right, bool Full)> spots = new();
    public void Put(UIElement child, double top, double height, double left = 2, double right = 2)
    {
        spots[child] = (top, height, left, right, false);
        Children.Add(child);
    }
    /** A child as wide as the lane, centred on its top (a line, a label). */
    public void Mark(UIElement child, double top) { spots[child] = (top, 0, 0, 0, true); Children.Add(child); }
    protected override Windows.Foundation.Size MeasureOverride(Windows.Foundation.Size available)
    {
        var width = double.IsInfinity(available.Width) ? 100 : available.Width;
        foreach (var child in Children)
        {
            var spot = spots[child];
            child.Measure(spot.Full ? new(width, double.PositiveInfinity) : new(Math.Max(0, width - spot.Left - spot.Right), spot.Height));
        }
        return new(width, Height is var h && !double.IsNaN(h) ? h : 0);
    }
    protected override Windows.Foundation.Size ArrangeOverride(Windows.Foundation.Size final)
    {
        foreach (var child in Children)
        {
            var spot = spots[child];
            if (spot.Full) { var h = child.DesiredSize.Height; child.Arrange(new(0, spot.Top - h / 2, final.Width, h)); }
            else child.Arrange(new(spot.Left, spot.Top, Math.Max(0, final.Width - spot.Left - spot.Right), spot.Height));
        }
        return final;
    }
}
