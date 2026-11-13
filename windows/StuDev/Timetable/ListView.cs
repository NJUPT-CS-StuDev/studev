// The line as a list: one's tasks by when they are due, with the exams among them, since an exam is the hardest
// deadline there is. A task is added at the top in one line, read back as it is typed. ListView.tsx, natively.
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Documents;
using TextDecorations = Windows.UI.Text.TextDecorations;
using Microsoft.UI.Xaml.Controls;
using StuDev.Data;
using StuDev.Ui;
using StuDev.World;

namespace StuDev.Timetable;

public static class ListView
{
    private static readonly HashSet<string> Folded = [];
    private static bool showDone;

    private static (string Text, string Tone) WhenOf(PersonalTask task, Moment now)
    {
        var parts = new List<string>();
        if (task.Date is { } date) parts.Add($"{Clock.DayWord(date, now.Date)} {Clock.Hm(task.Start!.Value)}{(task.End is { } end ? $"–{Clock.Hm(end)}" : "")}");
        if (task.Due is { } due) parts.Add($"{(task.Date is not null ? "截止 " : "")}{Clock.DayWord(due.Date, now.Date)}{(due.Time is { } t ? $" {Clock.Hm(t)}" : "")}{(task.Date is null ? " 截止" : "")}");
        var group = TaskRules.Group(task, now);
        return (string.Join(" · ", parts), group == "overdue" ? "danger" : group == "today" ? "brand" : "faint");
    }

    /** One task as a row: its box, its title, and what it says of itself on the right. */
    public static FrameworkElement TaskRow(PersonalTask task, Moment now, Dictionary<string, string>? courses, Dictionary<string, int>? tones, Action<PersonalTask> open)
    {
        var campus = Campus.Shared;
        var row = new Grid { ColumnSpacing = 10, MinHeight = 46, BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 0, 0, 1) };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); row.ColumnDefinitions.Add(new ColumnDefinition());
        row.Children.Add(Kit.Check(task.Done is not null, task.Priority ?? 0, () => campus.Tasks.Toggle(task)));
        var main = new Grid { ColumnSpacing = 10, Padding = new Thickness(0, 11, 4, 11) };
        main.ColumnDefinitions.Add(new ColumnDefinition()); main.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var title = Kit.Text(task.Title, Role.Body, task.Done is null ? "ink" : "faint"); if (task.Done is not null) title.TextDecorations = TextDecorations.Strikethrough;
        main.Children.Add(title);
        var meta = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        if (task.Course is { } c && courses?.GetValueOrDefault(c) is { } name)
        {
            var tone = tones is not null && tones.TryGetValue(c, out var t) ? t : (int?)null;
            meta.Children.Add(new Border { CornerRadius = new CornerRadius(4), Padding = new Thickness(6, 1, 6, 2), Background = tone is { } a ? Paint.Tone(a, "bg") : Paint.Brush("surfaceSunken"),
                Child = new TextBlock { Text = Names.CourseShort(name), FontSize = 12, Foreground = tone is { } b ? Paint.Tone(b, "fg") : Paint.Brush("muted") } });
        }
        var steps = campus.Tasks.Live.Where(s => s.Parent == task.Id).ToList();
        if (steps.Count > 0) meta.Children.Add(Kit.Line(3, Kit.Icon("M3,4.5 L4.2,5.7 L6.5,3.5 M3,10.5 L4.2,11.7 L6.5,9.5 M9,5 H13 M9,11 H13", 13, "faint"), Kit.Text($"{steps.Count(s => s.Done is not null)}/{steps.Count}", Role.Caption, "faint")));
        if (task.Note is not null) meta.Children.Add(Kit.Icon(Icons.Note, 13, "faint"));
        if (task.Remind?.Count > 0 || task.Due?.Remind?.Count > 0) meta.Children.Add(Kit.Icon(Icons.Bell, 13, "faint"));
        var (when, toneName) = WhenOf(task, now);
        if (when.Length > 0) { var w = Kit.Text(when, Role.Label, toneName); w.FontSize = 13; meta.Children.Add(w); }
        Grid.SetColumn(meta, 1); main.Children.Add(meta);
        var tap = new Tap(Paint.Clear, null) { Content = main };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(tap, task.Title);
        tap.Click += (_, _) => open(task);
        Grid.SetColumn(tap, 1); row.Children.Add(tap);
        var outer = new Grid { Background = Paint.Brush("paper") }; outer.Children.Add(row);
        outer.PointerEntered += (_, _) => outer.Background = Paint.Faded("surfaceSunken", .55);
        outer.PointerExited += (_, _) => outer.Background = Paint.Brush("paper");
        return outer;
    }

    public static FrameworkElement Make(Campus campus, CampusLine line, Moment now, Action<PersonalTask> openTask, Action<LineEvent> open)
    {
        var page = new StackPanel { MaxWidth = 760, HorizontalAlignment = HorizontalAlignment.Stretch };
        var courses = TaskSheet.CourseNames(line);
        var tones = CourseTones.Of(line);
        var top = campus.Tasks.Live.Where(t => t.Parent is null).ToList();
        var open_ = top.Where(t => t.Done is null).Order(TaskRules.Order).ToList();
        var done = top.Where(t => t.Done is not null).OrderByDescending(t => t.Done, StringComparer.Ordinal).ToList();
        var exams = line.Exams.Where(x => string.CompareOrdinal(x.Date, Clock.Text(now.Date)) >= 0).OrderBy(x => x.Date, StringComparer.Ordinal).ThenBy(x => x.Start, StringComparer.Ordinal).ToList();
        var adder = TaskSheet.Adder(campus, line, now, _ => { }, open_.Count == 0); adder.Margin = new Thickness(0, 0, 0, 16);
        page.Children.Add(adder);
        string ExamGroup(Exam x) { var days = Clock.Parse(x.Date).DayNumber - now.Date.DayNumber; return days == 0 ? "today" : days == 1 ? "tomorrow" : days <= 7 ? "week" : "later"; }
        for (var g = 0; g < TaskRules.Groups.Length; g++)
        {
            var key = TaskRules.Groups[g];
            var tasks = open_.Where(t => TaskRules.Group(t, now) == key).ToList();
            var dated = key is "overdue" or "someday" ? [] : exams.Where(x => ExamGroup(x) == key).ToList();
            if (tasks.Count == 0 && dated.Count == 0) continue;
            var shut = Folded.Contains(key);
            var arrow = Kit.Icon(Icons.Chevron, 12, key == "overdue" ? "danger" : "muted"); arrow.RenderTransformOrigin = new Windows.Foundation.Point(.5, .5);
            arrow.RenderTransform = new Microsoft.UI.Xaml.Media.RotateTransform { Angle = shut ? 0 : 90 };
            var count = Kit.Text((tasks.Count + dated.Count).ToString(), Role.Label, "faint");
            var headRow = new Grid { ColumnSpacing = 6, Padding = new Thickness(0, 18, 0, 6) };
            headRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); headRow.ColumnDefinitions.Add(new ColumnDefinition()); headRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            arrow.VerticalAlignment = VerticalAlignment.Center; headRow.Children.Add(arrow);
            var name = Kit.Text(TaskRules.GroupNames[g], Role.Label, key == "overdue" ? "danger" : "muted", bold: true); name.FontSize = 13; Grid.SetColumn(name, 1); headRow.Children.Add(name);
            Grid.SetColumn(count, 2); headRow.Children.Add(count);
            var head = new Tap { Content = headRow };
            var k = key; head.Click += (_, _) => { if (!Folded.Remove(k)) Folded.Add(k); Redraw(); };
            page.Children.Add(head);
            if (shut) continue;
            foreach (var exam in dated)
            {
                var tag = new Border { Background = Paint.Brush("exam"), CornerRadius = new CornerRadius(4), Padding = new Thickness(5, 0, 5, 1), VerticalAlignment = VerticalAlignment.Center, Child = new TextBlock { Text = "考试", FontSize = 11.5, FontWeight = FontWeights.SemiBold, Foreground = Paint.Brush("onExam") } };
                var row = new Grid { ColumnSpacing = 10, MinHeight = 46, Padding = new Thickness(4, 0, 4, 0), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 0, 0, 1) };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); row.ColumnDefinitions.Add(new ColumnDefinition()); row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                row.Children.Add(tag);
                var title = Kit.Text(Names.Course(exam.Course.Name), Role.Body); title.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(title, 1); row.Children.Add(title);
                var when = Kit.Text($"{Clock.DayWord(exam.Date, now.Date)} {exam.Start} · {(exam.Room is not null ? Names.Room(exam.Room) : exam.Location)}", Role.Label, key == "today" ? "brand" : "faint"); when.FontSize = 13; when.VerticalAlignment = VerticalAlignment.Center;
                Grid.SetColumn(when, 2); row.Children.Add(when);
                var tap = new Tap(Paint.Brush("paper"), Paint.Faded("surfaceSunken", .55)) { Content = row };
                var x = exam; tap.Click += (_, _) => { if (line.On(Clock.Parse(x.Date)).FirstOrDefault(e => e.Exam?.Id == x.Id) is { } e) open(e); };
                page.Children.Add(tap);
            }
            foreach (var task in tasks) page.Children.Add(TaskRow(task, now, courses, tones, openTask));
        }
        if (open_.Count == 0 && exams.Count == 0) page.Children.Add(Pages.Empty("没有要做的事。在上面输入一件，回车就加上了。"));
        if (done.Count > 0)
        {
            var head = new Tap { Content = Kit.Line(6, Kit.Text($"已完成 {done.Count} 项", Role.Label, "muted", bold: true), Kit.Icon(Icons.Chevron, 12, "muted")), Padding = new Thickness(0, 20, 0, 6) };
            head.Click += (_, _) => { showDone = !showDone; Redraw(); };
            page.Children.Add(head);
            if (showDone) foreach (var task in done) page.Children.Add(TaskRow(task, now, courses, tones, openTask));
        }
        return page;
    }

    private static void Redraw() => Campus.Shared.Touch();
}
