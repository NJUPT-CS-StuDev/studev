// The first thing a new visitor sees: their class is all the timetable needs. ClassPicker.tsx, the same matching.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using StuDev.Data;
using StuDev.Ui;
using StuDev.World;

namespace StuDev.Me;

public static class ClassPicker
{
    private static string Fold(string value) => System.Text.RegularExpressions.Regex.Replace(value.Normalize(System.Text.NormalizationForm.FormKC).ToUpperInvariant(), @"\s+", "");

    public static FrameworkElement Make(List<TeachingClass> classes, Action<TeachingClass> picked, bool heading = true)
    {
        var column = new StackPanel { Spacing = 0, MaxWidth = 560, HorizontalAlignment = HorizontalAlignment.Center };
        if (heading)
        {
            column.Children.Add(Kit.Text("你在哪个班？", Role.Title));
            var lead = Kit.Text("输入班号或专业，课表、考试和校历就都有了。", Role.Body, "muted", wrap: true); lead.Margin = new Thickness(0, 6, 0, 18);
            column.Children.Add(lead);
        }
        var box = Kit.Field("", "比如 B240402", "班号或专业");
        column.Children.Add(box);
        var results = new StackPanel { Margin = new Thickness(0, 8, 0, 0) };
        column.Children.Add(results);
        void Show()
        {
            results.Children.Clear();
            var needle = Fold(box.Text);
            if (needle.Length == 0) return;
            var matches = classes.Where(c => Fold($"{c.Name} {c.Major ?? ""}").Contains(needle)).Take(30).ToList();
            if (matches.Count == 0) { var none = Kit.Text("没有找到这个班", Role.Body, "muted"); none.Margin = new Thickness(0, 16, 0, 0); results.Children.Add(none); return; }
            foreach (var item in matches)
            {
                var said = string.Join(" · ", new[] { item.Major, item.Campus, item.Students is { } n ? $"{n} 人" : null }.Where(s => !string.IsNullOrEmpty(s)));
                var row = Kit.Column(2, Kit.Text(item.Name, Role.Body, bold: true), Kit.Text(said, Role.Label, "muted"));
                row.Padding = new Thickness(12, 10, 12, 10);
                var tap = new Tap(Paint.Brush("paper"), Paint.Brush("surfaceSunken")) { Content = row, CornerRadius = new CornerRadius(8) };
                Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(tap, item.Name);
                var chosen = item; tap.Click += (_, _) => picked(chosen);
                results.Children.Add(tap);
            }
        }
        box.TextChanged += (_, _) => Show();
        box.KeyDown += (_, e) =>
        {
            if (e.Key != Windows.System.VirtualKey.Enter) return;
            var needle = Fold(box.Text);
            var exact = classes.FirstOrDefault(c => Fold(c.Name) == needle) ?? (classes.Count(c => Fold($"{c.Name} {c.Major ?? ""}").Contains(needle)) == 1 ? classes.First(c => Fold($"{c.Name} {c.Major ?? ""}").Contains(needle)) : null);
            if (exact is not null) picked(exact);
        };
        return column;
    }
}
