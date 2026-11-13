// One day: what is next, the week as a strip of days, what is due, then the day's hours with everything at its own
// time and the free stretches between said with a way to the free rooms. src/campus/timetable/views/DayView.tsx.
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Shapes;
using StuDev.Ui;
using StuDev.World;

namespace StuDev.Timetable;

public static class DayView
{
    public static FrameworkElement Make(CampusLine line, DateOnly day, Moment now, Action<LineEvent> open, Action<PersonalTask> openTask, Action<DateOnly> pick)
    {
        var page = new StackPanel();
        var monday = Clock.WeekStart(day);
        var today = day == now.Date;
        var events = line.On(day);
        var tones = CourseTones.Of(line);
        if (today && Next(line, now) is { } next) page.Children.Add(next);

        var strip = new Grid { Margin = new Thickness(0, 0, 0, 14) };
        for (var i = 0; i < 7; i++)
        {
            strip.ColumnDefinitions.Add(new ColumnDefinition());
            var date = monday.AddDays(i);
            var cell = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            var name = Kit.Text(Clock.Weekdays[i + 1][1..], Role.Caption, "faint"); name.FontSize = 11.5; name.HorizontalAlignment = HorizontalAlignment.Center;
            var number = Kit.Text(date.Day.ToString(), Role.Body, date == now.Date ? "brand" : "ink", bold: date == now.Date); number.HorizontalAlignment = HorizontalAlignment.Center;
            cell.Children.Add(name); cell.Children.Add(number);
            var face = new Grid(); face.Children.Add(cell);
            if (line.Exams.Any(x => x.Date == Clock.Text(date))) face.Children.Add(new Ellipse { Width = 4, Height = 4, Fill = Paint.Brush("exam"), VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, 0, 3) });
            var tap = new Tap(date == day ? Paint.Brush("surfaceSunken") : Paint.Clear, date == day ? null : Paint.Faded("surfaceSunken", .6)) { Content = face, Height = 48, CornerRadius = new CornerRadius(8), Margin = new Thickness(2, 0, 2, 0) };
            AutomationProperties.SetName(tap, $"{Clock.Weekdays[i + 1]} {date.Day}");
            var chosen = date; tap.Click += (_, _) => pick(chosen);
            Grid.SetColumn(tap, i); strip.Children.Add(tap);
        }
        page.Children.Add(strip);

        var due = line.DueOn(day);
        if (due.Count > 0)
        {
            page.Children.Add(Pages.Section($"{(today ? "今天" : Clock.DateLabel(day))}截止"));
            foreach (var task in due) page.Children.Add(ListView.TaskRow(task, now, null, null, openTask));
            page.Children.Add(new Border { Height = 14 });
        }
        if (events.Count == 0)
        {
            if (due.Count == 0) page.Children.Add(Pages.Empty(line.Holidays.GetValueOrDefault(day) ?? "这一天没有安排"));
            return page;
        }
        var gone = today ? events.Where(e => e.End <= now.Min).ToList() : [];
        var live = today ? events.Where(e => e.End > now.Min).ToList() : events;
        if (gone.Count > 0) { var g = Kit.Text($"已结束 {gone.Count} 项 · {string.Join("、", gone.Select(e => e.Short))}", Role.Label, "faint"); g.Margin = new Thickness(0, 0, 0, 12); page.Children.Add(g); }
        if (live.Count == 0) { page.Children.Add(Pages.Empty("今天的课都上完了")); return page; }

        // The campus day opens with the first period; "now" joins the hours only within the hour before the first thing.
        var opens = Clock.Minutes(line.Periods[0].Start);
        var awake = today && now.Min >= Math.Min(opens, live[0].Start) - 60;
        var free = Math.Max(now.Min, opens);
        var from = (awake ? Math.Min(now.Min, live[0].Start) : live[0].Start) - 14;
        var to = Math.Max(live.Max(e => e.End) + 24, awake ? now.Min + 20 : 0);
        double Y(double minutes) => Math.Round(minutes - from);

        var hours = new Grid { Height = Y(to) };
        hours.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(48) });
        hours.ColumnDefinitions.Add(new ColumnDefinition());
        var side = new Lane { Height = Y(to) }; var lane = new Lane { Height = Y(to) };
        Grid.SetColumn(lane, 1); hours.Children.Add(side); hours.Children.Add(lane);
        for (var time = (int)Math.Ceiling(from / 60.0) * 60; time <= to; time += 60)
        {
            lane.Mark(new Rectangle { Height = 1, Fill = Paint.Brush("line") }, Y(time) + .5);
            if (!(awake && Math.Abs(time - now.Min) < 16)) { var h = Kit.Text($"{time / 60}:00", Role.Caption, "faint"); h.FontSize = 11.5; h.HorizontalAlignment = HorizontalAlignment.Right; h.Margin = new Thickness(0, 0, 8, 0); side.Mark(h, Y(time)); }
        }
        void Gap(int start, int end)
        {
            var words = Kit.Line(4, Kit.Text($"空 {Clock.Duration(end - start)} · 看这时的空教室", Role.Label, "muted"), Kit.Icon(Icons.Chevron, 13, "muted"));
            var tap = new Tap(Paint.Brush("paper"), Paint.Brush("surfaceSunken")) { Content = words, Padding = new Thickness(8, 3, 8, 3), CornerRadius = new CornerRadius(6), HorizontalAlignment = HorizontalAlignment.Left };
            tap.Click += (_, _) => App.Open("search", ("rooms", new Moment(day, start)));
            lane.Put(tap, Y((start + end) / 2.0) - 13, 26, 10, 0);
        }
        if (awake && live[0].Start - free >= 45) Gap(free, live[0].Start);
        foreach (var (e, under, over) in CampusLine.Layers(live, line.Order))
        {
            var look = Tiles.LookOf(e, CourseTones.ToneOf(e, tones, line.CourseMeetings), false);
            var note = $"{Clock.Hm(e.Start)}–{Clock.Hm(e.End)}{(e.Lab is { } lab ? $" · {lab.Project}" : "")}{(e.Room is not null ? $" · {Names.Room(e.Room)}" : "")}";
            var tile = Tiles.Make(look, e.Name, note, 14.5, 12.5, () => open(e), over == 0 ? under : 0, $"同时段另有 {under} 项");
            lane.Put(tile, Y(e.Start) + 1, Math.Max(40, Y(e.End) - Y(e.Start) - 2), 0, under * 8);
        }
        var runs = CampusLine.Clusters(live, line.Order);
        for (var i = 0; i + 1 < runs.Count; i++)
        {
            var start = Math.Max(today ? Math.Max(runs[i].End, now.Min) : runs[i].End, opens);
            if (runs[i + 1].Start - start >= 30 && runs[i + 1].Start - runs[i].End >= 45) Gap(start, runs[i + 1].Start);
        }
        if (awake)
        {
            lane.Mark(WeekView.NowLine(), Y(now.Min));
            var label = new Border { Background = Paint.Brush("paper"), Child = new TextBlock { Text = Clock.Hm(now.Min), FontSize = 11.5, FontWeight = FontWeights.SemiBold, Foreground = Paint.Brush("now"), HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 0, 6, 0) } };
            side.Mark(label, Y(now.Min));
        }
        page.Children.Add(hours);
        return page;
    }

    /** What comes next: on now or how soon, where, and the way there. */
    private static FrameworkElement? Next(CampusLine line, Moment now)
    {
        if (line.Next(now) is not { } e) return null;
        var today = e.Date == now.Date;
        var during = today && e.Start <= now.Min;
        var caption = during ? $"正在上，到 {Clock.Hm(e.End)}" : today ? $"下一节 · 还有 {Clock.Duration(e.Start - now.Min)}" : $"下一节 · {(e.Date.DayNumber - now.Date.DayNumber == 1 ? "明天" : Clock.DateLabel(e.Date))}";
        var words = Kit.Column(2, Kit.Text(caption, Role.Caption, "muted"), Kit.Text($"{Clock.Hm(e.Start)} {e.Name}", Role.Heading), Kit.Text(e.Room is not null ? Names.Room(e.Room) : "课表没写地点", Role.Label, "muted"));
        ((TextBlock)words.Children[0]).FontSize = 12.5;
        var upcoming = line.Exams.Where(x => string.CompareOrdinal(x.Date, Clock.Text(now.Date)) >= 0).OrderBy(x => x.Date, StringComparer.Ordinal).ThenBy(x => x.Start, StringComparer.Ordinal).ToList();
        if (upcoming.Count > 0)
        {
            var first = upcoming[0].Date; var days = Clock.Parse(first).DayNumber - now.Date.DayNumber;
            var tag = new Border { Background = Paint.Brush("exam"), CornerRadius = new CornerRadius(4), Padding = new Thickness(5, 0, 5, 1), Child = new TextBlock { Text = "考试", FontSize = 11.5, FontWeight = FontWeights.SemiBold, Foreground = Paint.Brush("onExam") } };
            var said = Kit.Text($"{(days == 0 ? "今天" : days == 1 ? "明天" : $"{days} 天后")} {string.Join("、", upcoming.Where(x => x.Date == first).Select(x => $"{Names.Course(x.Course.Name)} {x.Start}"))}", Role.Label);
            var row = Kit.Line(6, tag, said); row.Margin = new Thickness(0, 8, 0, 0);
            words.Children.Add(row);
        }
        var grid = new Grid { ColumnSpacing = 16, Padding = new Thickness(0, 0, 0, 18), Margin = new Thickness(0, 0, 0, 18), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 0, 0, 1) };
        grid.ColumnDefinitions.Add(new ColumnDefinition()); grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.Children.Add(words);
        if (Names.Placed(e.Room))
        {
            var go = Kit.Action("去这里", () => App.Open("map", ("nav", e.Room!)), go: true); go.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetColumn(go, 1); grid.Children.Add(go);
        }
        return grid;
    }
}
