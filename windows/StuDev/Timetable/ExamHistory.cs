using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using StuDev.Data;
using StuDev.Ui;
using StuDev.World;

namespace StuDev.Timetable;

public static class ExamHistory
{
    public static FrameworkElement Make(ExamRecord record)
    {
        var root = new StackPanel { Margin = new Thickness(0, 24, 0, 24) };
        if (record.Checked is { } at) root.Children.Add(Kit.Text($"最近核对 {Exams.Time(at)}", Role.Caption, "muted", wrap: true));
        var versions = Exams.History(record);
        if (versions.FirstOrDefault(version => version.Changes.Count > 0) is { } last) root.Children.Add(Kit.Text($"本班最近变更 · {Exams.VersionTime(last)}", Role.Caption, "muted", wrap: true));
        if (versions.FirstOrDefault() is { Baseline: false } latest) root.Children.Add(Kit.Text(Exams.Impact(false, latest.Changes), Role.Caption, "muted", wrap: true));
        var affected = versions.Count(version => version.Changes.Count > 0);
        root.Children.Add(Fold($"更新记录 · {versions.Count} 版{(affected > 0 ? $" · {affected} 次影响本班" : "")}", () => {
            var history = new StackPanel();
            foreach (var version in versions) history.Children.Add(Fold($"{Exams.VersionTime(version)} · {Exams.Impact(version.Baseline, version.Changes)}", () => {
                var detail = new StackPanel();
                foreach (var change in version.Changes)
                {
                    var words = Kit.Column(2, Kit.Text($"{Exams.ChangeName(change.Change)} · {Names.Course(change.Course.Name)}", Role.Label, bold: true));
                    foreach (var line in Exams.ChangeLines(change)) words.Children.Add(Kit.Text(line, Role.Caption, "muted", wrap: true));
                    words.Margin = new Thickness(0, 7, 0, 7); detail.Children.Add(words);
                }
                detail.Children.Add(Fold($"采用的文件 · {version.Files.Count} 份", () => Sources(version.Files)));
                return detail;
            }, $"exam-version:{version.Id}"));
            return history;
        }));
        if (record.Sources.Count > 0) root.Children.Add(Fold($"当前官方来源 · {record.Sources.Count} 份", () => Sources(record.Sources)));
        return root;
    }

    public static FrameworkElement Sources(List<ExamSource> files)
    {
        var sources = new StackPanel();
        foreach (var source in files)
        {
            var words = Kit.Column(3, Kit.Text(Exams.FileName(source.File), Role.Label, wrap: true));
            if (source.Published is { } day) words.Children.Add(Kit.Text($"{Exams.Time(day[..10])} 官方发布", Role.Caption, "muted"));
            sources.Children.Add(words);
            var links = Kit.Line(18, Kit.TextAction("官方公告", () => Browse(source.Notice)), Kit.TextAction("官方附件", () => Browse(source.Url)));
            links.Margin = new Thickness(0, 4, 0, 14); sources.Children.Add(links);
        }
        sources.Children.Add(Kit.Text("历史公告可能撤回，部分附件需连接校园网。", Role.Caption, "muted", wrap: true));
        return sources;
    }
    private static void Browse(string url) => _ = Windows.System.Launcher.LaunchUriAsync(new Uri(url));

    private static FrameworkElement Fold(string label, Func<FrameworkElement> make, string? id = null)
    {
        var root = new StackPanel();
        FrameworkElement? body = null;
        var icon = Kit.Icon(Icons.Chevron, 14, "muted"); icon.VerticalAlignment = VerticalAlignment.Center;
        var grid = new Grid { ColumnSpacing = 12, Padding = new Thickness(0, 13, 0, 13) };
        grid.ColumnDefinitions.Add(new ColumnDefinition()); grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.Children.Add(Kit.Text(label, Role.Label, wrap: true)); Grid.SetColumn(icon, 1); grid.Children.Add(icon);
        var tap = new Tap(Paint.Clear, Paint.Brush("surfaceSunken")) { Content = grid, BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 1, 0, 0) };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(tap, label);
        if (id is not null) Microsoft.UI.Xaml.Automation.AutomationProperties.SetAutomationId(tap, id);
        tap.Click += (_, _) => {
            if (body is null) { body = make(); root.Children.Add(body); }
            else body.Visibility = body.Visibility == Visibility.Visible ? Visibility.Collapsed : Visibility.Visible;
            icon.RenderTransform = new RotateTransform { Angle = body.Visibility == Visibility.Visible ? 90 : 0, CenterX = 7, CenterY = 7 };
        };
        root.Children.Add(tap); return root;
    }
}
