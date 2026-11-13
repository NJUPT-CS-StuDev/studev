// One's own task. A new one starts as one line typed as one says it — 明天下午3点 交毛概作业 #毛概 !! — read back as it
// is typed; then the task's own sheet: its title edited where it stands, and in one row when it is planned, when it
// is due, how important it is and which course it is for, each opening its few choices in place; then its steps and
// a note. Everything is kept as it is changed. TaskSheet.tsx and ListView.tsx, natively.
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Documents;
using TextDecorations = Windows.UI.Text.TextDecorations;
using Microsoft.UI.Xaml.Controls;
using StuDev.Ui;
using StuDev.World;

namespace StuDev.Timetable;

public static class TaskSheet
{
    private static readonly (int Value, string Name)[] Priorities = [(0, "无"), (1, "低"), (2, "中"), (3, "高")];
    private static readonly int[] Durations = [15, 30, 60, 90, 120];

    public static List<QuickCourse> QuickCourses(CampusLine line) => line.Meetings
        .GroupBy(m => CourseTones.Identity(m.Course.Code, m.Course.Name))
        .Select(g => new QuickCourse(g.Key, [Names.Course(g.First().Course.Name), Names.CourseShort(g.First().Course.Name)])).ToList();
    public static Dictionary<string, string> CourseNames(CampusLine line) => line.Meetings
        .GroupBy(m => CourseTones.Identity(m.Course.Code, m.Course.Name))
        .ToDictionary(g => g.Key, g => line.CourseNames?.GetValueOrDefault(g.Key) ?? Names.Course(g.First().Course.Name));

    /** What one typed line was read as, said back before it is added. */
    public static List<string> ReadBack(QuickTask quick, Moment now, Dictionary<string, string> courses)
    {
        var said = new List<string>();
        if (quick.Date is { } date) said.Add($"{Clock.DayWord(date, now.Date)} {Clock.Hm(quick.Start!.Value)}{(quick.End is { } end ? $"–{Clock.Hm(end)}" : "")}");
        if (quick.Due is { } due) said.Add($"{Clock.DayWord(due.Date, now.Date)}{(due.Time is { } t ? $" {Clock.Hm(t)}" : "")} 截止");
        if (quick.Priority is int p and > 0) said.Add(new[] { "", "低优先级", "中优先级", "高优先级" }[p]);
        if (quick.Course is { } course) said.Add(Names.CourseShort(courses.GetValueOrDefault(course) ?? course));
        return said;
    }

    /** The line a task is added with, and what it was read as under it; Enter adds it. */
    public static FrameworkElement Adder(Campus campus, CampusLine line, Moment now, Action<PersonalTask> added, bool examples = true)
    {
        var courses = CourseNames(line); var quick = QuickCourses(line);
        var column = new StackPanel { Spacing = 8 };
        var box = Kit.Field("", "添加任务，如：明天下午3点 交毛概作业 #毛概 !!", "添加任务");
        var row = new Grid { ColumnSpacing = 8 };
        row.ColumnDefinitions.Add(new ColumnDefinition()); row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.Children.Add(box);
        var add = Kit.Action("添加", () => { }, go: true); add.Visibility = Visibility.Collapsed; Grid.SetColumn(add, 1); row.Children.Add(add);
        column.Children.Add(row);
        var read = new WrapRow { Gap = 6 };
        column.Children.Add(read);
        void Add()
        {
            if (box.Text.Trim().Length == 0) return;
            var parsed = QuickTasks.Parse(box.Text, now, quick);
            if (parsed.Title.Length == 0) return;
            // A task just added goes first in its group, where it is seen.
            var task = new PersonalTask { Id = TaskRules.NewId(), Title = parsed.Title, Modified = "", Date = parsed.Date, Start = parsed.Start, End = parsed.End, Due = parsed.Due, Priority = parsed.Priority, Course = parsed.Course, Order = -DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
            campus.Tasks.Put(task);
            box.Text = "";
            added(campus.Tasks.All.First(t => t.Id == task.Id));
        }
        add.Click += (_, _) => Add();
        void Read()
        {
            read.Children.Clear();
            var text = box.Text.Trim();
            add.Visibility = text.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
            if (text.Length == 0)
            {
                if (examples) foreach (var example in TaskRules.Examples) read.Children.Add(Chip(example, "muted", () => { box.Text = example; box.SelectionStart = example.Length; box.Focus(FocusState.Programmatic); }));
                return;
            }
            var parsed = QuickTasks.Parse(text, now, quick);
            var said = ReadBack(parsed, now, courses);
            if (said.Count == 0) { read.Children.Add(Kit.Text("没有读出日期，会放进“还没排日期”", Role.Caption, "faint")); return; }
            foreach (var item in said) read.Children.Add(Chip(item, "brand", null));
            var title = Kit.Text(parsed.Title, Role.Label, bold: true); title.VerticalAlignment = VerticalAlignment.Center; title.Margin = new Thickness(2, 0, 0, 0);
            read.Children.Add(title);
        }
        box.TextChanged += (_, _) => Read();
        box.KeyDown += (_, e) => { if (e.Key == Windows.System.VirtualKey.Enter) { Add(); e.Handled = true; } };
        Read();
        return column;
    }

    private static FrameworkElement Chip(string text, string colour, Action? act)
    {
        var words = Kit.Text(text, Role.Caption, colour); words.FontSize = 12.5;
        var ground = colour == "brand" ? Paint.Faded("brand", .1) : Paint.Brush("surfaceSunken");
        if (act is null) return new Border { Child = words, Background = ground, CornerRadius = new CornerRadius(6), Padding = new Thickness(8, 3, 8, 4) };
        var tap = new Tap(ground, Paint.Brush("line")) { Content = words, CornerRadius = new CornerRadius(6), Padding = new Thickness(8, 3, 8, 4) };
        tap.Click += (_, _) => act();
        return tap;
    }

    /** A new task: one line, then its own sheet. */
    public static void New(Campus campus, Moment now)
    {
        if (campus.Line is not { } line) return;
        var column = new StackPanel { Padding = new Thickness(20, 18, 16, 20), Spacing = 14 };
        column.Children.Add(Pages.SheetHead(Pages.SheetTitle("新任务"), () => App.Window?.Close()));
        var adder = Adder(campus, line, now, task => Open(campus, task.Id, now));
        adder.Margin = new Thickness(0, 0, 4, 0);
        column.Children.Add(adder);
        var hint = Kit.Text("说出日期和时间就安排上了，“前”是截止；#课程 归到一门课，! 越多越重要。", Role.Caption, "faint", wrap: true); hint.Margin = new Thickness(0, 0, 4, 0);
        column.Children.Add(hint);
        App.Window?.Sheet(column, 520);
    }

    public static void Open(Campus campus, string id, Moment now) => App.Window?.Sheet(Make(campus, id, now, null), 480);

    private static FrameworkElement Make(Campus campus, string id, Moment now, string? panel)
    {
        var line = campus.Line!;
        var task = campus.Tasks.All.First(t => t.Id == id);
        void Redraw(string? open = null) => App.Window?.Sheet(Make(campus, id, now, open), 480);
        void Save(PersonalTask next, string? open) { campus.Tasks.Put(next); Redraw(open); }
        var courses = CourseNames(line);

        var root = new StackPanel();
        var titleRow = new Grid { ColumnSpacing = 10 };
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); titleRow.ColumnDefinitions.Add(new ColumnDefinition());
        titleRow.Children.Add(Kit.Check(task.Done is not null, task.Priority ?? 0, () => { campus.Tasks.Toggle(task); Redraw(panel); }));
        var title = new TextBox { Text = task.Title, FontSize = 20, FontWeight = FontWeights.SemiBold, BorderThickness = new Thickness(0), Background = Paint.Clear, Padding = new Thickness(0, 2, 0, 2), TextWrapping = TextWrapping.Wrap };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(title, "任务");
        title.Resources["TextControlBackgroundFocused"] = Paint.Clear; title.Resources["TextControlBackgroundPointerOver"] = Paint.Clear; title.Resources["TextControlBorderBrushFocused"] = Paint.Clear;
        void Rename() { var text = title.Text.Trim(); if (text.Length > 0 && text != task.Title) campus.Tasks.Put(campus.Tasks.All.First(t => t.Id == id) with { Title = text }); else title.Text = task.Title; }
        title.LostFocus += (_, _) => Rename();
        title.KeyDown += (_, e) => { if (e.Key == Windows.System.VirtualKey.Enter) { Rename(); e.Handled = true; } };
        Grid.SetColumn(title, 1); titleRow.Children.Add(title);
        var head = new Border { Padding = new Thickness(16, 16, 16, 14), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 0, 0, 1), Child = Pages.SheetHead(titleRow, () => App.Window?.Close()) };
        var edge = new Grid(); edge.Children.Add(head); edge.Children.Add(new Border { Width = 3, Background = Paint.Brush("brand"), HorizontalAlignment = HorizontalAlignment.Left });
        root.Children.Add(edge);
        var body = new StackPanel { Padding = new Thickness(20, 14, 20, 20) };
        root.Children.Add(body);

        // The four things a task can say of itself, each a chip opening its choices.
        var late = task.Due is { } d0 && task.Done is null && (string.CompareOrdinal(d0.Date, Clock.Text(now.Date)) < 0 || d0.Date == Clock.Text(now.Date) && (d0.Time ?? 1440) <= now.Min);
        var plan = task.Date is { } pd ? $"{Clock.DayWord(pd, now.Date)} {Clock.Hm(task.Start!.Value)}{(task.End is { } pe ? $"–{Clock.Hm(pe)}" : "")}" : "安排时间";
        var due = task.Due is { } dd ? $"{Clock.DayWord(dd.Date, now.Date)}{(dd.Time is { } dt ? $" {Clock.Hm(dt)}" : "")} 截止" : "截止";
        var course = task.Course is { } c ? courses.GetValueOrDefault(c) : null;
        var chips = new WrapRow { Gap = 8, Margin = new Thickness(0, 0, 0, 12) };
        void Chip(string key, string text, bool set, string? colour = null)
        {
            var open = panel == key;
            var words = Kit.Text(text, Role.Label, open ? "brand" : colour ?? (set ? "ink" : "muted")); words.FontSize = 13.5;
            var tap = new Tap(Paint.Brush("paper"), Paint.Brush("surfaceSunken")) { Content = words, Padding = new Thickness(12, 5, 12, 6), CornerRadius = new CornerRadius(16), BorderThickness = new Thickness(1),
                BorderBrush = open ? Paint.Brush("brand") : colour == "danger" ? Paint.Brush("danger") : set ? Paint.Faded("ink", .3) : Paint.Brush("line") };
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(tap, text);
            tap.Click += (_, _) => Redraw(open ? null : key);
            chips.Children.Add(tap);
        }
        Chip("plan", plan, task.Date is not null);
        Chip("due", due, task.Due is not null, late ? "danger" : null);
        Chip("priority", task.Priority is > 0 ? $"{Priorities[task.Priority.Value].Name}优先级" : "优先级", task.Priority is > 0, task.Priority switch { 1 => null, 2 => "warning", 3 => "danger", _ => null });
        if (courses.Count > 0) Chip("course", course is not null ? Names.CourseShort(course) : "课程", course is not null);
        body.Children.Add(chips);

        var quickDays = QuickDays(now.Date);
        var duration = task.Start is { } s0 && task.End is { } e0 ? e0 - s0 : 30;
        StackPanel Panel() { var p = new StackPanel { Spacing = 8, Padding = new Thickness(12), Margin = new Thickness(0, 0, 0, 12), CornerRadius = new CornerRadius(12), Background = Paint.Brush("surfaceSunken") }; body.Children.Add(p); return p; }
        TextBlock Label(string text) { var t = Kit.Text(text, Role.Caption, "muted"); t.FontSize = 12.5; t.Margin = new Thickness(0, 4, 0, 0); return t; }
        List<int> Toggle(List<int>? list, int minutes) => list?.Contains(minutes) == true ? list.Where(v => v != minutes).ToList() : (list ?? []).Append(minutes).Order().ToList();

        if (panel == "plan")
        {
            var p = Panel();
            void PlanOn(string date) { var start = task.Start ?? 9 * 60; Save(task with { Date = date, Start = start, End = task.End ?? Math.Min(1440, start + duration) }, "plan"); }
            p.Children.Add(Kit.Picks([.. quickDays.Select(q => (UIElement)Kit.Pick(q.Name, task.Date == q.Date, () => PlanOn(q.Date))), DatePick(task.Date, PlanOn)]));
            if (task.Date is not null)
            {
                var times = new Grid { ColumnSpacing = 10 };
                times.ColumnDefinitions.Add(new ColumnDefinition()); times.ColumnDefinitions.Add(new ColumnDefinition());
                var start = TimeField(task.Start!.Value, "开始", minutes => Save(task with { Start = minutes!.Value, End = Math.Min(1440, minutes.Value + duration) }, "plan"));
                times.Children.Add(Kit.Column(4, Label("开始"), start));
                var lengths = new ComboBox { HorizontalAlignment = HorizontalAlignment.Stretch, MinHeight = 40 };
                var options = Durations.Append(duration).Distinct().Order().ToList();
                foreach (var minutes in options) lengths.Items.Add(minutes < 60 ? $"{minutes} 分钟" : $"{minutes / 60.0:0.#} 小时");
                lengths.SelectedIndex = options.IndexOf(duration);
                lengths.SelectionChanged += (_, _) => Save(task with { End = Math.Min(1440, task.Start!.Value + options[lengths.SelectedIndex]) }, "plan");
                Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(lengths, "用时");
                var right = Kit.Column(4, Label("用时"), lengths); Grid.SetColumn(right, 1); times.Children.Add(right);
                p.Children.Add(times);
                p.Children.Add(Label("提醒"));
                p.Children.Add(Kit.Picks([.. TaskRules.TimedReminders.Select(r => (UIElement)Kit.Pick(r.Name, task.Remind?.Contains(r.Minutes) == true, () => Save(task with { Remind = Toggle(task.Remind, r.Minutes) }, "plan")))]));
            }
            var slots = new StackPanel();
            var actions = new List<UIElement> { Kit.Pick("找一段空闲", false, () =>
            {
                slots.Children.Clear();
                var found = Planning.Available(line, new SlotRequest(Clock.Text(now.Date), Clock.Text(now.Date.AddDays(6)), duration, Exclude: task.Id, Due: task.Due), now).Take(6).ToList();
                if (found.Count == 0) slots.Children.Add(Kit.Text("截止前的七天里没有合适的空闲，可以缩短用时。", Role.Caption, "muted", wrap: true));
                foreach (var slot in found)
                    slots.Children.Add(Kit.Row("", Kit.Column(2, Kit.Text($"{Clock.DayWord(slot.Date, now.Date)} {Clock.Hm(slot.Start)}–{Clock.Hm(slot.End)}", Role.Label),
                        Kit.Text(slot.Penalty > 0 ? $"与 {slot.Clashes.Count} 项“尽量避开”的安排重叠" : "这段时间没有别的安排", Role.Caption, "muted")), () => Save(task with { Date = slot.Date, Start = slot.Start, End = slot.End }, null)));
            }) };
            if (task.Date is not null) actions.Add(Kit.Pick("不安排时间", false, () => Save(task with { Date = null, Start = null, End = null, Remind = null }, "plan")));
            p.Children.Add(Kit.Picks([.. actions]));
            p.Children.Add(slots);
        }
        if (panel == "due")
        {
            var p = Panel();
            void DueOn(string date) => Save(task with { Due = task.Due is null ? new(date) : task.Due with { Date = date } }, "due");
            p.Children.Add(Kit.Picks([.. quickDays.Select(q => (UIElement)Kit.Pick(q.Name, task.Due?.Date == q.Date, () => DueOn(q.Date))), DatePick(task.Due?.Date, DueOn)]));
            if (task.Due is { } dueSet)
            {
                var time = TimeField(dueSet.Time, "时间", minutes => Save(task with { Due = dueSet with { Time = minutes, Remind = null } }, "due"), true);
                time.Width = 120;
                var small = Kit.Text("留空就是当天结束前", Role.Caption, "faint"); small.VerticalAlignment = VerticalAlignment.Center;
                p.Children.Add(Kit.Line(8, Label("时间"), time, small));
                p.Children.Add(Label("提醒"));
                var options = dueSet.Time is not null ? TaskRules.TimedReminders : TaskRules.DayReminders;
                p.Children.Add(Kit.Picks([.. options.Select(r => (UIElement)Kit.Pick(r.Name, dueSet.Remind?.Contains(r.Minutes) == true, () => Save(task with { Due = dueSet with { Remind = Toggle(dueSet.Remind, r.Minutes) } }, "due")))]));
                p.Children.Add(Kit.Picks(Kit.Pick("不设截止", false, () => Save(task with { Due = null }, "due"))));
            }
        }
        if (panel == "priority")
            Panel().Children.Add(Kit.Picks([.. Priorities.Select(pr => (UIElement)Kit.Pick(pr.Name, (task.Priority ?? 0) == pr.Value, () => Save(task with { Priority = pr.Value == 0 ? null : pr.Value }, null)))]));
        if (panel == "course")
            Panel().Children.Add(Kit.Picks([Kit.Pick("不属于哪门课", task.Course is null, () => Save(task with { Course = null }, null)),
                .. courses.Select(kv => (UIElement)Kit.Pick(Names.CourseShort(kv.Value), task.Course == kv.Key, () => Save(task with { Course = kv.Key }, null)))]));

        // Its steps, each with its box; a new one typed at the end.
        foreach (var step in campus.Tasks.Live.Where(t => t.Parent == id))
        {
            var row = new Grid { ColumnSpacing = 10, MinHeight = 40, BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 0, 0, 1) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); row.ColumnDefinitions.Add(new ColumnDefinition()); row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var item = step;
            row.Children.Add(Kit.Check(step.Done is not null, 0, () => { campus.Tasks.Toggle(item); Redraw(panel); }));
            var words = Kit.Text(step.Title, Role.Body, step.Done is null ? "ink" : "faint"); words.VerticalAlignment = VerticalAlignment.Center; if (step.Done is not null) words.TextDecorations = TextDecorations.Strikethrough;
            Grid.SetColumn(words, 1); row.Children.Add(words);
            var drop = new Tap(Paint.Clear, Paint.Brush("surfaceSunken")) { Content = Kit.Icon(Icons.Cross, 12, "faint"), Width = 26, Height = 26, CornerRadius = new CornerRadius(6) };
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(drop, "删除步骤");
            drop.Click += (_, _) => { campus.Tasks.Delete(item.Id); Redraw(panel); };
            Grid.SetColumn(drop, 2); row.Children.Add(drop);
            body.Children.Add(row);
        }
        var next = Bare("+ 添加步骤", "添加步骤");
        next.KeyDown += (_, e) => { if (e.Key == Windows.System.VirtualKey.Enter && next.Text.Trim().Length > 0) { campus.Tasks.Put(new PersonalTask { Id = TaskRules.NewId(), Title = next.Text.Trim(), Parent = id, Modified = "" }); Redraw(panel); } };
        body.Children.Add(next);
        var note = Bare("备注", "备注"); note.Text = task.Note ?? ""; note.AcceptsReturn = true; note.TextWrapping = TextWrapping.Wrap; note.MinHeight = 72;
        note.LostFocus += (_, _) => { var text = note.Text.Trim(); if (text != (task.Note ?? "")) campus.Tasks.Put(campus.Tasks.All.First(t => t.Id == id) with { Note = text.Length > 0 ? text : null }); };
        body.Children.Add(new Border { BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 1, 0, 0), Child = note, Margin = new Thickness(0, 4, 0, 12) });

        var buttons = new Grid { ColumnSpacing = 8 };
        buttons.ColumnDefinitions.Add(new ColumnDefinition()); buttons.ColumnDefinitions.Add(new ColumnDefinition());
        var delete = Kit.Action("删除", () => { campus.Tasks.Delete(id); App.Window?.Close(); }, colour: "danger"); delete.HorizontalAlignment = HorizontalAlignment.Stretch;
        var done = Kit.Action(task.Done is not null ? "标为未完成" : "完成", () => { campus.Tasks.Toggle(task); if (task.Done is null) App.Window?.Close(); else Redraw(panel); }, go: true); done.HorizontalAlignment = HorizontalAlignment.Stretch;
        Grid.SetColumn(done, 1);
        buttons.Children.Add(delete); buttons.Children.Add(done);
        body.Children.Add(buttons);
        return root;
    }

    /** A text box with no box: a line one writes on (.tadd-step, .tnote). */
    private static TextBox Bare(string placeholder, string label)
    {
        var box = new TextBox { PlaceholderText = placeholder, FontSize = 14.5, BorderThickness = new Thickness(0), Background = Paint.Clear, Padding = new Thickness(0, 10, 0, 10), MinHeight = 40 };
        box.Resources["TextControlBackgroundFocused"] = Paint.Clear; box.Resources["TextControlBackgroundPointerOver"] = Paint.Clear; box.Resources["TextControlBorderBrushFocused"] = Paint.Clear;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(box, label);
        return box;
    }

    /** The days most often meant, as one taps them: today, tomorrow, the day after, this Friday, next Monday. */
    private static List<(string Name, string Date)> QuickDays(DateOnly today)
    {
        var weekday = Clock.Weekday(today);
        var friday = today.AddDays((5 - weekday + 7) % 7); var monday = today.AddDays(8 - weekday);
        var days = new List<(string, string)> { ("今天", Clock.Text(today)), ("明天", Clock.Text(today.AddDays(1))), ("后天", Clock.Text(today.AddDays(2))) };
        if (friday > today.AddDays(2)) days.Add(("周五", Clock.Text(friday)));
        days.Add(("下周一", Clock.Text(monday)));
        return days;
    }

    /** Any other day, from a calendar. */
    private static FrameworkElement DatePick(string? date, Action<string> pick)
    {
        var picker = new CalendarDatePicker { PlaceholderText = "其他日期", Height = 32, MinWidth = 120, FirstDayOfWeek = Windows.Globalization.DayOfWeek.Monday, DateFormat = "{month.integer}月{day.integer}日" };
        if (date is not null) picker.Date = new DateTimeOffset(Clock.Parse(date).ToDateTime(TimeOnly.MinValue));
        picker.DateChanged += (_, e) => { if (e.NewDate is { } at) pick(Clock.Text(DateOnly.FromDateTime(at.Date))); };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(picker, "日期");
        return picker;
    }

    /** A time typed as one says it on a clock: 9:30, 930, 21. */
    private static TextBox TimeField(int? minutes, string label, Action<int?> set, bool optional = false)
    {
        var box = Kit.Field(minutes is { } m ? Clock.Hm(m) : "", optional ? "当天结束" : "09:00", label);
        void Commit()
        {
            var text = box.Text.Trim().Replace('：', ':');
            if (text.Length == 0) { if (optional && minutes is not null) set(null); return; }
            var match = System.Text.RegularExpressions.Regex.Match(text, @"^(\d{1,2})(?::?(\d{2}))?$");
            if (!match.Success) { box.Text = minutes is { } back ? Clock.Hm(back) : ""; return; }
            var h = int.Parse(match.Groups[1].Value); var mm = match.Groups[2].Success ? int.Parse(match.Groups[2].Value) : 0;
            if (h > 23 || mm > 59) { box.Text = minutes is { } back ? Clock.Hm(back) : ""; return; }
            if (h * 60 + mm != minutes) set(h * 60 + mm);
        }
        box.LostFocus += (_, _) => Commit();
        box.KeyDown += (_, e) => { if (e.Key == Windows.System.VirtualKey.Enter) { Commit(); e.Handled = true; } };
        return box;
    }
}
