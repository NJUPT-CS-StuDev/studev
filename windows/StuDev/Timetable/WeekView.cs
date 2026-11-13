// The week: a column per day, the periods down the side, everything on at its own time, back to front so what is
// behind shows beside what is in front. src/campus/timetable/views/WeekView.tsx, drawn natively.
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Documents;
using TextDecorations = Windows.UI.Text.TextDecorations;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using StuDev.Data;
using StuDev.Ui;
using StuDev.World;

namespace StuDev.Timetable;

public static class WeekView
{
    /** How far each thing behind shows beside the one in front of it. */
    private const double Edge = 5;

    private static string Note(LineEvent e, bool wide) => e.Lab is { } lab
        ? $"{(wide ? "实验 · " : "")}{(lab.Room is not null ? Names.RoomShort(lab.Room) : Names.CompactPlace(lab.Short))}"
        : e.Room is not null ? (wide ? Names.Room(e.Room) : Names.RoomShort(e.Room)) : "";

    public static FrameworkElement Make(CampusLine line, DateOnly day, Moment now, bool wide, Action<LineEvent> open, Action<PersonalTask> openTask)
    {
        var monday = Clock.WeekStart(day);
        var days = Enumerable.Range(0, 7).Select(i => monday.AddDays(i)).ToList();
        var week = line.WeekOf(monday);
        var events = days.Select(line.On).ToList();
        var dues = days.Select(line.DueOn).ToList();
        var tones = CourseTones.Of(line);
        var hints = week is { } w ? line.OffWeek(w) : [];
        var columns = wide ? 7 : 5;
        for (var i = 0; i < 7; i++) if (events[i].Count > 0 || dues[i].Count > 0 || hints.Any(h => h.Weekday == i + 1)) columns = Math.Max(columns, i + 1);
        var clock = line.Periods.ToDictionary(p => p.Period, p => (Start: Clock.Minutes(p.Start), End: Clock.Minutes(p.End)));
        var scale = wide ? 1.02 : .8;
        var (from, until) = CampusLine.TimeBounds(events.SelectMany(e => e));
        double Y(int minutes) => Math.Round((minutes - from) * scale);
        var height = Y(until);
        var thisWeek = days.Contains(now.Date);
        var axis = wide ? 68 : 40;

        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(axis) });
        for (var i = 0; i < columns; i++) grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var anyDue = dues.Take(columns).Any(d => d.Count > 0);
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        if (anyDue) grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(height) });
        var bodyRow = anyDue ? 2 : 1;

        void Place(FrameworkElement element, int row, int column) { Grid.SetRow(element, row); Grid.SetColumn(element, column); grid.Children.Add(element); }
        Place(new Border { BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 0, 1, 1) }, 0, 0);

        for (var i = 0; i < columns; i++)
        {
            var date = days[i];
            var today = date == now.Date;
            var head = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center, Padding = new Thickness(0, 10, 0, 8) };
            var name = Kit.Text(Clock.Weekdays[i + 1], Role.Label, today ? "brand" : "ink", bold: true); name.FontSize = 13; name.HorizontalAlignment = HorizontalAlignment.Center;
            var sub = Kit.Text(line.Holidays.GetValueOrDefault(date) ?? $"{date.Month}/{date.Day}", Role.Caption, line.Holidays.ContainsKey(date) ? "holiday" : today ? "brand" : "muted");
            sub.FontSize = 11.5; sub.HorizontalAlignment = HorizontalAlignment.Center;
            head.Children.Add(name); head.Children.Add(sub);
            Place(new Border { Child = head, BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 0, 0, 1) }, 0, i + 1);
        }

        if (anyDue)
        {
            var key = Kit.Text("截止", Role.Caption, "muted"); key.FontSize = 11; key.HorizontalAlignment = HorizontalAlignment.Center; key.VerticalAlignment = VerticalAlignment.Center;
            Place(new Border { Child = key, BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 0, 1, 1) }, 1, 0);
            for (var i = 0; i < columns; i++)
            {
                var list = new StackPanel { Spacing = 2, Padding = new Thickness(2, 3, 2, 3) };
                foreach (var task in dues[i].Take(3))
                {
                    var words = Kit.Text(task.Title, Role.Caption, task.Done is null ? "ink" : "faint"); words.FontSize = 11;
                    if (task.Done is not null) words.TextDecorations = TextDecorations.Strikethrough;
                    var chip = new Tap(Paint.Faded("brand", .09), Paint.Faded("brand", .16)) { Content = words, Padding = new Thickness(4, 1, 4, 1), CornerRadius = new CornerRadius(4) };
                    AutomationProperties.SetName(chip, task.Title);
                    var t = task; chip.Click += (_, _) => openTask(t);
                    list.Children.Add(chip);
                }
                if (dues[i].Count > 3) { var more = Kit.Text($"+{dues[i].Count - 3}", Role.Caption, "muted"); more.FontSize = 10; more.Margin = new Thickness(4, 0, 0, 0); list.Children.Add(more); }
                Place(new Border { Child = list, BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 0, 0, 1) }, 1, i + 1);
            }
        }

        // The periods down the side: the number, and its hours small beside it.
        var side = new Lane { Height = height };
        foreach (var period in line.Periods)
        {
            var (start, end) = clock[period.Period];
            var cell = new StackPanel { Orientation = wide ? Orientation.Horizontal : Orientation.Vertical, Spacing = wide ? 6 : 0, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            var number = Kit.Text(period.Period.ToString(), Role.Label, wide ? "ink" : "muted", bold: true); number.FontSize = wide ? 13 : 11; number.VerticalAlignment = VerticalAlignment.Center; number.HorizontalAlignment = HorizontalAlignment.Center;
            var hours = new TextBlock { Text = $"{period.Start}\n{period.End}", FontSize = wide ? 10 : 8.5, LineHeight = wide ? 12.5 : 10, LineStackingStrategy = LineStackingStrategy.BlockLineHeight, Foreground = Paint.Brush("faint"), TextAlignment = wide ? TextAlignment.Right : TextAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            Typography.SetNumeralAlignment(hours, FontNumeralAlignment.Tabular);
            cell.Children.Add(number); cell.Children.Add(hours);
            side.Put(cell, Y(start), Y(end) - Y(start), 0, 0);
        }
        if (thisWeek && now.Min >= from && now.Min <= until)
        {
            var label = new Border { Background = Paint.Brush("paper"), Child = new TextBlock { Text = Clock.Hm(now.Min), FontSize = 11, FontWeight = FontWeights.SemiBold, Foreground = Paint.Brush("now"), HorizontalAlignment = HorizontalAlignment.Center } };
            side.Mark(label, Y(now.Min));
        }
        Place(new Border { Child = side, BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 0, 1, 0) }, bodyRow, 0);

        for (var i = 0; i < columns; i++)
        {
            var date = days[i];
            var lane = new Lane { Height = height };
            if (line.Holidays.ContainsKey(date)) lane.Background = Hatch();
            foreach (var period in line.Periods) lane.Mark(new Rectangle { Height = 1, Fill = Paint.Brush("line"), Opacity = .65 }, Y(clock[period.Period].Start) + .5);
            var today = events[i];
            bool Past(int end) => date < now.Date || (date == now.Date && end <= now.Min);
            // A lesson off this week keeps its place, dashed, only where nothing is on that week.
            if (!line.Holidays.ContainsKey(date))
                foreach (var hint in hints.Where(h => h.Weekday == i + 1))
                {
                    if (!clock.TryGetValue(hint.Periods[0], out var a) || !clock.TryGetValue(hint.Periods[^1], out var b)) continue;
                    if (today.Any(e => e.Start < b.End && a.Start < e.End)) continue;
                    var around = line.Around(hint.Id, monday);
                    var tone = around is null ? null : CourseTones.ToneOf(around, tones, line.CourseMeetings);
                    var look = new Tiles.Look(tone is { } t ? Paint.ToneFaded(t, "bg", .4) : Paint.Faded("surfaceSunken", .5), tone is { } t2 ? Paint.ToneFaded(t2, "border", .6) : Paint.Brush("line"),
                        tone is { } t3 ? Paint.ToneFaded(t3, "fg", .55) : Paint.Brush("faint"), Dashed: true);
                    var label = wide ? Names.Course(hint.Course.Name) : Names.CourseShort(hint.Course.Name);
                    var tile = Tiles.Make(look, around is not null && around.Name != Names.Course(hint.Course.Name) ? around.Name : label, Lessons.WeeksText(hint.Weeks), wide ? 12.5 : 11, wide ? 11 : 10, () => { if (around is not null) open(around); });
                    lane.Put(tile, Y(a.Start) + 1, Y(b.End) - Y(a.Start) - 2);
                }
            foreach (var (e, under, over) in CampusLine.Layers(today, line.Order))
            {
                var tone = CourseTones.ToneOf(e, tones, line.CourseMeetings);
                var look = Tiles.LookOf(e, tone, e.Kind != "exam" && Past(e.End));
                var tile = Tiles.Make(look, wide ? e.Name : e.Short, Note(e, wide), wide ? 12.5 : 11, wide ? 11 : 10, () => open(e), over == 0 ? under : 0);
                lane.Put(tile, Y(e.Start) + 1, Math.Max(22, Y(e.End) - Y(e.Start) - 2), 2, 2 + under * Edge);
            }
            if (date == now.Date && now.Min >= from && now.Min <= until) lane.Mark(NowLine(), Y(now.Min));
            Place(lane, bodyRow, i + 1);
        }
        return new Border { Child = grid, BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(Paint.Number("radius", "card")), Background = Paint.Brush("paper") };
    }

    /** Now, across today: a brand line with a dot where it starts. */
    public static FrameworkElement NowLine()
    {
        var mark = new Grid { Height = 9, IsHitTestVisible = false };
        mark.Children.Add(new Rectangle { Height = 1.5, Fill = Paint.Brush("now"), VerticalAlignment = VerticalAlignment.Center });
        mark.Children.Add(new Ellipse { Width = 8, Height = 8, Fill = Paint.Brush("now"), HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(-1, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center });
        Canvas.SetZIndex(mark, 10);
        return mark;
    }

    /** A day off, striped as a calendar strikes it. */
    public static Brush Hatch()
    {
        var brush = new LinearGradientBrush { MappingMode = BrushMappingMode.Absolute, StartPoint = new(0, 0), EndPoint = new(5.66, 5.66), SpreadMethod = GradientSpreadMethod.Repeat };
        brush.GradientStops.Add(new GradientStop { Color = Paint.Clear.Color, Offset = 0 });
        brush.GradientStops.Add(new GradientStop { Color = Paint.Clear.Color, Offset = .75 });
        brush.GradientStops.Add(new GradientStop { Color = Paint.Of("surfaceSunken", Paint.Dark), Offset = .75 });
        brush.GradientStops.Add(new GradientStop { Color = Paint.Of("surfaceSunken", Paint.Dark), Offset = 1 });
        return brush;
    }
}
