// One thing on the timetable, wherever it was opened: a lesson, a lab, an exam or 早锻炼. The sheet is the tile it
// opened from, enlarged — the same colour across its head — and says what matters for going there and preparing.
// Things on at the same time sit in a strip above and switch in place. EventSheet.tsx, natively.
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using StuDev.Me;
using StuDev.Ui;
using StuDev.World;

namespace StuDev.Timetable;

public static class Events
{
    private static readonly Dictionary<string, string> Kinds = new() { ["class"] = "课", ["lab"] = "实验", ["exam"] = "考试", ["run"] = "早锻炼", ["task"] = "任务" };
    private static List<CourseMaterials>? materials;

    public static void Open(Campus campus, LineEvent e, Moment now)
    {
        if (campus.Line is not { } line) return;
        App.Window?.Sheet(Make(campus, line, e, now), 480);
    }

    private static FrameworkElement Make(Campus campus, CampusLine line, LineEvent e, Moment now)
    {
        var tones = CourseTones.Of(line);
        var tone = CourseTones.ToneOf(e, tones, line.CourseMeetings);
        var look = Tiles.LookOf(e, tone, false);
        var exam = e.Kind == "exam";
        var term = line.Term.Term;
        void Close() => App.Window?.Close();
        void Again(LineEvent other) => App.Window?.Sheet(Make(campus, line, other, now), 480);

        var root = new StackPanel();
        // What else is on at the same time, in the order it is stacked, switched in place.
        var group = CampusLine.Clusters(line.On(e.Date), line.Order).FirstOrDefault(c => c.Events.Any(o => o.Id == e.Id));
        if (group is { Events.Count: > 1 })
        {
            var strip = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Padding = new Thickness(16, 14, 16, 0) };
            foreach (var other in group.Events.OrderByDescending(o => o.Layer).ThenBy(o => line.Order.ToList().IndexOf(o.Kind)).ThenBy(o => o.Start))
            {
                var otherLook = Tiles.LookOf(other, CourseTones.ToneOf(other, tones, line.CourseMeetings), false);
                var on = other.Id == e.Id;
                var words = Kit.Column(0, new TextBlock { Text = other.Short, FontSize = 12.5, FontWeight = FontWeights.SemiBold, Foreground = otherLook.Words, MaxWidth = 120, TextTrimming = TextTrimming.CharacterEllipsis },
                    new TextBlock { Text = $"{Kinds[other.Kind]} · {Clock.Hm(other.Start)}", FontSize = 11, Foreground = otherLook.Words, Opacity = .82 });
                var chip = new Tap(otherLook.Ground) { Content = words, Padding = new Thickness(10, 6, 10, 6), CornerRadius = new CornerRadius(8), BorderBrush = on ? Paint.Brush("ink") : otherLook.Edge, BorderThickness = new Thickness(on ? 1.5 : 1), Opacity = on ? 1 : .8 };
                Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(chip, other.Short);
                var chosen = other; chip.Click += (_, _) => { if (!on) Again(chosen); };
                strip.Children.Add(chip);
            }
            root.Children.Add(new ScrollViewer { Content = strip, HorizontalScrollBarVisibility = ScrollBarVisibility.Hidden, HorizontalScrollMode = ScrollMode.Auto, VerticalScrollMode = ScrollMode.Disabled });
        }

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        if (e.Kind is "lab" or "exam")
        {
            var tag = new Border { Padding = new Thickness(6, 1, 6, 2), CornerRadius = new CornerRadius(4), VerticalAlignment = VerticalAlignment.Center, Background = exam ? Paint.Brush("paper") : look.Edge,
                Child = new TextBlock { Text = Kinds[e.Kind], FontSize = 12, FontWeight = FontWeights.SemiBold, Foreground = exam ? Paint.Brush("warning") : Paint.Brush("paper") } };
            titleRow.Children.Add(tag);
        }
        var title = Pages.SheetTitle(e.Name); title.Foreground = look.Words; titleRow.Children.Add(title);
        var head = new Border
        {
            Background = e.Kind == "run" ? Paint.Brush("paper") : look.Ground, Padding = new Thickness(20, 18, 16, 14), Margin = new Thickness(0, group is { Events.Count: > 1 } ? 12 : 0, 0, 0),
            BorderBrush = e.Kind == "exam" ? Paint.Clear : look.Edge, BorderThickness = new Thickness(0, 0, 0, 1), Child = Pages.SheetHead(titleRow, Close),
        };
        if (group is { Events.Count: > 1 }) head.CornerRadius = new CornerRadius(0);
        root.Children.Add(head);
        var body = new StackPanel { Padding = new Thickness(20, 12, 20, 20) };
        root.Children.Add(body);

        void Meta(string text, bool strong = false) { var t = Kit.Text(text, Role.Label, strong ? "ink" : "muted", bold: strong, wrap: true); t.FontSize = strong ? 14 : 13.5; t.Margin = new Thickness(0, 0, 0, 4); body.Children.Add(t); }
        UIElement Value(string text, string? small = null, string colour = "ink")
        {
            var v = Kit.Column(2, Kit.Text(text, Role.Label, colour, wrap: true));
            ((TextBlock)v.Children[0]).FontSize = 14;
            if (small is not null) v.Children.Add(Kit.Text(small, Role.Caption, "muted", wrap: true));
            return v;
        }
        void Row(string key, UIElement value, Action? open = null) => body.Children.Add(Kit.Row(key, value, open));
        var when = $"{Clock.Weekdays[Clock.Weekday(e.Date)]} {Clock.DateLabel(e.Date)} · {Clock.Hm(e.Start)}–{Clock.Hm(e.End)}";
        var place = e.Room is not null ? Names.Room(e.Room) : null;

        void Go()
        {
            if (!Names.Placed(e.Room)) { body.Children.Add(new Border { Height = 10 }); return; }
            var buttons = new Grid { ColumnSpacing = 8, Margin = new Thickness(0, 12, 0, 14) };
            buttons.ColumnDefinitions.Add(new ColumnDefinition()); buttons.ColumnDefinitions.Add(new ColumnDefinition());
            var look = Kit.Action("在地图上看", () => { Close(); App.Open("map", ("place", e.Room!)); }); look.HorizontalAlignment = HorizontalAlignment.Stretch;
            var go = Kit.Action("去这里", () => { Close(); App.Open("map", ("nav", e.Room!)); }, go: true); go.HorizontalAlignment = HorizontalAlignment.Stretch; Grid.SetColumn(go, 1);
            buttons.Children.Add(look); buttons.Children.Add(go);
            body.Children.Add(buttons);
        }
        void Teachers() { foreach (var teacher in e.Teachers.SelectMany(t => t.Split('、')).Distinct()) Row("老师", Value(teacher)); }
        void Together(string key, List<string> classes, int? people)
        {
            if (classes.Count < 2 && people is null) return;
            var said = $"{(classes.Count > 1 ? $"{classes.Count} 个班" : classes.FirstOrDefault())}{(people is { } n ? $" · {n} 人" : "")}";
            Row(key, Value(said, classes.Count > 1 ? string.Join("、", classes) : null));
        }
        void Materials(string course)
        {
            var holder = new StackPanel(); body.Children.Add(holder);
            async void Fill()
            {
                try { materials ??= await campus.Repository!.Materials(); }
                catch (Exception error) when (error is System.Net.Http.HttpRequestException or IOException or System.Text.Json.JsonException) { return; }
                if (Lessons.MaterialsOf(materials, course) is not { } found) return;
                var list = new StackPanel { Spacing = 2, Visibility = Visibility.Collapsed, Margin = new Thickness(0, 0, 0, 10) };
                foreach (var kind in Lessons.MaterialKinds)
                {
                    var items = found.Items.Where(i => i.Kind == kind).ToList();
                    if (items.Count == 0) continue;
                    var k = Kit.Text(kind, Role.Caption, "muted", bold: true); k.Margin = new Thickness(0, 8, 0, 2); list.Children.Add(k);
                    foreach (var item in items.Take(6))
                    {
                        var line = new Grid { ColumnSpacing = 8, Padding = new Thickness(0, 5, 0, 5) };
                        line.ColumnDefinitions.Add(new ColumnDefinition()); line.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                        var name = Kit.Text(Lessons.Shown(item.Title), Role.Label, "brand"); line.Children.Add(name);
                        var small = Kit.Text(string.Join(" · ", new[] { item.Term, item.Ext?.ToUpperInvariant() }.Where(s => !string.IsNullOrEmpty(s))), Role.Caption, "faint"); Grid.SetColumn(small, 1); line.Children.Add(small);
                        var link = new Tap(Paint.Clear, Paint.Brush("surfaceSunken")) { Content = line, CornerRadius = new CornerRadius(4) };
                        var url = item.Url; link.Click += async (_, _) => await Windows.System.Launcher.LaunchUriAsync(new Uri(url));
                        list.Children.Add(link);
                    }
                    if (items.Count > 6) list.Children.Add(Kit.Text($"还有 {items.Count - 6} 份", Role.Caption, "muted"));
                }
                var counts = string.Join(" · ", Lessons.KindCounts(found.Items).Select(k => $"{k.Kind} {k.Count}"));
                holder.Children.Add(Kit.Row("资料", Value(counts), () => list.Visibility = list.Visibility == Visibility.Visible ? Visibility.Collapsed : Visibility.Visible));
                holder.Children.Add(list);
            }
            Fill();
        }
        void Danger(string text, Action act, string? small = null) => Row("", Value(text, small, "danger"), act);

        if (e.Kind == "run" && line.Run is { } run)
        {
            Meta(when);
            var tally = line.RunTally(now);
            Row("次数", Value($"{tally.Count} / {run.Required}", tally.Need > 0 ? $"还需安排 {tally.Need} 次" : "已经够了"));
            Danger("这天没跑", () =>
            {
                var settings = campus.Preferences.Get("run", Data.StorageJson.Default.RunSettings) ?? new([]);
                campus.Preferences.Set("run", settings with { Days = settings.Days.Where(d => d != Clock.Text(e.Date)).ToList() }, Data.StorageJson.Default.RunSettings);
                Close();
            });
            return root;
        }

        var courseName = Names.Course(e.Meeting?.Course.Name ?? e.Lab?.Course.Name ?? e.Exam?.Course.Name ?? e.Name);
        if (e.Lab is { } lab)
        {
            if (Lessons.CourseOf(line.CourseMeetings, lab.Course) is { } facts) Meta(Lessons.CourseLine(facts.Credits, facts.Nature));
            Meta($"{when} · {place ?? lab.Place}", true);
            if (line.Holidays.GetValueOrDefault(e.Date) is { } off) Meta($"这天是{off}，实验表照常排了这一次，以老师通知为准");
            Go();
            Row("项目", Value(lab.Project, lab.Group is { } g ? $"第 {g} 组" : null));
            if (System.Text.RegularExpressions.Regex.IsMatch(lab.Location, "排|[（(]")) Row("座位", Value(lab.Location.Replace(",", "、")));
            Together("一起上", lab.Classes, lab.Students);
            Teachers();
            Materials(courseName);
            Danger("不上这次实验", () => { Choices.LeaveLab(campus.Preferences, "skip", lab.Id); Close(); });
            var count = line.Labs.Count(o => Choices.LabCourse(o) == Choices.LabCourse(lab));
            Danger("不上这门实验", () => { Choices.LeaveLab(campus.Preferences, "drop", Choices.LabCourse(lab)); Close(); }, $"共 {count} 次，可在“我 · 实验安排”里恢复");
            return root;
        }
        if (e.Exam is { } x)
        {
            if (Lessons.CourseOf(line.CourseMeetings, x.Course) is { } facts) Meta(Lessons.CourseLine(facts.Credits, facts.Nature));
            Meta($"{when} · {place ?? x.Location}{(x.Campus is not null && x.Campus != campus.Preferences.Campus ? $" · {x.Campus}校区" : "")}", true);
            Go();
            Together("同考场", x.Classes, x.Students);
            if (x.Note is { Length: > 0 } note) Row("备注", Value(note));
            Teachers();
            Materials(courseName);
            Row("考试", Value($"全部考试 · {line.Exams.Select(o => o.Course.Code ?? o.Course.Name).Distinct().Count()} 门"));
            if (campus.Preferences.Class is { } klass) Danger("不参加这场考试", () => { Choices.SkipExam(campus.Preferences, term, klass, x.Id); Close(); });
            return root;
        }

        var meeting = e.Meeting;
        if (meeting is not null) Meta(Lessons.CourseLine(meeting.Course.Credits, meeting.Course.Nature, meeting.Course.Assessment));
        Meta($"{when}{(place is not null ? $" · {place}" : " · 课表没写地点")}", true);
        Go();
        if (meeting is not null)
        {
            var left = Lessons.Left(line, meeting, now, e.End);
            Row("周次", Value(Lessons.WeeksText(meeting.Weeks), left > 0 ? $"还剩 {left} 次" : "已经上完"));
            Together("合班", meeting.Classes, meeting.TeachingClass.Size);
        }
        Teachers();
        Materials(courseName);
        foreach (var other in Lessons.SharingSlot(line, e))
            Row("同时段", Value(Names.Course(other.Course.Name), $"{Lessons.WeeksText(other.Weeks)} · 本周不上"), () => { if (line.Around(other.Id, e.Date) is { } found) Again(found); });
        if (meeting is not null && line.Exams.Where(o => (o.Course.Code ?? o.Course.Name) == (meeting.Course.Code ?? meeting.Course.Name)).OrderBy(o => o.Date, StringComparer.Ordinal).FirstOrDefault() is { } next
            && line.On(Clock.Parse(next.Date)).FirstOrDefault(o => o.Exam?.Id == next.Id) is { } examEvent)
            Row("考试", Value($"{Clock.DateLabel(Clock.Parse(next.Date))} {Clock.Weekdays[Clock.Weekday(Clock.Parse(next.Date))]} {next.Start}"), () => Again(examEvent));
        if (meeting is not null && !meeting.TeachingClass.Id.StartsWith("custom:"))
        {
            var identity = CourseTones.Identity(meeting.Course.Code, meeting.Course.Name);
            var naming = new Grid { ColumnSpacing = 8, Visibility = Visibility.Collapsed, Margin = new Thickness(0, 0, 0, 10) };
            naming.ColumnDefinitions.Add(new ColumnDefinition()); naming.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); naming.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var box = Kit.Field(e.Name, "这门课的名字", "课程名称");
            void Save() { if (box.Text.Trim() is { Length: > 0 } name) { Choices.Rename(campus.Preferences, term, identity, name); Close(); } }
            box.KeyDown += (_, k) => { if (k.Key == Windows.System.VirtualKey.Enter) Save(); };
            var save = Kit.Button("保存", Save); Grid.SetColumn(save, 1);
            var original = Kit.Button("原名", () => { Choices.Rename(campus.Preferences, term, identity, null); Close(); }); Grid.SetColumn(original, 2);
            naming.Children.Add(box); naming.Children.Add(save); naming.Children.Add(original);
            Row("名称", Value("改名", "比如把板块课改成具体上的课"), () => { naming.Visibility = Visibility.Visible; box.Focus(FocusState.Programmatic); box.SelectAll(); });
            body.Children.Add(naming);
        }
        if (meeting is not null)
            Danger(meeting.TeachingClass.Id.StartsWith("custom:") ? "删除这门课" : "从我的课表移除", () => { Choices.Hide(campus.Preferences, term, meeting.TeachingClass.Id); Close(); });
        return root;
    }
}
