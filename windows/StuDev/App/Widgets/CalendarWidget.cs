// The calendar on the desktop: the app's time views as a glance. 日 is a day's lessons, labs, exams and planned tasks
// with what is on now; 周 is the week as a small timetable in the courses' colours; 学期 is the term as weeks of days,
// heavier where there are more lessons, marked where exams fall. The arrows step through days or weeks; a day in the
// term opens it as 日.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using StuDev.Ui;
using StuDev.World;

namespace StuDev.Widgets;

public sealed partial class CalendarWidget : DeskWidget
{
    /** Days or weeks away from the one a glance would show; zero follows the glance as time passes. */
    private int offset;
    private DateOnly? picked;
    protected override string Kind => "calendar";
    protected override (string Key, string Name)[] Views => [("day", "日"), ("week", "周"), ("term", "学期")];

    public CalendarWidget(string id) : base(id)
    {
        var next = Tool("m8 5 5 5-5 5", "往后", _ => Step(1));
        var back = Tool("m12 5-5 5 5 5", "往前", _ => Step(-1));
        var today = Tool("M10 6v4l3 2M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14", "回到现在", _ => { offset = 0; picked = null; Redraw(); });
        tools.Children.Insert(0, back); tools.Children.Insert(1, today); tools.Children.Insert(2, next);
    }

    protected override void Moved() { offset = 0; picked = null; }
    private void Step(int by) { if (View == "term") return; offset += by; Redraw(); }

    private DateOnly DayShown(CampusLine line, Moment now) => picked?.AddDays(offset) ?? (offset == 0 ? Glance.Day(line, now).Date : now.Date.AddDays(offset));
    private DateOnly WeekShown(CampusLine line, Moment now) => (picked is { } p ? Clock.WeekStart(p) : line.WeekShown(now)).AddDays(7 * offset);

    protected override string Subtitle(CampusLine? line, Moment now)
    {
        if (line is null) return base.Subtitle(line, now);
        switch (View)
        {
            case "day":
            {
                var day = DayShown(line, now);
                return $"{Clock.DayWord(day, now.Date)} · {Clock.DateLabel(day)}{(line.WeekOf(day) is { } w ? $" · 第 {w} 周" : "")}";
            }
            case "week":
            {
                var monday = WeekShown(line, now);
                return $"{(line.WeekOf(monday) is { } w ? $"第 {w} 周" : "假期")} · {Clock.DateLabel(monday)}–{Clock.DateLabel(monday.AddDays(6))}";
            }
            default: return line.WeekOf(now.Date) is { } week ? $"现在是第 {week} 周，共 {line.Term.Weeks.Count} 周" : $"共 {line.Term.Weeks.Count} 周";
        }
    }

    protected override void Draw(Campus campus, CampusLine line, Moment now)
    {
        switch (View)
        {
            case "week": Week(line, now); break;
            case "term": Term(line, now); break;
            default: Day(campus, line, now); break;
        }
    }

    private void Day(Campus campus, CampusLine line, Moment now)
    {
        var date = DayShown(line, now);
        var events = offset == 0 && picked is null ? Glance.Day(line, now).Events : line.On(date).Where(e => e.Kind != "run" && e.Task?.Done is null).ToList();
        if (events.Count == 0) { Empty(line.Holidays.TryGetValue(date, out var why) ? $"{why}，没有课" : "这天没有安排"); return; }
        foreach (var e in events)
        {
            if (e.Task is { } task)
            {
                var box = Kit.Check(false, task.Priority ?? 0, () => campus.Tasks.Toggle(task));
                box.HorizontalAlignment = HorizontalAlignment.Left; box.Margin = new Thickness(-6, 0, 0, 0);
                Row(box, task.Title, null, Words(Clock.Hm(e.Start), "muted"), () => TaskDetail(campus, task, now));
                continue;
            }
            var during = e.Date == now.Date && e.Start <= now.Min && now.Min < e.End;
            var soon = e.Date == now.Date && e.Start > now.Min && e.Start - now.Min <= 30;
            var when = during ? Words($"还有 {Clock.Duration(e.End - now.Min)}", "brand")
                : soon ? Words($"{Clock.Duration(e.Start - now.Min)}后", "brand")
                : Words(e.Kind == "exam" ? $"考试 {Clock.Hm(e.Start)}" : $"{Clock.Hm(e.Start)}", e.Kind == "exam" ? "exam" : "muted");
            Row(Bar(ToneOf(line, e)), e.Short.Length > 0 ? e.Short : e.Name, e.Room is not null ? Names.Room(e.Room) : null, when, () => EventDetail(e, now));
        }
    }

    /** The week as a small timetable: a column a day, blocks placed by time, the front of what overlaps named. */
    private void Week(CampusLine line, Moment now)
    {
        var monday = WeekShown(line, now);
        var days = Enumerable.Range(0, 7).Select(i => monday.AddDays(i)).Select(d => (Date: d, Events: line.On(d).Where(e => e.Kind != "run" && e.Task?.Done is null).ToList()))
            .Where(d => Clock.Weekday(d.Date) <= 5 || d.Events.Count > 0).ToList();
        var all = days.SelectMany(d => d.Events).ToList();
        if (all.Count == 0) { Empty("这周没有安排"); return; }
        var first = Math.Min(8 * 60, all.Min(e => e.Start)) / 60 * 60;
        var last = Math.Max(17 * 60, all.Max(e => e.End));
        const double perMinute = .62;
        var height = (last - first) * perMinute;
        var grid = new Grid { Margin = new Thickness(12, 2, 12, 0), ColumnSpacing = 3 };
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(height) });
        foreach (var (date, events) in days)
        {
            var column = grid.ColumnDefinitions.Count;
            grid.ColumnDefinitions.Add(new ColumnDefinition());
            var isToday = date == now.Date;
            var due = line.DueOn(date).Count(t => t.Done is null);
            var label = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 0, 0, 6) };
            label.Children.Add(new TextBlock { Text = Clock.Weekdays[Clock.Weekday(date)][1..], FontSize = 11.5, HorizontalAlignment = HorizontalAlignment.Center, Foreground = Paint.Brush(isToday ? "brand" : "muted") });
            label.Children.Add(new Border
            {
                Width = 24, Height = 24, CornerRadius = new CornerRadius(12), HorizontalAlignment = HorizontalAlignment.Center, Background = isToday ? Paint.Brush("brand") : Paint.Clear,
                Child = new TextBlock { Text = date.Day.ToString(), FontSize = 13, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Foreground = Paint.Brush(isToday ? "onBrand" : "ink") },
            });
            label.Children.Add(new Border { Width = 4, Height = 4, CornerRadius = new CornerRadius(2), Margin = new Thickness(0, 3, 0, 0), HorizontalAlignment = HorizontalAlignment.Center, Background = due > 0 ? Paint.Brush("danger") : Paint.Clear });
            Grid.SetColumn(label, column); grid.Children.Add(label);
            var lane = new Canvas { Background = isToday ? WashBrush("today", .04) : Paint.Clear };
            lane.SizeChanged += (_, e) => { foreach (var child in lane.Children.OfType<FrameworkElement>()) child.Width = e.NewSize.Width; };
            foreach (var run in CampusLine.Clusters(events, line.Order))
            {
                var e = run.Front;
                var tone = CourseTones.ToneOf(e, CourseTones.Of(line), line.CourseMeetings) ?? 0;
                var exam = e.Kind == "exam"; var past = date < now.Date || date == now.Date && run.End <= now.Min;
                var name = new TextBlock { Text = (e.Short.Length > 0 ? e.Short : e.Name) + (run.Events.Count > 1 ? $" +{run.Events.Count - 1}" : ""), FontSize = 11, TextWrapping = TextWrapping.WrapWholeWords, TextTrimming = TextTrimming.CharacterEllipsis, MaxLines = 3,
                    Foreground = exam ? Paint.Brush("onExam") : Paint.Tone(tone, "fg"), Margin = new Thickness(4, 3, 3, 2) };
                var block = new Tap(exam ? Paint.Brush("exam") : past ? Paint.ToneFaded(tone, "bg", .55) : Paint.Tone(tone, "bg"), null)
                {
                    Content = name, CornerRadius = new CornerRadius(5), BorderThickness = new Thickness(1), BorderBrush = exam ? Paint.Brush("exam") : Paint.Tone(tone, "border"),
                    Height = Math.Max(18, (run.End - run.Start) * perMinute - 2), Opacity = past ? .6 : 1,
                };
                AutomationProperties.SetName(block, $"{Clock.Weekdays[Clock.Weekday(date)]} {Clock.Hm(e.Start)} {e.Name}");
                var shown = e; block.Click += (_, _) => EventDetail(shown, now);
                Canvas.SetTop(block, (run.Start - first) * perMinute);
                lane.Children.Add(block);
            }
            if (isToday && now.Min > first && now.Min < last)
            {
                var line_ = new Border { Height = 2, Background = Paint.Brush("now") };
                Canvas.SetTop(line_, (now.Min - first) * perMinute - 1);
                lane.Children.Add(line_);
            }
            Grid.SetColumn(lane, column); Grid.SetRow(lane, 1); grid.Children.Add(lane);
        }
        body.Children.Add(grid);
    }

    /** The term as weeks of days: a dot a day, heavier with more lessons; exams red, days off hollow, today ringed. */
    private void Term(CampusLine line, Moment now)
    {
        var weeks = Glance.Term(line);
        var heads = new Grid { Margin = new Thickness(14, 0, 14, 4), ColumnSpacing = 4 };
        heads.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(28) });
        for (var i = 1; i <= 7; i++)
        {
            heads.ColumnDefinitions.Add(new ColumnDefinition());
            var t = new TextBlock { Text = Clock.Weekdays[i][1..], FontSize = 11, Foreground = Paint.Brush("faint"), HorizontalAlignment = HorizontalAlignment.Center };
            Grid.SetColumn(t, i); heads.Children.Add(t);
        }
        body.Children.Add(heads);
        foreach (var week in weeks)
        {
            var current = week.Days.Any(d => d.Date == now.Date);
            var row = new Grid { Margin = new Thickness(10, 0, 10, 0), Padding = new Thickness(4, 3, 4, 3), ColumnSpacing = 4, CornerRadius = new CornerRadius(6), Background = current ? WashBrush("week", .06) : Paint.Clear };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(28) });
            var number = new TextBlock { Text = week.Week.ToString(), FontSize = 12, VerticalAlignment = VerticalAlignment.Center, Foreground = Paint.Brush(current ? "ink" : "faint"), FontWeight = current ? Microsoft.UI.Text.FontWeights.SemiBold : Microsoft.UI.Text.FontWeights.Normal };
            row.Children.Add(number);
            for (var i = 0; i < 7; i++)
            {
                row.ColumnDefinitions.Add(new ColumnDefinition());
                var day = week.Days[i];
                var past = day.Date < now.Date;
                var keep = day.Lessons switch { 0 => 0, <= 2 => .35, <= 4 => .6, _ => .9 };
                var fill = day.Exam ? Paint.Brush("exam") : day.Off || keep == 0 ? Paint.Clear : Paint.Faded("brand", keep);
                var dot = new Border
                {
                    Width = 20, Height = 20, CornerRadius = new CornerRadius(10), HorizontalAlignment = HorizontalAlignment.Center, Background = fill, Opacity = past ? .45 : 1,
                    BorderThickness = new Thickness(day.Date == now.Date ? 2 : day.Off ? 1 : 0), BorderBrush = day.Date == now.Date ? Paint.Brush("ink") : Paint.Brush("line"),
                };
                var tap = new Tap(Paint.Clear, WashBrush("hover", .08)) { Content = dot, CornerRadius = new CornerRadius(6), Padding = new Thickness(0, 2, 0, 2) };
                AutomationProperties.SetName(tap, $"第 {week.Week} 周 {Clock.Weekdays[i + 1]} {Clock.DateLabel(day.Date)}{(day.Exam ? " 有考试" : "")}{(day.Lessons > 0 ? $" {day.Lessons} 节" : "")}");
                var date = day.Date; tap.Click += (_, _) => { picked = date; offset = 0; SetViewKeepingDay(); };
                Grid.SetColumn(tap, i + 1); row.Children.Add(tap);
            }
            body.Children.Add(row);
        }
    }

    private void SetViewKeepingDay()
    {
        var keep = picked;
        SetView("day");
        picked = keep; Redraw();
    }
}
