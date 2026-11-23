// The timetable: one's line through the term unfolded as a day, a week, the whole term, or a list of what is to be
// done. TimetableApp.tsx, natively: day, week, term, exams and tasks. Opened on
// someone else (a teacher, a room, a course, a class) it shows their line the same way, without the list of one's own.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using StuDev.Ui;
using StuDev.World;

namespace StuDev.Timetable;

public sealed partial class TimetableScreen : Screen
{
    private static readonly (string Key, string Label)[] Scales = [("day", "天"), ("week", "周"), ("term", "学期"), ("exam", "考试"), ("list", "任务")];
    private readonly Campus campus = Campus.Shared;
    private readonly DispatcherTimer clock = new() { Interval = TimeSpan.FromSeconds(30) };
    private string scale = "week";
    private DateOnly? picked;
    private Moment now = Moment.Now();
    private bool wide = true;
    /** Room for a task open beside the list. */
    private bool roomy = true;
    private readonly Dictionary<(Who? Who, string Scale, string Mode), double> scroll = new();
    private ScrollViewer? frame;
    private (Who? Who, string Scale, string Mode) frameView;
    private string termMode = "course";
    private (string Scale, DateOnly? Day, string Mode)? myView;
    /** Whose timetable this is when it is not one's own, and their line once it is gathered. */
    private Who? who;
    private CampusLine? others;
    private string? othersError;
    private (Data.Repository Repository, string Class)? recordKey;
    private Data.ExamRecord? examRecord;
    private string? examVersion;
    private string? recordError;
    private string? preview;
    private List<Data.TeachingMeeting>? previewRows;
    private string? previewError;
    /** The class picker while one is being chosen: kept across redraws, so what is typed in it stays. */
    private (List<Data.TeachingClass> Classes, FrameworkElement View)? picker;
    private string pickerQuery = "";

    public TimetableScreen()
    {
        campus.Changed += () => DispatcherQueue.TryEnqueue(Draw);
        Paint.Turned += Draw;
        clock.Tick += (_, _) => { var next = Moment.Now(); if (next != now) { now = next; Draw(); } };
        clock.Start();
        SizeChanged += (_, e) => { var next = e.NewSize.Width >= 900; var room = e.NewSize.Width >= 1100; if (next != wide || room != roomy) { wide = next; roomy = room; Draw(); } };
        KeyboardAcceleratorPlacementMode = KeyboardAcceleratorPlacementMode.Hidden;
        Key(Windows.System.VirtualKey.Left, () => Shift(-1));
        Key(Windows.System.VirtualKey.Right, () => Shift(1));
        Key(Windows.System.VirtualKey.T, () => { picked = null; Draw(); });
        foreach (var (key, view) in new[] { (Windows.System.VirtualKey.D, "day"), (Windows.System.VirtualKey.W, "week"), (Windows.System.VirtualKey.S, "term"), (Windows.System.VirtualKey.E, "exam"), (Windows.System.VirtualKey.L, "list") })
            Key(key, () => { if (ScalesShown.Any(s => s.Key == view) && scale != view) Show(view); });
        Key(Windows.System.VirtualKey.N, () => { if (who is null) TaskSheet.New(campus, now); }, Windows.System.VirtualKeyModifiers.Control);
        Key(Windows.System.VirtualKey.Escape, () => { if (who is not null) Mine(); });
        PointerWheelChanged += (_, e) =>
        {
            if (!e.KeyModifiers.HasFlag(Windows.System.VirtualKeyModifiers.Control)) return;
            if (scale is "exam" or "list") return;
            var shown = Scales[..3];
            var at = Array.FindIndex(shown, s => s.Key == scale) + (e.GetCurrentPoint(this).Properties.MouseWheelDelta < 0 ? 1 : -1);
            if (at >= 0 && at < shown.Length) Show(shown[at].Key);
            e.Handled = true;
        };
        _ = campus.Load();
        Draw();
    }

    private void Key(Windows.System.VirtualKey key, Action act, Windows.System.VirtualKeyModifiers modifiers = Windows.System.VirtualKeyModifiers.None)
    {
        var accelerator = new KeyboardAccelerator { Key = key, Modifiers = modifiers };
        accelerator.Invoked += (_, e) => { if (App.Window?.SheetOpen == true || FocusManager.GetFocusedElement(XamlRoot) is TextBox) return; act(); e.Handled = true; };
        KeyboardAccelerators.Add(accelerator);
    }

    private (string Key, string Label)[] ScalesShown => who is null ? Scales : Scales[..^1];

    private void Show(string view)
    {
        scale = view;
        termMode = "course";
        Draw();
    }

    public override void Shown(object? argument)
    {
        if (argument is Uri address)
        {
            var query = System.Web.HttpUtility.ParseQueryString(address.Query);
            var value = query["who"]?.Split(':', 2);
            var destination = value is { Length: 2 } && value[0] is "class" or "course" or "teacher" or "room" ? new Who(value[0], value[1]) : null;
            if (destination is not null && who is null) myView = (scale, picked, termMode);
            if (who != destination) { who = destination; others = null; othersError = null; if (destination is not null) Gather(destination); }
            scale = Scales.Any(item => item.Key == query["scale"]) ? query["scale"]! : "week";
            picked = DateOnly.TryParseExact(query["t"], "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var linkedDate) ? linkedDate : null;
            termMode = scale == "term" && query["mode"] is "other" or "run" ? query["mode"]! : "course";
            preview = query["preview"]; previewRows = null; previewError = null;
            if (preview is not null) _ = GatherPreview(preview);
        }
        if (argument is DateOnly date) { who = null; others = null; preview = null; previewRows = null; picked = date; scale = "week"; }
        if (argument is "exams") { who = null; others = null; preview = null; previewRows = null; scale = "exam"; termMode = "course"; }
        if (argument is Who) { preview = null; previewRows = null; }
        if (argument is Who next && next != who) {
            if (who is null) myView = (scale, picked, termMode);
            who = next; others = null; othersError = null; picked = null; scale = "week"; termMode = "course"; Gather(next);
        }
        now = Moment.Now(); Draw();
    }

    private async Task GatherPreview(string id)
    {
        try {
            var rows = campus.Repository is { } repo ? (await repo.Meetings()).Where(meeting => meeting.TeachingClass.Id == id).ToList() : [];
            if (preview != id) return;
            previewRows = rows;
            if (rows.Count == 0) previewError = "没找到这个教学班";
        }
        catch (Exception error) when (error is HttpRequestException or IOException or TaskCanceledException or System.Text.Json.JsonException) {
            if (preview != id) return;
            previewError = "预览暂时无法加载";
        }
        DispatcherQueue.TryEnqueue(Draw);
    }

    private async void Gather(Who next)
    {
        try
        {
            var line = await campus.LineOf(next);
            if (who != next) return;
            others = line;
        }
        catch (Exception error) when (error is System.Net.Http.HttpRequestException or IOException or TaskCanceledException or System.Text.Json.JsonException)
        {
            if (who != next) return;
            othersError = "这份课表暂时无法加载，请检查网络后重试。";
        }
        Draw();
    }

    private async Task GatherRecord(Data.Repository repository, string klass)
    {
        try {
            var record = await repository.ExamRecord(klass);
            if (recordKey != (repository, klass)) return;
            examRecord = record;
        }
        catch (Exception error) when (error is System.Net.Http.HttpRequestException or IOException or TaskCanceledException or System.Text.Json.JsonException) {
            if (recordKey != (repository, klass)) return;
            recordError = "更新记录暂时无法加载";
        }
        DispatcherQueue.TryEnqueue(Draw);
    }

    /** Back to one's own timetable. */
    private void Mine()
    {
        who = null; others = null; othersError = null; preview = null; previewRows = null;
        (scale, picked, termMode) = myView ?? ("week", null, "course");
        Draw();
    }

    private void Shift(int direction)
    {
        if (scale is not ("day" or "week") || (who is null ? campus.Line : others) is not { } line) return;
        picked = Day(line).AddDays(direction * (scale == "week" ? 7 : 1));
        Draw();
    }

    private DateOnly Day(CampusLine line) => picked ?? (scale == "week" ? line.WeekShown(now) : now.Date);

    private void Draw()
    {
        if (frame is not null) scroll[frameView] = frame.VerticalOffset;
        frame = null;
        Children.Clear();
        if (campus.Error is { } error && campus.Line is null && campus.Repository is null)
        {
            Children.Add(Pages.Frame(Pages.Empty(error, Kit.TextAction("重试", () => { campus.Retry(); Draw(); }, Icons.Again))));
            return;
        }
        if (campus.Repository is null) return;
        if (campus.Preferences.Class is null || campus.Line is null && campus.Classes.All(c => c.Id != campus.Preferences.Class))
        {
            if (picker is not { } kept || kept.Classes != campus.Classes)
            {
                var made = Me.ClassPicker.Make(campus.Classes, c => campus.Preferences.SetClass(c.Id), query: pickerQuery, queryChanged: value => pickerQuery = value);
                made.Margin = new Thickness(0, 48, 0, 0);
                picker = (campus.Classes, Pages.Frame(made));
            }
            Children.Add(picker.Value.View);
            return;
        }
        picker = null;
        pickerQuery = "";
        if (who is { } other)
        {
            if (othersError is { } message) { Children.Add(Pages.Frame(Pages.Empty(message, Kit.TextAction("重试", () => { othersError = null; Gather(other); Draw(); }, Icons.Again)))); return; }
            if (others is null) { Children.Add(Pages.Frame(Pages.Header(other.Title, "正在加载课表…", Kit.Button("我的课表", Mine)))); return; }
            if (scale == "list") scale = "week";
        }
        if ((who is null ? campus.Line : others) is not { } line || campus.Term is not { } term) return;
        var mine = who is null;
        var previewIds = previewRows?.Select(meeting => meeting.Id).ToHashSet() ?? [];
        if (mine && previewRows is { Count: > 0 }) line = new CampusLine(line.Term, line.Periods, line.Meetings.Concat(previewRows).DistinctBy(meeting => meeting.Id).ToList(), line.Labs, line.Exams, line.Holidays) {
            CourseMeetings = line.CourseMeetings.Concat(previewRows).DistinctBy(meeting => meeting.Id).ToList(), Tasks = line.Tasks, CourseNames = line.CourseNames,
            Preferences = line.Preferences, Order = line.Order, Run = line.Run, RunDays = line.RunDays, RunAdjust = line.RunAdjust,
        };
        var recordClass = mine ? campus.Preferences.Class : who!.Type == "class" ? who.Id : null;
        if (recordClass is not null && recordKey != (campus.Repository, recordClass)) {
            recordKey = (campus.Repository, recordClass); examRecord = null; recordError = null; examVersion = null;
            _ = GatherRecord(campus.Repository, recordClass);
        }

        var day = Day(line);
        var ahead = picked is null ? (Clock.WeekStart(day).DayNumber - Clock.WeekStart(now.Date).DayNumber) / 7 : 0;
        var week = line.WeekOf(day); var nowWeek = line.WeekOf(now.Date);
        var monday = Clock.WeekStart(day);
        var yearName = $"{term.Year}–{term.Year + 1} 学年";
        var last = scale == "term" ? line.LastLesson() : null;
        var pending = line.Tasks.Count(t => t.Parent is null && t.Done is null && t.Deleted != true);
        var title = who is { } named ? named.Title : scale switch { "list" => "任务", "exam" => "考试", "term" => yearName, "week" => week is { } w ? $"第 {w} 周" : "假期", _ => $"{Clock.DateLabel(day)} {Clock.Weekdays[Clock.Weekday(day)]}" };
        var examsAhead = line.Exams.Count(exam => string.CompareOrdinal(exam.Date, Clock.Text(now.Date)) >= 0);
        var subtitle = scale switch
        {
            "list" => pending > 0 ? $"{pending} 项待办" : "暂无待办任务",
            "exam" => examsAhead > 0 ? $"{examsAhead} 场待考" : "暂无待考安排",
            "term" => $"本学期 · {(nowWeek is { } n ? $"第 {n} / {term.Weeks.Count} 周" : $"{term.Weeks.Count} 周")}{(last is { } l ? $" · 上课至 {Clock.DateLabel(l)}" : "")}",
            "week" => $"{(ahead == 1 ? "下周 · " : ahead > 1 ? $"{ahead} 周后 · " : "")}{Clock.DateLabel(monday)} – {Clock.DateLabel(monday.AddDays(6))}",
            _ => week is { } dw ? $"第 {dw} 周" : "假期",
        };
        if (wide && mine) subtitle += $" · {campus.Preferences.Class}";
        var actions = new List<UIElement>();
        if (mine) actions.Add(Kit.Button("添加课程", () => App.Open("search", "course")));
        if (mine) actions.Add(Kit.Button("新任务", () => TaskSheet.New(campus, now), Icons.Plus, 20));
        else actions.Add(Kit.Button("我的课表", Mine));

        FrameworkElement? dateNav = null;
        if (scale is "day" or "week")
        {
            Tap DateStep(string label, Action act, string? icon = null)
            {
                var target = 36.0;
                var tap = new Tap(Paint.Clear, Paint.Brush("surfaceSunken")) {
                    Content = icon is null ? Kit.Text(label, Role.Label) : Kit.Icon(icon, 16),
                    MinWidth = target, Height = target, Padding = new Thickness(8, 0, 8, 0),
                    CornerRadius = new CornerRadius(Paint.Number("radius", "control")),
                    HorizontalContentAlignment = HorizontalAlignment.Center, VerticalContentAlignment = VerticalAlignment.Center,
                };
                Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(tap, label);
                tap.Click += (_, _) => act(); return tap;
            }
            dateNav = Kit.Line(0,
                DateStep("上一个", () => Shift(-1), Icons.Back),
                DateStep("今天", () => { picked = null; Draw(); }),
                DateStep("下一个", () => Shift(1), Icons.Chevron));
        }

        var page = new StackPanel();
        page.Children.Add(Pages.Header(title, subtitle, actions.ToArray()));
        var tabs = Kit.Tabs(ScalesShown, scale, Show, separateBefore: "list");
        if (dateNav is not null && wide)
        {
            var tabBar = new Grid { BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 0, 0, 1), Margin = new Thickness(0, 0, 0, 16) };
            tabBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            tabBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            if (tabs is Border tabBorder) tabBorder.BorderThickness = new Thickness(0);
            tabBar.Children.Add(tabs);
            dateNav.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetColumn(dateNav, 1); tabBar.Children.Add(dateNav);
            page.Children.Add(tabBar);
        }
        else
        {
            tabs.Margin = new Thickness(0, 0, 0, dateNav is not null ? 8 : 16);
            page.Children.Add(tabs);
            if (dateNav is not null)
            {
                dateNav.HorizontalAlignment = HorizontalAlignment.Right;
                dateNav.Margin = new Thickness(0, 0, 0, 8);
                page.Children.Add(dateNav);
            }
        }
        if (preview is { } previewId) {
            var words = previewRows is { Count: > 0 } ? $"预览 · {Names.Course(previewRows[0].Course.Name)}" : previewError ?? "正在加载课表预览…";
            var previewBar = Kit.Column(8, Kit.Text(words, Role.Body, bold: true));
            var buttons = Kit.Line(12, Kit.TextAction("取消预览", () => { preview = null; previewRows = null; Draw(); }));
            if (previewRows is { Count: > 0 }) {
                var own = campus.ClassMeetings.Any(meeting => meeting.TeachingClass.Id == previewId);
                var edits = Me.Choices.Edits(campus.Preferences, term.Term);
                if (own && !edits.Hidden.Contains(previewId) || edits.Added.Contains(previewId)) buttons.Children.Add(Kit.Text("已在我的课表", Role.Label, "muted"));
                else buttons.Children.Add(Kit.Action(own ? "恢复到课表" : "加入课表", () => {
                    preview = null; previewRows = null;
                    if (own) Me.Choices.Restore(campus.Preferences, term.Term, previewId); else Me.Choices.Add(campus.Preferences, term.Term, previewId);
                    Draw();
                }, go: true));
            } else if (previewError is not null) buttons.Children.Add(Kit.TextAction("重试", () => { previewError = null; _ = GatherPreview(previewId); Draw(); }, Icons.Again));
            previewBar.Children.Add(buttons); previewBar.Margin = new Thickness(0, 0, 0, 18); page.Children.Add(previewBar);
        }
        void Open(LineEvent e) { if (e.Task is { } task) TaskSheet.Open(campus, task.Id, now); else Events.Open(campus, e, now, !mine || e.Meeting is { } meeting && previewIds.Contains(meeting.Id) ? line : null); }
        void OpenTask(World.PersonalTask task) => TaskSheet.Open(campus, task.Id, now);
        var record = recordClass is not null ? examRecord : null;
        page.Children.Add(scale switch
        {
            "week" => WeekView.Make(line, day, now, wide, Open, OpenTask),
            "day" => DayView.Make(line, day, now, Open, OpenTask, date => { picked = date == now.Date ? null : date; Draw(); }, mine),
            "term" or "exam" => TermView.Make(line, recordClass, now, scale == "exam", wide, termMode, mode => { termMode = mode; Draw(); }, () => Show("exam"), date => { picked = date; Show("week"); }, Open, record, examVersion, value => examVersion = value),
            _ => ListView.Make(campus, line, now, OpenTask, Open, roomy),
        });
        if (scale == "exam" && recordClass is not null && recordError is { } recordMessage) page.Children.Add(Kit.TextAction($"{recordMessage} · 重试", () => { recordError = null; _ = GatherRecord(campus.Repository, recordClass); Draw(); }));
        var nextFrame = scale == "exam" && record is null ? Pages.Frame(page, width: 744) : Pages.Frame(page);
        frame = nextFrame;
        frameView = (who, scale, termMode);
        var keep = scroll.GetValueOrDefault(frameView);
        if (keep > 0) nextFrame.Loaded += (_, _) => nextFrame.ChangeView(null, keep, null, true);
        Children.Add(nextFrame);
    }
}
