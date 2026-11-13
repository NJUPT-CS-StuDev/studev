// The frame every page shares, as the web's .sd.page .wrap: one centred column of one width, its header (a title,
// the line under it, the buttons at the end), tabs, and then what the page shows; all of it scrolls together.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace StuDev.Ui;

public static class Pages
{
    public static ScrollViewer Frame(UIElement content, double width = 1040)
    {
        // One column of at most `width`, the rest shared either side: a star column with a MaxWidth keeps it centred.
        var column = new Grid { Padding = new Thickness(32, 26, 32, 56) };
        column.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        column.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10000, GridUnitType.Star), MaxWidth = width });
        column.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn((FrameworkElement)content, 1);
        column.Children.Add(content);
        return new ScrollViewer { Content = column, HorizontalScrollMode = ScrollMode.Disabled, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
    }

    /** A page's header (.ph): the title and the line under it on the left, the page's buttons on the right. */
    public static Grid Header(string title, string subtitle, params UIElement[] actions)
    {
        var header = new Grid { Margin = new Thickness(0, 0, 0, 18) };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var words = new StackPanel { Spacing = 4 };
        words.Children.Add(Kit.Text(title, Role.Title));
        if (subtitle.Length > 0) words.Children.Add(Kit.Text(subtitle, Role.Label, "muted"));
        header.Children.Add(words);
        var acts = Kit.Line(6, actions); acts.VerticalAlignment = VerticalAlignment.Bottom;
        Grid.SetColumn(acts, 1); header.Children.Add(acts);
        return header;
    }

    /** Words in the middle of an empty place (.empty). */
    public static FrameworkElement Empty(string said, params UIElement[] under)
    {
        var column = Kit.Column(14, Kit.Text(said, Role.Body, "muted", wrap: true));
        foreach (var child in under) column.Children.Add(child);
        column.HorizontalAlignment = HorizontalAlignment.Center; column.Padding = new Thickness(0, 56, 0, 56);
        foreach (var child in column.Children) if (child is FrameworkElement element) element.HorizontalAlignment = HorizontalAlignment.Center;
        return column;
    }

    /** A sheet's title row (.card-h): the title, and the cross that closes it. */
    public static Grid SheetHead(UIElement title, Action close)
    {
        var head = new Grid { ColumnSpacing = 10 };
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        head.Children.Add(title);
        var cross = new Tap(Paint.Clear, Paint.Brush("surfaceSunken")) { Content = Kit.Icon(Icons.Cross, 15, "faint"), Width = 28, Height = 28, CornerRadius = new CornerRadius(6), VerticalAlignment = VerticalAlignment.Top };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(cross, "关闭");
        cross.Click += (_, _) => close();
        Grid.SetColumn(cross, 1); head.Children.Add(cross);
        return head;
    }

    public static TextBlock SheetTitle(string text, string colour = "ink")
    {
        var title = Kit.Text(text, Role.Heading, colour, wrap: true); title.FontSize = 20; title.LineHeight = 25;
        return title;
    }

    /** A small heading over a part of a page or sheet (.sh). */
    public static TextBlock Section(string text, string colour = "muted")
    {
        var words = Kit.Text(text, Role.Label, colour, bold: true); words.FontSize = 13; words.Margin = new Thickness(0, 16, 0, 6);
        return words;
    }
}
