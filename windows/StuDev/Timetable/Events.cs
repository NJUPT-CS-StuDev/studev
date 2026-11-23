// One thing on the timetable, wherever it was opened: a lesson, a lab, an exam or 早锻炼. The sheet is the tile it
// opened from, enlarged — the same colour across its head — and says what matters for going there and preparing.
// Things on at the same time sit in a strip above and switch in place. EventSheet.tsx, natively.
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using StuDev.Data;
using StuDev.Me;
using StuDev.Ui;
using StuDev.World;

namespace StuDev.Timetable;

public static class Events
{
    private static readonly Dictionary<string, string> Kinds = new() { ["class"] = "课", ["lab"] = "实验", ["exam"] = "考试", ["run"] = "早锻炼", ["task"] = "任务" };

    /** Opens a thing from one's own line, or from someone else's when `other` is given: then nothing in it changes one's own. */
    public static void Open(Campus campus, LineEvent e, Moment now, CampusLine? other = null)
    {
        if ((other ?? campus.Line) is not { } line) return;
        App.Window?.Sheet(Make(campus, line, e, now, other is null), 480);
    }

    private static FrameworkElement Make(Campus campus, CampusLine line, LineEvent e, Moment now, bool mine)
    {
        if (mine && e.Meeting is { } ownMeeting && !ownMeeting.TeachingClass.Id.StartsWith("custom:"))
        {
            var label = Choices.Edits(campus.Preferences, line.Term.Term).Names?.GetValueOrDefault(CourseTones.Identity(ownMeeting.Course.Code, ownMeeting.Course.Name)) ?? Names.Course(ownMeeting.Course.Name);
            e = e with { Name = label, Short = label };
        }
        var tones = CourseTones.Of(line);
        var tone = CourseTones.ToneOf(e, tones, line.CourseMeetings);
        var look = Tiles.LookOf(e, tone, false);
        var exam = e.Kind == "exam";
        var term = line.Term.Term;
        void Close() => App.Window?.Close();
        void Again(LineEvent other) => App.Window?.Sheet(Make(campus, line, other, now, mine), 480);
        void See(string type, string id) { Close(); App.Open("timetable", new Who(type, id)); }

        var root = new StackPanel();
        // What else is on at the same time, in the order it is stacked, switched in place.
        var group = CampusLine.Clusters(line.On(e.Date), line.Order).FirstOrDefault(c => c.Events.Any(o => o.Id == e.Id));
        var stacked = group is { Events.Count: > 1 } ? group.Events.OrderByDescending(o => o.Layer).ThenBy(o => line.Order.ToList().IndexOf(o.Kind)).ThenBy(o => o.Start).ToList() : [];
        // An exam also switches among the day's other exams, wherever it was tapped: two exams on one day are seen together.
        var dayExams = e.Kind == "exam" ? line.On(e.Date).Where(o => o.Kind == "exam").ToList() : [];
        var together = dayExams.Count > 1 ? stacked.Concat(dayExams).DistinctBy(o => o.Id).OrderBy(o => o.Start).ThenBy(o => line.Order.ToList().IndexOf(o.Kind)).ToList() : stacked;
        if (together.Count > 1)
        {
            var strip = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Padding = new Thickness(16, 14, 16, 0) };
            foreach (var other in together)
            {
                var otherLook = Tiles.LookOf(other, CourseTones.ToneOf(other, tones, line.CourseMeetings), false);
                var on = other.Id == e.Id;
                var words = Kit.Column(0, new TextBlock { Text = other.Short, FontSize = 12.5, FontWeight = FontWeights.SemiBold, Foreground = otherLook.Words, MaxWidth = 120, TextTrimming = TextTrimming.CharacterEllipsis },
                    new TextBlock { Text = $"{Kinds[other.Kind]} · {Clock.Hm(other.Start)}", FontSize = 11, Foreground = otherLook.Words });
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
        void Row(string key, UIElement value, Action? open = null) => body.Children.Add(Kit.Row(key, value, open));
        var when = $"{Clock.Weekdays[Clock.Weekday(e.Date)]} {Clock.DateLabel(e.Date)} · {Clock.Hm(e.Start)}–{Clock.Hm(e.End)}";
        var place = e.Room is not null ? Names.Room(e.Room) : null;

        void Go()
        {
            if (!Names.Placed(e.Room)) { body.Children.Add(new Border { Height = 10 }); return; }
            var buttons = new Grid { ColumnSpacing = 8, Margin = new Thickness(0, 12, 0, 14) };
            buttons.ColumnDefinitions.Add(new ColumnDefinition()); buttons.ColumnDefinitions.Add(new ColumnDefinition());
            var look = Kit.Action("在地图上查看", () => { Close(); App.Open("map", ("place", e.Room!)); }); look.HorizontalAlignment = HorizontalAlignment.Stretch;
            var go = Kit.Action("去这里", () => { Close(); App.Open("map", ("nav", e.Room!)); }, go: true); go.HorizontalAlignment = HorizontalAlignment.Stretch; Grid.SetColumn(go, 1);
            buttons.Children.Add(look); buttons.Children.Add(go);
            body.Children.Add(buttons);
        }
        // Who teaches it, in one row as the classes are: each name opens that teacher's timetable.
        void Teachers() { if (TeacherRow(e.Teachers, name => See("teacher", name)) is { } names) Row("老师", names); }
        // Where it is and what it is, each opening the whole of it: the room's week, the course's every slot.
        void Place(string key) { if (Names.IsRoom(e.Room)) Row(key, Value($"{Names.Room(e.Room!)} 的课表"), () => See("room", e.Room!)); }
        void Course(string course, string? code = null)
        {
            Row("课程", Value("查看该课程的所有上课时间"), () => See("course", course));
            AddKnowledge(body, campus.Repository, course, code);
        }
        void Together(string key, List<string> classes, int? people)
        {
            if (classes.Count < 2 && people is null) return;
            var said = $"{(classes.Count > 1 ? $"{classes.Count} 个班" : classes.FirstOrDefault())}{(people is { } n ? $" · {n} 人" : "")}";
            Row(key, Value(said, classes.Count > 1 ? string.Join("、", classes) : null));
        }
        void Materials(string course) => AddMaterials(body, campus.Repository, course);
        void Danger(string text, Action act, string? small = null) => Row("", Value(text, small, "danger"), act);

        if (e.Kind == "run" && line.Run is { } run)
        {
            Meta(when);
            var tally = line.RunTally(now);
            Row("次数", Value($"{tally.Count} / {run.Required}", tally.Need > 0 ? $"还需安排 {tally.Need} 次" : "已排够本学期所需次数"));
            Danger("标记为当天未跑", () =>
            {
                var settings = campus.Preferences.Get("run", Data.StorageJson.Default.RunSettings) ?? new([]);
                campus.Preferences.Set("run", settings with { Days = settings.Days.Where(d => d != Clock.Text(e.Date)).ToList() }, Data.StorageJson.Default.RunSettings);
                Close();
            });
            return root;
        }

        var courseName = Names.Course(e.Meeting?.Course.Name ?? e.Lab?.Course.Name ?? e.Exam?.Course.Name ?? e.Name);
        var courseCode = e.Meeting?.Course.Code ?? e.Lab?.Course.Code ?? e.Exam?.Course.Code;
        if (e.Lab is { } lab)
        {
            if (Lessons.CourseOf(line.CourseMeetings, lab.Course) is { } facts) Meta(Lessons.CourseLine(facts.Credits, facts.Nature));
            Meta($"{when} · {place ?? lab.Place}", true);
            if (line.Holidays.GetValueOrDefault(e.Date) is { } off) Meta($"实验表显示{off}当天有实验，请以老师通知为准。");
            Go();
            Row("项目", Value(lab.Project, lab.Group is { } g ? $"第 {g} 组" : null));
            if (System.Text.RegularExpressions.Regex.IsMatch(lab.Location, "排|[（(]")) Row("座位", Value(lab.Location.Replace(",", "、")));
            Together("一起上", lab.Classes, lab.Students);
            Teachers();
            Place("教室");
            Course(courseName, courseCode);
            Materials(courseName);
            if (!mine) return root;
            Danger("从课表隐藏本次实验", () => { Choices.LeaveLab(campus.Preferences, "skip", lab.Id); Close(); });
            var count = line.Labs.Count(o => Choices.LabCourse(o) == Choices.LabCourse(lab));
            Danger("从课表隐藏这门实验", () => { Choices.LeaveLab(campus.Preferences, "drop", Choices.LabCourse(lab)); Close(); }, $"共 {count} 次，可在“我 · 实验安排”里恢复");
            return root;
        }
        if (e.Exam is { } x)
        {
            if (Lessons.CourseOf(line.CourseMeetings, x.Course) is { } facts) Meta(Lessons.CourseLine(facts.Credits, facts.Nature));
            Meta($"{when} · {place ?? x.Location}{(x.Campus is not null && x.Campus != campus.Preferences.Campus ? $" · {x.Campus}校区" : "")}", true);
            Go();
            if (campus.Repository is { } repository)
            {
                var details = new StackPanel(); body.Children.Add(details);
                _ = ExamDetails(details, repository, mine ? campus.Preferences.Class : null, x);
            }
            Together("同考场", x.Classes, x.Students);
            if (x.Note is { Length: > 0 } note) Row("备注", Value(note));
            Teachers();
            Place("考场");
            Course(courseName, courseCode);
            Materials(courseName);
            Row("考试", Value($"全部考试 · {line.Exams.Select(o => o.Course.Code ?? o.Course.Name).Distinct().Count()} 门"), mine ? () => { Close(); App.Open("timetable", "exams"); } : null);
            if (mine && campus.Preferences.Class is { } klass) Danger("从课表隐藏这场考试", () => { Choices.SkipExam(campus.Preferences, term, klass, x.Id); Close(); });
            return root;
        }

        var meeting = e.Meeting;
        if (meeting is not null) Meta(Lessons.CourseLine(meeting.Course.Credits, meeting.Course.Nature, meeting.Course.Assessment));
        Meta($"{when}{(place is not null ? $" · {place}" : " · 课表未注明地点")}", true);
        Go();
        if (meeting is not null)
        {
            var left = Lessons.Left(line, meeting, now, e.End);
            Row("周次", Value(Lessons.WeeksText(meeting.Weeks), left > 0 ? $"还剩 {left} 次" : "本学期已结束"));
            Together("合班", meeting.Classes, meeting.TeachingClass.Size);
        }
        Teachers();
        Place("教室");
        Course(courseName, courseCode);
        Materials(courseName);
        foreach (var other in Lessons.SharingSlot(line, e))
            Row("同时段", Value(Names.Course(other.Course.Name), $"{Lessons.WeeksText(other.Weeks)} · 本周不上"), () => { if (line.Around(other.Id, e.Date) is { } found) Again(found); });
        if (meeting is not null && line.Exams.Where(o => (o.Course.Code ?? o.Course.Name) == (meeting.Course.Code ?? meeting.Course.Name)).OrderBy(o => o.Date, StringComparer.Ordinal).FirstOrDefault() is { } next
            && line.On(Clock.Parse(next.Date)).FirstOrDefault(o => o.Exam?.Id == next.Id) is { } examEvent)
            Row("考试", Value($"{Clock.DateLabel(Clock.Parse(next.Date))} {Clock.Weekdays[Clock.Weekday(Clock.Parse(next.Date))]} {next.Start}"), () => Again(examEvent));
        if (!mine) return root;
        if (meeting is not null && !meeting.TeachingClass.Id.StartsWith("custom:"))
        {
            var identity = CourseTones.Identity(meeting.Course.Code, meeting.Course.Name);
            var naming = new Grid { ColumnSpacing = 8, Visibility = Visibility.Collapsed, Margin = new Thickness(0, 0, 0, 10) };
            naming.ColumnDefinitions.Add(new ColumnDefinition()); naming.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var box = Kit.Field(e.Name, "课程名称", "课程名称"); box.MaxLength = 60;
            void Save() { if (box.Text.Trim() is { Length: > 0 } name && name != e.Name) { Choices.Rename(campus.Preferences, term, identity, name); Again(e); } }
            box.KeyDown += (_, k) => { if (k.Key == Windows.System.VirtualKey.Enter) Save(); };
            var save = Kit.TextAction("保存名称", Save); Grid.SetColumn(save, 1);
            void Ready() { save.IsEnabled = box.Text.Trim().Length > 0 && box.Text.Trim() != e.Name; save.Opacity = save.IsEnabled ? 1 : .45; }
            box.TextChanged += (_, _) => Ready(); Ready();
            naming.Children.Add(box); naming.Children.Add(save);
            var secondary = Kit.Line(14, Kit.TextAction("取消", () => Again(e), colour: "muted")); secondary.Visibility = Visibility.Collapsed;
            if (Choices.Edits(campus.Preferences, term).Names?.ContainsKey(identity) == true) secondary.Children.Add(Kit.TextAction("恢复原名", () => { Choices.Rename(campus.Preferences, term, identity, null); Again(e); }, colour: "muted"));
            var nameRow = new Grid { ColumnSpacing = 12 };
            nameRow.ColumnDefinitions.Add(new ColumnDefinition()); nameRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            nameRow.Children.Add(Value(e.Name));
            var editName = Kit.TextAction("编辑名称", () => { naming.Visibility = Visibility.Visible; secondary.Visibility = Visibility.Visible; box.Focus(FocusState.Programmatic); box.SelectAll(); }); Grid.SetColumn(editName, 1); nameRow.Children.Add(editName);
            Row("名称", nameRow);
            body.Children.Add(naming); body.Children.Add(secondary);
        }
        if (meeting is not null)
            Danger(meeting.TeachingClass.Id.StartsWith("custom:") ? "删除这门课" : "从我的课表移除", () => { Choices.Hide(campus.Preferences, term, meeting.TeachingClass.Id); Close(); });
        return root;
    }


    public static void OpenPractice(Campus campus, CampusLine line, Practice practice, Moment now)
    {
        var week = line.WeekOf(now.Date);
        var first = line.Term.Weeks.FirstOrDefault(item => item.Week == practice.Weeks.Min());
        var last = line.Term.Weeks.FirstOrDefault(item => item.Week == practice.Weeks.Max());
        var dates = first is not null && last is not null
            ? $"{Clock.DateLabel(Clock.Parse(first.Start))} – {Clock.DateLabel(Clock.Parse(last.End))}" : null;
        var body = new StackPanel { Padding = new Thickness(20, 12, 20, 20) };
        body.Children.Add(Kit.Row("周次", Value(Lessons.WeeksText(practice.Weeks), dates)));
        body.Children.Add(Kit.Row("进度", Value(Practices.Progress(practice.Weeks, week))));
        if (TeacherRow(Practices.Teachers(practice), name => { App.Window?.Close(); App.Open("timetable", new Who("teacher", name)); }) is { } teachers)
            body.Children.Add(Kit.Row("老师", teachers));
        body.Children.Add(Kit.Row("安排", Value("不占固定课时", "时间、地点和要求以指导老师的安排为准。")));
        var name = Practices.ResourceName(practice);
        AddKnowledge(body, campus.Repository, name);
        AddMaterials(body, campus.Repository, name);
        var head = new Border
        {
            Background = Paint.Brush("surfaceSunken"),
            Padding = new Thickness(20, 14, 20, 14),
            Child = Pages.SheetHead(Pages.SheetTitle($"实践 · {Practices.Name(practice)}"), () => App.Window?.Close()),
        };
        App.Window?.Sheet(Kit.Column(0, head, body), 480);
    }

    private static FrameworkElement? TeacherRow(IEnumerable<string> teachers, Action<string> open)
    {
        var names = teachers.SelectMany(t => t.Split('、')).Select(t => t.Trim()).Where(t => t.Length > 0).Distinct().ToList();
        if (names.Count == 0) return null;
        var row = new WrapRow { Gap = 6 };
        foreach (var name in names)
        {
            var chip = new Tap(Paint.Brush("surfaceSunken"), Paint.Brush("line"))
            {
                Content = Kit.Text(name, Role.Label), Padding = new Thickness(10, 3, 10, 4), CornerRadius = new CornerRadius(12),
            };
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(chip, $"{name} 的课表");
            chip.Click += (_, _) => open(name);
            row.Children.Add(chip);
        }
        return row;
    }

    private static async void AddKnowledge(StackPanel body, Repository? repo, string course, string? code = null)
    {
        if (repo is null) return;
        var holder = new StackPanel();
        body.Children.Add(holder);
        try
        {
            var index = await repo.Read("knowledge/knowledge.json", FactsJson.Default.KnowledgeIndex);
            var norm = code?.Trim().ToUpperInvariant();
            var found = index.Courses.FirstOrDefault(c => (norm is { Length: > 0 } && c.Codes.Contains(norm)) || c.Name == course || c.Former.Contains(course));
            if (found is null) return;
            var topics = found.Chapters.Sum(ch => ch.Topics.Count);
            holder.Children.Add(Kit.Row("知识", Value("查看这门课的知识与真题", $"{found.Chapters.Count} 章 · {topics} 个知识点"), () =>
            {
                App.Window?.Close();
                App.Open("knowledge", $"/knowledge/?course={Uri.EscapeDataString(found.Id)}");
            }));
        }
        catch (Exception error) when (error is System.Net.Http.HttpRequestException or IOException or System.Text.Json.JsonException) { }
    }

    private static async void AddMaterials(StackPanel body, Repository? repo, string course)
    {
        if (repo is null) return;
        var holder = new StackPanel();
        body.Children.Add(holder);
        List<CourseMaterials> materials;
        try { materials = await repo.Materials(); }
        catch (Exception error) when (error is System.Net.Http.HttpRequestException or IOException or System.Text.Json.JsonException) { return; }
        if (Lessons.MaterialsOf(materials, course) is not { } found) return;

        var list = new StackPanel { Spacing = 2, Visibility = Visibility.Collapsed, Margin = new Thickness(0, 0, 0, 10) };
        foreach (var kind in Lessons.MaterialKinds)
        {
            var items = found.Items.Where(i => i.Kind == kind).ToList();
            if (items.Count == 0) continue;
            var section = new StackPanel();
            var label = Kit.Text(kind, Role.Caption, "muted", bold: true);
            label.Margin = new Thickness(0, 8, 0, 2);
            section.Children.Add(label);
            void AddRows(int start, int count)
            {
                foreach (var item in items.Skip(start).Take(count))
                {
                    var line = new Grid { ColumnSpacing = 8, Padding = new Thickness(0, 5, 0, 5) };
                    line.ColumnDefinitions.Add(new ColumnDefinition());
                    line.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                    line.Children.Add(Kit.Text(Lessons.Shown(item.Title), Role.Label, "brand", wrap: true));
                    var details = Kit.Text(string.Join(" · ", new[] { item.Term, item.Ext?.ToUpperInvariant() }.Where(s => !string.IsNullOrEmpty(s))), Role.Caption, "faint");
                    Grid.SetColumn(details, 1);
                    line.Children.Add(details);
                    var link = new Tap(Paint.Clear, Paint.Brush("surfaceSunken")) { Content = line, CornerRadius = new CornerRadius(4) };
                    link.Click += async (_, _) => await Windows.System.Launcher.LaunchUriAsync(new Uri(item.Url));
                    section.Children.Add(link);
                }
            }
            const int visible = 4;
            AddRows(0, visible);
            if (items.Count > visible)
            {
                var more = Kit.TextAction($"查看其余 {items.Count - visible} 份", () =>
                {
                    section.Children.RemoveAt(section.Children.Count - 1);
                    AddRows(visible, items.Count - visible);
                });
                section.Children.Add(more);
            }
            list.Children.Add(section);
        }
        var counts = string.Join(" · ", Lessons.KindCounts(found.Items).Select(k => $"{k.Kind} {k.Count}"));
        holder.Children.Add(Kit.Row("资料", Value(counts), () => list.Visibility = list.Visibility == Visibility.Visible ? Visibility.Collapsed : Visibility.Visible));
        holder.Children.Add(list);
    }

    private static UIElement Value(string text, string? small = null, string colour = "ink")
    {
        var v = Kit.Column(2, Kit.Text(text, Role.Label, colour, wrap: true));
        ((TextBlock)v.Children[0]).FontSize = 14;
        if (small is not null) v.Children.Add(Kit.Text(small, Role.Caption, "muted", wrap: true));
        return v;
    }

    private static async Task ExamDetails(StackPanel target, Data.Repository repository, string? klass, Data.Exam exam)
    {
        try
        {
            var record = await repository.ExamRecord(klass);
            target.Children.Clear();
            foreach (var change in Exams.ChangesOf(record, exam))
            {
                var title = $"{(change.Change == "added" ? "新发布" : "已调整")} · {Exams.VersionTime(record.History.First(version => version.Id == change.Version))}";
                var words = Kit.Column(2, Kit.Text(title, Role.Label));
                if (change.Change == "changed") foreach (var line in Exams.ChangeLines(change)) words.Children.Add(Kit.Text(line, Role.Caption, "muted", wrap: true));
                words.Margin = new Thickness(0, 0, 0, 12); target.Children.Add(words);
            }
            if (record.Sources.FirstOrDefault(source => source.File == exam.Source) is { } source) target.Children.Add(ExamHistory.Sources([source]));
        }
        catch (Exception error) when (error is System.Net.Http.HttpRequestException or IOException or TaskCanceledException or System.Text.Json.JsonException)
        {
            target.Children.Clear();
            target.Children.Add(Kit.TextAction("官方来源暂时无法加载 · 重试", () => { target.Children.Clear(); _ = ExamDetails(target, repository, klass, exam); }));
        }
    }
}
