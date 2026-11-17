using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Automation;
using StuDev.Data;
using StuDev.Ui;
using StuDev.World;

namespace StuDev.Timetable;

public static class ExamHistory
{
    public static FrameworkElement Make(ExamRecord record, string? selectedVersion = null, Action<string>? selected = null)
    {
        var root = new StackPanel { Margin = new Thickness(0, 24, 0, 24) };
        if (record.Checked is { } at) root.Children.Add(Kit.Text($"最近核对 {Exams.Time(at)}", Role.Caption, "muted", wrap: true));
        var versions = Exams.History(record);
        if (versions.FirstOrDefault(version => version.Changes.Count > 0) is { } last) root.Children.Add(Kit.Text($"本班最近变更 · {Exams.VersionTime(last)}", Role.Caption, "muted", wrap: true));
        var affected = versions.Count(version => version.Changes.Count > 0);
        var heading = Kit.Line(10, Kit.Text("更新记录", Role.Heading), Kit.Text($"{versions.Count} 版{(affected > 0 ? $" · {affected} 次影响本班" : "")}", Role.Caption, "muted"));
        heading.Margin = new Thickness(0, 20, 0, 14); root.Children.Add(heading);
        var history = new StackPanel(); root.Children.Add(history);
        var chosen = versions.Any(version => version.Id == selectedVersion) ? selectedVersion : versions.FirstOrDefault()?.Id;
        void Show(string? selection, bool focus = false)
        {
            chosen = selection; history.Children.Clear();
            foreach (var (version, index) in versions.Select((value, index) => (value, index)))
            {
                var current = index == 0;
                var open = version.Id == chosen;
                var row = new Grid { ColumnSpacing = 14 };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(20) }); row.ColumnDefinitions.Add(new ColumnDefinition());
                var spine = new Grid();
                if (index < versions.Count - 1) spine.Children.Add(new Border { Width = 1, Background = Paint.Brush("line"), HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 28, 0, 0) });
                if (current) spine.Children.Add(new Border { Width = 20, Height = 20, CornerRadius = new CornerRadius(10), Background = Paint.Brush("brandContainer"), VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 20, 0, 0) });
                spine.Children.Add(new Border { Width = 12, Height = 12, CornerRadius = new CornerRadius(6), Background = Paint.Brush(current ? "brand" : "paper"), BorderBrush = Paint.Brush(current ? "brand" : "muted"), BorderThickness = new Thickness(2), VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 24, 0, 0) });
                row.Children.Add(spine);
                var content = new StackPanel();
                var title = Kit.Column(4, Kit.Text(Exams.VersionTime(version), Role.Body, bold: true, wrap: true));
                if (current) title.Children.Add(new Border { Child = Kit.Text("当前版本", Role.Caption, "onBrandContainer", bold: true), Background = Paint.Brush("brandContainer"), Padding = new Thickness(7, 2, 7, 2), CornerRadius = new CornerRadius(6), HorizontalAlignment = HorizontalAlignment.Left });
                title.Children.Add(Kit.Text(Exams.Impact(version.Baseline, version.Changes), Role.Caption, "muted", wrap: true));
                var header = new Grid { Padding = new Thickness(16), ColumnSpacing = 12 };
                header.ColumnDefinitions.Add(new ColumnDefinition()); header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                header.Children.Add(title);
                var arrow = Kit.Text(open ? "⌃" : "⌄", Role.Heading, "muted"); arrow.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(arrow, 1); header.Children.Add(arrow);
                var tap = new Tap(Paint.Clear, Paint.Faded("brand", .05)) { Content = header };
                AutomationProperties.SetName(tap, $"{Exams.VersionTime(version)} · {Exams.Impact(version.Baseline, version.Changes)}{(current ? " · 当前版本" : "")}");
                AutomationProperties.SetAutomationId(tap, $"exam-version:{version.Id}");
                AutomationProperties.SetHelpText(tap, open ? "已展开" : "已收起");
                tap.Click += (_, _) => { selected?.Invoke(version.Id); Show(version.Id, true); }; content.Children.Add(tap);
                if (open)
                {
                    var detail = new StackPanel { Margin = new Thickness(16, 0, 16, 12) };
                    if (version.Changes.Count > 0)
                    {
                        var changes = Kit.Column(6, Kit.Text("对本班的影响", Role.Label, bold: true));
                        foreach (var change in version.Changes)
                        {
                            var words = Kit.Column(3, Kit.Text(Names.Course(change.Course.Name), Role.Label, bold: true, wrap: true));
                            foreach (var line in Exams.ChangeLines(change)) words.Children.Add(Kit.Text(line, Role.Caption, "muted", wrap: true));
                            var changeRow = new Grid { ColumnSpacing = 10, Margin = new Thickness(0, 6, 0, 6) };
                            changeRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); changeRow.ColumnDefinitions.Add(new ColumnDefinition());
                            changeRow.Children.Add(Kit.Text(Exams.ChangeName(change.Change), Role.Caption, change.Change == "added" ? "free" : change.Change == "changed" ? "warning" : "danger", bold: true));
                            Grid.SetColumn(words, 1); changeRow.Children.Add(words); changes.Children.Add(changeRow);
                        }
                        detail.Children.Add(Section(changes));
                    }
                    var sources = Kit.Column(8, Kit.Text($"本版采用的文件 · {version.Files.Count} 份", Role.Label, bold: true), Sources(version.Files));
                    detail.Children.Add(Section(sources)); content.Children.Add(detail);
                }
                var card = new Border { Child = content, Background = current && open ? Paint.Mix("exam.current", dark => Paint.Blend(Paint.Of("brand", dark), Paint.Of("surfaceRaised", dark), .07)) : Paint.Brush(open ? "surfaceRaised" : "surface"), BorderBrush = current ? Paint.Faded("brand", .4) : Paint.Brush("line"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(Paint.Number("radius", "card")), Margin = new Thickness(0, 0, 0, 14) };
                Grid.SetColumn(card, 1); row.Children.Add(card); history.Children.Add(row);
                if (focus && open) tap.Loaded += (_, _) => tap.Focus(FocusState.Programmatic);
            }
        }
        Show(chosen);
        return root;
    }

    private static Border Section(UIElement content) => new() { Child = content, BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 1, 0, 0), Padding = new Thickness(0, 12, 0, 0), Margin = new Thickness(0, 0, 0, 12) };

    public static FrameworkElement Sources(List<ExamSource> files)
    {
        var sources = new StackPanel();
        foreach (var group in files.GroupBy(source => source.Notice))
        {
            var first = group.First();
            var title = string.IsNullOrWhiteSpace(first.Title) ? "官方公告" : first.Title;
            var words = Kit.Column(4, Kit.Text(title + " ↗", Role.Label, wrap: true));
            if (first.Published is { } day) words.Children.Add(Kit.Text($"{Exams.Time(day[..10])} 官方发布", Role.Caption, "muted"));
            var announcement = new Tap(Paint.Clear, Paint.Brush("surfaceSunken")) { Content = words, MinHeight = Paint.Number("size", "target"), Padding = new Thickness(0, 6, 0, 6) };
            AutomationProperties.SetName(announcement, $"官方公告：{title}"); announcement.Click += (_, _) => Browse(group.Key);
            sources.Children.Add(announcement);
            var attachments = group.Where(source => !string.IsNullOrWhiteSpace(source.Url) && source.Url != group.Key).GroupBy(source => source.Url).ToDictionary(items => items.Key, items => items.Count());
            var adopted = new StackPanel();
            foreach (var source in group)
            {
                var name = Exams.FileName(source.File);
                if (attachments.GetValueOrDefault(source.Url) == 1)
                {
                    var file = new Tap(Paint.Clear, Paint.Brush("surfaceSunken")) { Content = Kit.Text(name + " ↗", Role.Label, "brand", wrap: true), MinHeight = Paint.Number("size", "target"), Padding = new Thickness(0, 8, 0, 8) };
                    AutomationProperties.SetName(file, $"官方附件：{name}"); file.Click += (_, _) => Browse(source.Url); adopted.Children.Add(file);
                }
                else { var text = Kit.Text(name, Role.Label, wrap: true); text.Margin = new Thickness(0, 8, 0, 8); adopted.Children.Add(text); }
            }
            foreach (var url in attachments.Where(item => item.Value > 1).Select(item => item.Key)) adopted.Children.Add(Kit.TextAction("官方附件", () => Browse(url)));
            sources.Children.Add(new Border { Child = adopted, BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(1, 0, 0, 0), Margin = new Thickness(8, 6, 0, 14), Padding = new Thickness(12, 0, 0, 0) });
        }
        return sources;
    }
    private static void Browse(string url) => _ = Windows.System.Launcher.LaunchUriAsync(new Uri(url));

}
