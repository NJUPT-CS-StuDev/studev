// The list on the desktop: the app's 清单 as a glance. 今天 is what is late and what falls in the coming week, in the
// list's own groups, with the exams among them; 全部 is every open task. One line adds a task as the task sheet reads
// it; from 今天 a task given no day is for today.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using StuDev.Me;
using StuDev.Ui;
using StuDev.World;

namespace StuDev.Widgets;

public sealed partial class ListWidget(string id) : DeskWidget(id)
{
    private TextBox? adder;
    protected override string Kind => "list";
    protected override (string Key, string Name)[] Views => [("today", "今天"), ("all", "全部")];

    protected override FrameworkElement Under()
    {
        adder = new TextBox { PlaceholderText = "添加任务", BorderThickness = new Thickness(0), Padding = new Thickness(6, 7, 6, 7), FontSize = 14, MinHeight = 0 };
        foreach (var key in new[] { "TextControlBackground", "TextControlBackgroundPointerOver", "TextControlBackgroundFocused", "TextControlBorderBrush", "TextControlBorderBrushPointerOver", "TextControlBorderBrushFocused" })
            adder.Resources[key] = Paint.Clear;
        AutomationProperties.SetName(adder, "添加任务");
        adder.KeyDown += (_, e) => { if (e.Key == Windows.System.VirtualKey.Enter) { Add(); e.Handled = true; } };
        var plus = Kit.Icon("M10 4v12M4 10h12", 14, "faint", 16); plus.VerticalAlignment = VerticalAlignment.Center;
        var row = new Grid { ColumnSpacing = 4, Padding = new Thickness(10, 0, 6, 0) };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); row.ColumnDefinitions.Add(new ColumnDefinition());
        row.Children.Add(plus); Grid.SetColumn(adder, 1); row.Children.Add(adder);
        return new Border { Child = row, Background = WashBrush("wash", .07), CornerRadius = new CornerRadius(8), Margin = new Thickness(12, 0, 12, 6) };
    }

    private void Add()
    {
        var campus = Campus.Shared;
        var text = adder!.Text.Trim();
        if (text.Length == 0 || campus.Line is not { } line) return;
        var now = Moment.Now();
        var parsed = QuickTasks.Parse(text, now, Timetable.TaskSheet.QuickCourses(line));
        if (parsed.Title.Length == 0) return;
        var due = parsed.Due ?? (parsed.Date is null && View == "today" ? new Deadline(Clock.Text(now.Date)) : null);
        campus.Tasks.Put(new PersonalTask { Id = TaskRules.NewId(), Title = parsed.Title, Modified = "", Date = parsed.Date, Start = parsed.Start, End = parsed.End, Due = due, Priority = parsed.Priority, Course = parsed.Course, Order = -DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() });
        adder.Text = "";
    }

    protected override void Draw(Campus campus, CampusLine line, Moment now)
    {
        var all = View == "all";
        var tasks = all ? campus.Tasks.Live.Where(t => t.Parent is null && t.Done is null).ToList() : Glance.Due(line, now);
        // Exams sit in the group of their day: today's among today's tasks, the coming ones where they fall.
        var exams = (all ? line.Exams.Select(x => Clock.Parse(x.Date)).Where(d => d >= now.Date).Distinct().Order()
                : Enumerable.Range(0, Glance.ExamDays + 1).Select(i => now.Date.AddDays(i)))
            .SelectMany(d => line.On(d).Where(e => e.Kind == "exam" && (d > now.Date || e.End > now.Min))).ToList();
        string ExamGroup(LineEvent e) { var days = e.Date.DayNumber - now.Date.DayNumber; return days == 0 ? "today" : days == 1 ? "tomorrow" : days < 7 ? "week" : "later"; }
        var shown = false;
        for (var g = 0; g < TaskRules.Groups.Length; g++)
        {
            var key = TaskRules.Groups[g];
            var group = tasks.Where(t => TaskRules.Group(t, now) == key).Order(TaskRules.Order).ToList();
            var dated = exams.Where(e => ExamGroup(e) == key).ToList();
            if (group.Count == 0 && dated.Count == 0) continue;
            Section(TaskRules.GroupNames[g]);
            foreach (var exam in dated) ExamRow(line, exam, now);
            foreach (var task in group) TaskRow(campus, task, now);
            shown = true;
        }
        if (!shown) Empty(all ? "没有待办，在上面写下一件吧" : "这一周没有要做的事");
    }

    private void TaskRow(Campus campus, PersonalTask task, Moment now)
    {
        var box = Kit.Check(false, task.Priority ?? 0, () => campus.Tasks.Toggle(task));
        box.HorizontalAlignment = HorizontalAlignment.Left; box.Margin = new Thickness(-6, 0, 0, 0);
        TextBlock? when = null;
        if (TaskRules.When(task) is { } at)
        {
            var date = Clock.Parse(at.Date);
            var late = TaskRules.Group(task, now) == "overdue";
            // A plan is said by when it starts, a deadline by its time, a day alone by the day.
            int? minute = task.Date == at.Date && task.Start is { } start ? start : at.Time < 1440 ? at.Time : null;
            when = Words($"{Clock.DayWord(date, now.Date)}{(minute is { } m ? $" {Clock.Hm(m)}" : "")}", late ? "danger" : "brand");
        }
        var aside = task.Course is { } course && campus.Line is { } line && Timetable.TaskSheet.CourseNames(line).GetValueOrDefault(course) is { } name ? Names.CourseShort(name) : null;
        Row(box, task.Title, aside, when, () => TaskDetail(campus, task, now));
    }

    private void ExamRow(CampusLine line, LineEvent e, Moment now)
    {
        var days = e.Date.DayNumber - now.Date.DayNumber;
        var tag = new Border { Background = Paint.Brush("exam"), CornerRadius = new CornerRadius(4), Padding = new Thickness(4, 0, 4, 1), VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Left,
            Child = new TextBlock { Text = "考", FontSize = 11, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = Paint.Brush("onExam") } };
        var when = Words(days == 0 ? $"今天 {Clock.Hm(e.Start)}" : days == 1 ? $"明天 {Clock.Hm(e.Start)}" : days < 7 ? $"{Clock.DayWord(e.Date, now.Date)} {Clock.Hm(e.Start)}" : $"{days} 天后", days <= 3 ? "danger" : "muted");
        Row(tag, e.Name, e.Room is not null ? Names.Room(e.Room) : null, when, () => EventDetail(e, now));
    }
}
