// A term calendar or the exam list, reached from their respective timetable tabs.
// src/campus/timetable/views/TermView.tsx, natively.
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Shapes;
using StuDev.Data;
using StuDev.Me;
using StuDev.Ui;
using StuDev.World;

namespace StuDev.Timetable;

public static class TermView
{
    private static string Lead(int days) => days == 0 ? "今天" : days == 1 ? "明天" : $"{days} 天后";
    private static string DayHead(DateOnly date) => $"{Clock.DateLabel(date)} {Clock.Weekdays[Clock.Weekday(date)]}";
    private static string PlaceOf(Exam exam) => exam.Room is not null ? Names.Room(exam.Room) : exam.Location;

    public static FrameworkElement Make(CampusLine line, string? klass, Moment now, bool examPage, string mode, Action<string> onMode, Action onExams, Action<DateOnly> pick, Action<LineEvent> open, ExamRecord? record = null, string? selectedVersion = null, Action<string>? selectVersion = null)
    {
        var campus = Campus.Shared;
        var hasExams = line.Exams.Count > 0 || record?.History.Count > 0;
        var latest = record?.History.LastOrDefault(version => record.Changes.Any(change => change.Version == version.Id))?.Id;
        var seen = campus.Preferences.Get("examsSeen", StorageJson.Default.String);
        var knownSeen = record?.History.Any(version => version.Id == seen) == true;
        var mine = klass is not null && klass == campus.Preferences.Class;
        if (mine && latest is not null && latest != seen && (examPage || !knownSeen)) campus.Preferences.Set("examsSeen", latest, StorageJson.Default.String);
        var fresh = mine && knownSeen && latest is not null && latest != seen && !examPage;
        var page = new StackPanel();
        var upcoming = line.Exams.Where(x => string.CompareOrdinal(x.Date, Clock.Text(now.Date)) >= 0).OrderBy(x => x.Date, StringComparer.Ordinal).ThenBy(x => x.Start, StringComparer.Ordinal).ToList();
        var ahead = upcoming.GroupBy(x => x.Date).Select(g => (Date: Clock.Parse(g.Key), Days: Clock.Parse(g.Key).DayNumber - now.Date.DayNumber, Exams: g.ToList())).ToList();
        LineEvent? EventOf(Exam exam) => line.On(Clock.Parse(exam.Date)).FirstOrDefault(e => e.Exam?.Id == exam.Id);

        if (examPage)
        {
            var head = ahead.Count > 0 ? Kit.Column(2, Kit.Text($"{Lead(ahead[0].Days)}考试", Role.Heading), Kit.Text(string.Join("、", ahead[0].Exams.Select(x => Names.CourseShort(x.Course.Name))), Role.Body, "muted"))
                : Kit.Column(0, Kit.Text("暂未查到待考安排", Role.Heading));
            ((TextBlock)head.Children[0]).FontSize = 22; head.Padding = new Thickness(0, 4, 0, 14);
            var list = new StackPanel { MaxWidth = 680, HorizontalAlignment = HorizontalAlignment.Left };
            list.Children.Add(head);
            for (var at = 0; at < ahead.Count; at++)
            {
                var (date, _, exams) = ahead[at];
                var first = at == 0;
                var badge = Kit.Column(0, Kit.Text($"{date.Month}月", Role.Caption, first ? "onExam" : "ink"), Kit.Text(date.Day.ToString(), Role.Heading, first ? "onExam" : "ink"), Kit.Text(Clock.Weekdays[Clock.Weekday(date)], Role.Caption, first ? "onExam" : "ink"));
                foreach (var child in badge.Children.Cast<TextBlock>()) { child.HorizontalAlignment = HorizontalAlignment.Center; if (child.FontSize < 13) child.FontSize = 11; }
                ((TextBlock)badge.Children[1]).FontSize = 22;
                var dateBox = new Border { Width = 52, Padding = new Thickness(0, 5, 0, 6), CornerRadius = new CornerRadius(10), Child = badge, VerticalAlignment = VerticalAlignment.Top,
                    Background = first ? Paint.Brush("exam") : Paint.Clear, BorderBrush = Paint.Brush("exam"), BorderThickness = new Thickness(first ? 0 : 1.5) };
                var items = new StackPanel();
                foreach (var exam in exams)
                {
                    var words = Kit.Column(2, Kit.Text(Names.Course(exam.Course.Name), Role.Body, bold: true), Kit.Text($"{exam.Start}–{exam.End} · {PlaceOf(exam)}", Role.Label, "muted"));
                    ((TextBlock)words.Children[0]).FontSize = 16;
                    var row = new Grid { Padding = new Thickness(0, 6, 0, 10) }; row.ColumnDefinitions.Add(new ColumnDefinition()); row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                    row.Children.Add(words); var chev = Kit.Icon(Icons.Chevron, 14, "faint"); Grid.SetColumn(chev, 1); row.Children.Add(chev);
                    var tap = new Tap(Paint.Brush("paper"), Paint.Faded("surfaceSunken", .55)) { Content = row };
                    var x = exam; tap.Click += (_, _) => { if (EventOf(x) is { } e) open(e); };
                    items.Children.Add(tap);
                }
                var group = new Grid { ColumnSpacing = 14, Padding = new Thickness(0, 12, 0, 12), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 1, 0, 0) };
                group.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); group.ColumnDefinitions.Add(new ColumnDefinition());
                group.Children.Add(dateBox); Grid.SetColumn(items, 1); group.Children.Add(items);
                list.Children.Add(group);
            }
            // Exams of courses not on one's timetable can be taken away at once; what is taken away is folded at the bottom.
            var skippedExams = mine ? line.SkippedExams.OrderBy(x => x.Date, StringComparer.Ordinal).ThenBy(x => x.Start, StringComparer.Ordinal).ToList() : [];
            if (mine && klass is not null)
            {
                var outside = ExamAttendance.Outside(line.Exams, line.Meetings.Select(m => m.Course.Code).Where(c => !string.IsNullOrEmpty(c)).Select(c => c!).ToHashSet());
                if (outside.Count > 0)
                {
                    var clean = Kit.Action($"去掉课表里没有的课的考试（{outside.Count}）", () => Choices.ExamChoices(campus.Preferences, line.Term.Term, klass, outside.ToDictionary(x => x.Id, _ => false)));
                    clean.Margin = new Thickness(0, 12, 0, 4); clean.HorizontalAlignment = HorizontalAlignment.Left;
                    list.Children.Add(clean);
                }
            }
            var taken = line.Exams.Where(x => string.CompareOrdinal(x.Date, Clock.Text(now.Date)) < 0).OrderByDescending(x => x.Date, StringComparer.Ordinal).ToList();
            if (taken.Count > 0)
            {
                list.Children.Add(Pages.Section($"已考 {taken.Count} 场"));
                foreach (var exam in taken) list.Children.Add(Row(Clock.DateLabel(Clock.Parse(exam.Date)), Names.Course(exam.Course.Name), $"{exam.Start}–{exam.End} · {PlaceOf(exam)}", () => { if (EventOf(exam) is { } e) open(e); }));
            }
            if (skippedExams.Count > 0 && klass is not null)
            {
                // Taken away: out of the way, folded at the bottom, each one a tap from coming back.
                var term = line.Term.Term;
                var body = new StackPanel { Visibility = Visibility.Collapsed };
                var restoreAll = Kit.Action("全部恢复", () => Choices.ExamChoices(campus.Preferences, term, klass, skippedExams.ToDictionary(x => x.Id, _ => true)));
                restoreAll.HorizontalAlignment = HorizontalAlignment.Left; restoreAll.Margin = new Thickness(0, 4, 0, 6);
                body.Children.Add(restoreAll);
                foreach (var exam in skippedExams)
                {
                    var off = new Grid { ColumnSpacing = 12, Padding = new Thickness(0, 9, 0, 9), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 1, 0, 0) };
                    off.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(56) }); off.ColumnDefinitions.Add(new ColumnDefinition()); off.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                    off.Children.Add(Kit.Text(Clock.DateLabel(Clock.Parse(exam.Date)), Role.Label, "faint"));
                    var words = Kit.Column(1, Kit.Text(Names.Course(exam.Course.Name), Role.Body, "faint"), Kit.Text($"{exam.Start}–{exam.End} · {PlaceOf(exam)}", Role.Caption, "faint")); Grid.SetColumn(words, 1); off.Children.Add(words);
                    var x = exam;
                    var restore = Kit.Action("恢复", () => Choices.ExamChoices(campus.Preferences, term, klass, new() { [x.Id] = true })); Grid.SetColumn(restore, 2); off.Children.Add(restore);
                    Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(restore, $"恢复 {Names.Course(exam.Course.Name)}");
                    body.Children.Add(off);
                }
                var foldHead = new Tap(Paint.Clear, Paint.Faded("surfaceSunken", .55)) { Content = Kit.Text($"已去掉 {skippedExams.Count} 场 · 不提醒", Role.Label, "muted"), Padding = new Thickness(0, 11, 0, 11), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 1, 0, 0), HorizontalContentAlignment = HorizontalAlignment.Left };
                foldHead.Click += (_, _) => body.Visibility = body.Visibility == Visibility.Visible ? Visibility.Collapsed : Visibility.Visible;
                list.Children.Add(foldHead);
                list.Children.Add(body);
            }
            if (record is not null) list.Children.Add(ExamHistory.Make(record, selectedVersion, selectVersion));
            page.Children.Add(list);
            return page;
        }

        var ordered = campus.Calendar.OrderBy(t => t.Start, StringComparer.Ordinal).ToList();
        var termAt = ordered.FindIndex(t => t.Start == line.Term.Weeks[0].Start);
        var calendar = termAt >= 0 ? ordered[termAt] : null;
        var next = termAt >= 0 ? ordered.ElementAtOrDefault(termAt + 1) : null;
        var previous = termAt > 0 ? ordered[termAt - 1] : null;
        var other = calendar?.Number switch
        {
            1 when next?.Number == 2 => next,
            2 when previous?.Number == 1 => previous,
            _ => null,
        };
        var otherShown = mode == "other" && other is not null;
        var showing = mode == "run" && line.Run is not null ? "run" : "course";
        var selected = otherShown ? other : calendar;
        var termStart = Clock.Parse(selected?.Start ?? line.Term.Weeks[0].Start);
        var termEnd = Clock.Parse(selected?.End ?? line.Term.Weeks[^1].End);
        var termBar = new WrapRow { Gap = 12, Margin = new Thickness(0, 0, 0, 18) };
        if (other is not null && calendar is not null)
        {
            var terms = new[] { calendar, other }.OrderBy(t => t.Number);
            var tabs = terms.Select(t => t == calendar ? ("course", $"{TermName(t.Number)} · 本学期") : ("other", TermName(t.Number))).ToArray();
            termBar.Children.Add(Kit.Choice(tabs, otherShown ? "other" : "course", onMode));
        }
        if (line.Run is not null && !otherShown)
            termBar.Children.Add(Kit.Action(showing == "run" ? "完成" : "排早锻炼", () => onMode(showing == "run" ? "course" : "run"), go: showing == "run"));
        if (termBar.Children.Count > 0) page.Children.Add(termBar);
        var last = line.LastLesson();
        var runnable = line.Runnable().ToHashSet();
        var present = new HashSet<string>();
        var grid = new Grid { ColumnSpacing = 3, RowSpacing = 3 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(28) });
        for (var i = 0; i < 7; i++) grid.ColumnDefinitions.Add(new ColumnDefinition());
        var rowIndex = 0;
        void NewRow(GridLength height) { grid.RowDefinitions.Add(new RowDefinition { Height = height }); }
        NewRow(GridLength.Auto);
        for (var i = 1; i <= 7; i++) { var th = Kit.Text(Clock.Weekdays[i][1..], Role.Caption, "faint"); th.FontSize = 11.5; th.HorizontalAlignment = HorizontalAlignment.Center; Grid.SetColumn(th, i); grid.Children.Add(th); }
        rowIndex++;
        void Phase(string text)
        {
            NewRow(GridLength.Auto);
            var phase = new Grid { ColumnSpacing = 8, Padding = new Thickness(0, 4, 0, 4) };
            phase.ColumnDefinitions.Add(new ColumnDefinition()); phase.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); phase.ColumnDefinitions.Add(new ColumnDefinition());
            var l = Kit.Hairline(); l.VerticalAlignment = VerticalAlignment.Center; phase.Children.Add(l);
            var t = Kit.Text(text, Role.Caption, "muted"); t.FontSize = 11.5; Grid.SetColumn(t, 1); phase.Children.Add(t);
            var r = Kit.Hairline(); r.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(r, 2); phase.Children.Add(r);
            Grid.SetRow(phase, rowIndex); Grid.SetColumnSpan(phase, 8); grid.Children.Add(phase); rowIndex++;
        }
        var weeks = otherShown
            ? Enumerable.Range(0, (termEnd.DayNumber - Clock.WeekStart(termStart).DayNumber) / 7 + 1)
                .Select(i => (Number: i + 1, Start: Clock.WeekStart(termStart).AddDays(i * 7), End: Clock.WeekStart(termStart).AddDays(i * 7 + 6)))
            : line.Term.Weeks.Select(week => (Number: week.Week, Start: Clock.Parse(week.Start), End: Clock.Parse(week.End)));
        foreach (var week in weeks)
        {
            NewRow(new GridLength(30));
            var start = week.Start;
            var current = start <= now.Date && now.Date <= week.End;
            var wn = Kit.Text(week.Number.ToString(), Role.Caption, current ? "brand" : "faint", bold: current); wn.FontSize = 11.5; wn.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetRow(wn, rowIndex); grid.Children.Add(wn);
            for (var i = 0; i < 7; i++)
            {
                var date = start.AddDays(i);
                var cell = Cell(line, date, now, showing, termStart, termEnd, otherShown ? other : null, runnable, present, pick, open, campus);
                if (cell is null) continue;
                Grid.SetRow(cell, rowIndex); Grid.SetColumn(cell, i + 1); grid.Children.Add(cell);
            }
            rowIndex++;
            if (!otherShown && showing == "course" && last is { } l && start <= l && l <= week.End && week.Number < line.Term.Weeks.Count) Phase($"课程结束 · {DayHead(l)}");
        }
        var legendItems = showing == "run"
            ? new (string State, string Text)[] { ("rdone", "已跑"), ("rplan", "排上"), ("ropen", "可跑，点一下排上"), ("today", "今天") }
            : [("has", "上课"), ("exam", "考试"), ("hol", "不上课"), ("event", "校历活动"), ("today", "今天")];
        var legend = new WrapRow { Gap = 14, Margin = new Thickness(0, 14, 0, 0) };
        foreach (var (state, text) in legendItems.Where(l => present.Contains(l.State)))
        {
            var swatch = new Border { Width = 12, Height = 12, CornerRadius = new CornerRadius(3), Margin = new Thickness(0, 0, 5, 0), VerticalAlignment = VerticalAlignment.Center };
            switch (state)
            {
                case "has": swatch.Background = Paint.Brush("surfaceSunken"); break;
                case "exam": swatch.Background = Paint.Brush("exam"); break;
                case "hol": swatch.Child = new TextBlock { Text = "休", FontSize = 10, Foreground = Paint.Brush("holiday"), FontWeight = FontWeights.SemiBold, HorizontalAlignment = HorizontalAlignment.Center }; break;
                case "event": swatch.BorderBrush = Paint.Brush("free"); swatch.BorderThickness = new Thickness(1); break;
                case "today": swatch.BorderBrush = Paint.Brush("now"); swatch.BorderThickness = new Thickness(2); break;
                case "rdone": swatch.Background = Paint.Brush("free"); break;
                case "rplan": swatch.Background = Paint.Faded("free", .22); swatch.BorderBrush = Paint.Brush("free"); swatch.BorderThickness = new Thickness(1); break;
                case "ropen": swatch.BorderBrush = Paint.Brush("faint"); swatch.BorderThickness = new Thickness(1); break;
            }
            var t = Kit.Text(text, Role.Caption, "muted");
            legend.Children.Add(Kit.Line(0, swatch, t));
        }
        var left = Kit.Column(0, grid, legend);
        if (showing == "course" && selected?.Pause is { } pause)
            left.Children.Add(BreakBand(pause, otherShown ? ordered.ElementAtOrDefault(ordered.IndexOf(other!) + 1) : next));
        var right = new StackPanel();
        var tally = line.RunTally(now);
        if (otherShown)
        {
            right.Children.Add(Pages.Section(TermName(other!.Number)));
            right.Children.Add(Kit.Text($"{Clock.DateLabel(termStart)} – {Clock.DateLabel(termEnd)} · {other.Weeks} 周", Role.Label, "muted"));
            foreach (var item in (other.Holidays ?? []).Concat(other.Events ?? []).OrderBy(item => item.Start, StringComparer.Ordinal))
                right.Children.Add(Row("", item.Name, Dates(item), null));
            if (now.Date < termStart)
                right.Children.Add(Kit.Text("这个学期的课表公布后，课程和考试会出现在这里。", Role.Caption, "muted", wrap: true));
        }
        else if (showing == "run" && line.Run is { } rule)
        {
            var count = Kit.Text(tally.Count.ToString(), Role.Title); count.FontSize = 34;
            var of = Kit.Text($"/ {rule.Required} 次", Role.Body, "muted"); of.VerticalAlignment = VerticalAlignment.Bottom; of.Margin = new Thickness(0, 0, 0, 7);
            right.Children.Add(Kit.Line(6, count, of));
            right.Children.Add(Kit.Text($"已跑 {tally.Done}{(line.RunAdjust != 0 ? $" · 奖惩 {(line.RunAdjust > 0 ? "+" : "")}{line.RunAdjust}" : "")} · 排上 {tally.Planned} · {(tally.Need > 0 ? $"还差 {tally.Need}" : "够了")}", Role.Label, "muted", wrap: true));
            var hint = Kit.Text("排上的日子过了就算跑过；哪天没跑，点一下去掉。", Role.Label, "muted", wrap: true); hint.Margin = new Thickness(0, 8, 0, 12); right.Children.Add(hint);
            var auto = Kit.Action("自动排好剩下的", () => UpdateRun(campus, s => s with { Days = line.PlanRuns(now) }), go: true); auto.HorizontalAlignment = HorizontalAlignment.Stretch;
            right.Children.Add(auto);
            var stepper = Kit.Line(8, Kit.Button("减一次", () => UpdateRun(campus, s => s with { Adjust = s.Adjust - 1 }), "M4.5,10 H15.5", 20, true),
                Kit.Text(line.RunAdjust > 0 ? $"+{line.RunAdjust}" : line.RunAdjust.ToString(), Role.Body), Kit.Button("加一次", () => UpdateRun(campus, s => s with { Adjust = s.Adjust + 1 }), Icons.Plus, 20, true));
            ((FrameworkElement)stepper.Children[1]).VerticalAlignment = VerticalAlignment.Center;
            var adjust = Kit.Row("奖惩", Kit.Column(2, stepper, Kit.Text("对照南邮小程序的奖惩记录", Role.Caption, "muted")));
            adjust.Margin = new Thickness(0, 16, 0, 0);
            right.Children.Add(adjust);
        }
        else
        {
            if (line.Run is { } r)
            {
                var bar = new Grid { Height = 4, CornerRadius = new CornerRadius(2), Background = Paint.Brush("surfaceSunken"), Margin = new Thickness(0, 8, 0, 8) };
                bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Min(1, tally.Count / (double)r.Required), GridUnitType.Star) });
                bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(0, 1 - tally.Count / (double)r.Required), GridUnitType.Star) });
                bar.Children.Add(new Rectangle { Fill = Paint.Brush("brand") });
                right.Children.Add(Card(Kit.Column(0, Kit.Text($"早锻炼 {tally.Count} / {r.Required} 次", Role.Body, bold: true), bar, Kit.Text($"已跑 {tally.Done}，排上 {tally.Planned}，{(tally.Need > 0 ? $"还差 {tally.Need} 次" : "够了")}", Role.Label, "muted")), () => onMode("run")));
            }
            if (hasExams)
            {
                var courses = line.Exams.Select(x => x.Course.Code ?? x.Course.Name).Distinct().Count();
                var card = Kit.Column(4, Kit.Text((courses > 0 ? $"考试 · 已发现 {courses} 门" : "考试 · 最新安排与更新记录") + (fresh ? " •" : ""), Role.Body, bold: true));
                if (ahead.Count > 0)
                {
                    card.Children.Add(Kit.Text($"{DayHead(ahead[0].Date)} · {Lead(ahead[0].Days)}", Role.Label, "muted"));
                    foreach (var exam in ahead[0].Exams)
                    {
                        var line2 = new Grid(); line2.ColumnDefinitions.Add(new ColumnDefinition()); line2.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                        line2.Children.Add(Kit.Text(Names.Course(exam.Course.Name), Role.Label)); var w = Kit.Text($"{exam.Start} · {PlaceOf(exam)}", Role.Label, "muted"); Grid.SetColumn(w, 1); line2.Children.Add(w);
                        card.Children.Add(line2);
                    }
                }
                else card.Children.Add(Kit.Text(courses > 0 ? "都考完了" : "暂无待考安排", Role.Label, "muted"));
                right.Children.Add(Card(card, onExams));
            }
            var practice = campus.Classes.FirstOrDefault(c => c.Id == klass)?.Practice ?? [];
            var offGrid = practice.DistinctBy(p => $"{p.Name}|{string.Join(",", p.Weeks)}").OrderBy(p => p.Weeks.FirstOrDefault()).ThenBy(p => p.Name).ToList();
            if (offGrid.Count > 0)
            {
                right.Children.Add(Pages.Section("实践课程"));
                foreach (var item in offGrid) right.Children.Add(Row("", item.Name, Lessons.WeeksText(item.Weeks), null));
            }
            string When(DaySpan item) => item.Start == item.End ? DayHead(Clock.Parse(item.Start)) : $"{Clock.DateLabel(Clock.Parse(item.Start))} – {Clock.DateLabel(Clock.Parse(item.End))}";
            var calendarAhead = (calendar?.Holidays ?? []).Select(h => (h, When(h)))
                .Concat((calendar?.Events ?? []).Select(h => (h, $"{When(h)} · 按惯例全天停课")))
                .Concat(calendar?.Pause is { } p ? [(p, When(p))] : [])
                .Where(x => string.CompareOrdinal(x.Item1.Start, Clock.Text(now.Date)) >= 0).OrderBy(x => x.Item1.Start, StringComparer.Ordinal).ToList();
            if (calendarAhead.Count > 0)
            {
                right.Children.Add(Pages.Section("校历"));
                foreach (var (item, text) in calendarAhead) right.Children.Add(Row(Lead(Clock.Parse(item.Start).DayNumber - now.Date.DayNumber), item.Name, text, null));
            }
        }
        var layout = new Grid { ColumnSpacing = 40 };
        layout.ColumnDefinitions.Add(new ColumnDefinition());
        layout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(340) });
        layout.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        layout.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        layout.Children.Add(left); Grid.SetColumn(right, 1); layout.Children.Add(right);
        layout.SizeChanged += (_, e) =>
        {
            var compact = e.NewSize.Width < 800;
            layout.ColumnDefinitions[1].Width = compact ? new GridLength(0) : new GridLength(340);
            layout.ColumnSpacing = compact ? 0 : 40;
            layout.RowSpacing = compact ? 24 : 0;
            Grid.SetColumn(right, compact ? 0 : 1);
            Grid.SetRow(right, compact ? 1 : 0);
        };
        page.Children.Add(layout);
        return page;
    }

    private static void UpdateRun(Campus campus, Func<RunSettings, RunSettings> change) => campus.Preferences.Set("run", change(campus.Preferences.Get("run", Data.StorageJson.Default.RunSettings) ?? new([])), Data.StorageJson.Default.RunSettings);

    private static string TermName(int number) => number == 1 ? "第一学期" : "第二学期";

    private static string Dates(DaySpan span)
    {
        var start = Clock.DateLabel(Clock.Parse(span.Start));
        return span.Start == span.End ? start : $"{start} – {Clock.DateLabel(Clock.Parse(span.End))}";
    }

    private static FrameworkElement BreakBand(DaySpan pause, CalendarTerm? next)
    {
        var days = Clock.Parse(pause.End).DayNumber - Clock.Parse(pause.Start).DayNumber + 1;
        var details = new StackPanel { Visibility = Visibility.Collapsed };
        details.Children.Add(Kit.Text($"共 {days} 天", Role.Label, "muted"));
        if (next is not null) details.Children.Add(Kit.Text($"{Clock.DateLabel(Clock.Parse(next.Start))}开学", Role.Label, "muted"));
        var toggle = Kit.Action($"{pause.Name} · {Dates(pause)}", () => details.Visibility = details.Visibility == Visibility.Visible ? Visibility.Collapsed : Visibility.Visible);
        toggle.HorizontalAlignment = HorizontalAlignment.Left;
        var band = Kit.Column(6, toggle, details);
        band.Margin = new Thickness(0, 12, 0, 0);
        return band;
    }

    private static FrameworkElement? Cell(CampusLine line, DateOnly date, Moment now, string showing, DateOnly termStart, DateOnly termEnd, CalendarTerm? other, HashSet<DateOnly> runnable, HashSet<string> present, Action<DateOnly> pick, Action<LineEvent> open, Campus campus)
    {
        if (date > termEnd || date < termStart) return null;
        var label = date.Day == 1 ? $"{date.Month}月" : date.Day.ToString();
        var today = date == now.Date;
        if (today) present.Add("today");
        var words = Kit.Text(label, Role.Caption, "faint"); words.FontSize = 12; words.HorizontalAlignment = HorizontalAlignment.Center; words.VerticalAlignment = VerticalAlignment.Center;
        var tap = new Tap { Content = words, CornerRadius = new CornerRadius(4) };
        if (today) { tap.BorderBrush = Paint.Brush("now"); tap.BorderThickness = new Thickness(2); }
        if (showing == "run" && line.Run is { } rule)
        {
            var text = Clock.Text(date);
            if (!runnable.Contains(date)) { tap.Opacity = today ? 1 : .45; tap.IsEnabled = false; return tap; }
            var planned = line.RunDays.Contains(text);
            var gone = string.CompareOrdinal(text, Clock.Text(now.Date)) < 0 || text == Clock.Text(now.Date) && now.Min >= Clock.Minutes(rule.Time[1]);
            var state = planned ? (gone ? "rdone" : "rplan") : date < now.Date ? "rgone" : "ropen";
            present.Add(state);
            switch (state)
            {
                case "rdone": tap.Ground(Paint.Brush("free")); words.Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.White); break;
                case "rplan": tap.Ground(Paint.Faded("free", .22)); words.Foreground = Paint.Brush("free"); if (!today) { tap.BorderBrush = Paint.Brush("free"); tap.BorderThickness = new Thickness(1); } break;
                case "ropen": words.Foreground = Paint.Brush("ink"); if (!today) { tap.BorderBrush = Paint.Brush("faint"); tap.BorderThickness = new Thickness(1); } tap.Ground(Paint.Clear, Paint.Brush("surfaceSunken")); break;
            }
            AutomationProperties.SetName(tap, $"{Clock.DateLabel(date)} {(state == "rdone" ? "已跑，点一下去掉" : state == "rplan" ? "排上了，点一下去掉" : "点一下排上")}");
            tap.Click += (_, _) =>
            {
                var settings = campus.Preferences.Get("run", Data.StorageJson.Default.RunSettings) ?? new([]);
                var days = settings.Days.Contains(text) ? settings.Days.Where(d => d != text).ToList() : settings.Days.Append(text).Order(StringComparer.Ordinal).ToList();
                campus.Preferences.Set("run", settings with { Days = days }, Data.StorageJson.Default.RunSettings);
            };
            return tap;
        }
        var events = other is null ? line.On(date) : [];
        var exams = events.Where(e => e.Kind == "exam").ToList();
        var textDate = Clock.Text(date);
        bool Covers(DaySpan item) => string.CompareOrdinal(item.Start, textDate) <= 0 && string.CompareOrdinal(textDate, item.End) <= 0;
        var holiday = other is null ? line.Holidays.GetValueOrDefault(date) : other.Holidays?.FirstOrDefault(Covers)?.Name;
        var calendarEvent = other?.Events?.FirstOrDefault(Covers)?.Name;
        var kind = exams.Count > 0 ? "exam" : holiday is not null ? "hol" : calendarEvent is not null ? "event" : events.Any(e => e.Kind is "class" or "lab") ? "has" : "";
        if (kind.Length > 0) present.Add(kind);
        switch (kind)
        {
            case "has": tap.Ground(Paint.Brush("surfaceSunken"), Paint.Brush("line")); words.Foreground = Paint.Brush("ink"); break;
            case "exam": tap.Ground(Paint.Brush("exam")); words.Foreground = Paint.Brush("onExam"); words.FontWeight = FontWeights.SemiBold; break;
            case "hol": words.Foreground = Paint.Brush("holiday"); words.FontWeight = FontWeights.SemiBold; tap.Ground(Paint.Clear, Paint.Brush("surfaceSunken")); ToolTipService.SetToolTip(tap, holiday); break;
            case "event": words.Foreground = Paint.Brush("free"); ToolTipService.SetToolTip(tap, calendarEvent); break;
            default: tap.Ground(Paint.Clear, Paint.Brush("surfaceSunken")); break;
        }
        AutomationProperties.SetName(tap, $"{Clock.DateLabel(date)}{(holiday is not null ? $" {holiday}" : "")}{(calendarEvent is not null ? $" {calendarEvent}" : "")}{(exams.Count > 0 ? " 有考试" : "")}");
        if (other is null) tap.Click += (_, _) => { if (exams.Count == 1) open(exams[0]); else pick(date); };
        return tap;
    }

    private static FrameworkElement Card(FrameworkElement content, Action open)
    {
        content.Margin = new Thickness(0, 12, 0, 12);
        var tap = new Tap(Paint.Brush("paper"), Paint.Faded("surfaceSunken", .55)) { Content = content, BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 1, 0, 0) };
        tap.Click += (_, _) => open();
        return tap;
    }

    private static FrameworkElement Row(string lead, string main, string small, Action? open)
    {
        var grid = new Grid { ColumnSpacing = 12, Padding = new Thickness(0, 11, 0, 11), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 1, 0, 0) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = lead.Length > 0 ? new GridLength(56) : new GridLength(0) });
        grid.ColumnDefinitions.Add(new ColumnDefinition());
        if (lead.Length > 0) { var l = Kit.Text(lead, Role.Label, "muted"); l.FontSize = 13; grid.Children.Add(l); }
        var m = Kit.Column(1, Kit.Text(main, Role.Body), Kit.Text(small, Role.Caption, "muted", wrap: true)); ((TextBlock)m.Children[0]).FontSize = 14.5; ((TextBlock)m.Children[0]).FontWeight = FontWeights.Medium; ((TextBlock)m.Children[1]).FontSize = 12.5;
        Grid.SetColumn(m, 1); grid.Children.Add(m);
        if (open is null) return grid;
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var chev = Kit.Icon(Icons.Chevron, 14, "faint"); chev.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(chev, 2); grid.Children.Add(chev);
        var tap = new Tap(Paint.Brush("paper"), Paint.Faded("surfaceSunken", .55)) { Content = grid };
        tap.Click += (_, _) => open();
        return tap;
    }
}
