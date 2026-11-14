// The timetable: one's line through the term unfolded as a day, a week, the whole term, or a list of what is to be
// done. TimetableApp.tsx, natively: the same title and line under it, the same buttons, the same four tabs. Opened on
// someone else (a teacher, a room, a course, a class) it shows their line the same way, without the list of one's own.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using StuDev.Ui;
using StuDev.World;

namespace StuDev.Timetable;

public sealed partial class TimetableScreen : Screen
{
    private static readonly (string Key, string Label)[] Scales = [("day", "天"), ("week", "周"), ("term", "学期"), ("list", "清单")];
    private readonly Campus campus = Campus.Shared;
    private readonly DispatcherTimer clock = new() { Interval = TimeSpan.FromSeconds(30) };
    private string scale = "week";
    private DateOnly? picked;
    private Moment now = Moment.Now();
    private bool wide = true;
    /** Room for a task open beside the list. */
    private bool roomy = true;
    private double lastScroll;
    private ScrollViewer? frame;
    private string termMode = "course";
    /** Whose timetable this is when it is not one's own, and their line once it is gathered. */
    private Who? who;
    private CampusLine? others;
    private string? othersError;

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
        // One key for each view, as calendars have them: D 天, W 周, S 学期, L 清单.
        foreach (var (key, view) in new[] { (Windows.System.VirtualKey.D, "day"), (Windows.System.VirtualKey.W, "week"), (Windows.System.VirtualKey.S, "term"), (Windows.System.VirtualKey.L, "list") })
            Key(key, () => { if (ScalesShown.Any(s => s.Key == view) && scale != view) { scale = view; Draw(); } });
        Key(Windows.System.VirtualKey.N, () => { if (who is null) TaskSheet.New(campus, now); }, Windows.System.VirtualKeyModifiers.Control);
        Key(Windows.System.VirtualKey.Escape, () => { if (who is not null) Mine(); });
        PointerWheelChanged += (_, e) =>
        {
            if (!e.KeyModifiers.HasFlag(Windows.System.VirtualKeyModifiers.Control)) return;
            var shown = ScalesShown;
            var at = Array.FindIndex(shown, s => s.Key == scale) + (e.GetCurrentPoint(this).Properties.MouseWheelDelta < 0 ? 1 : -1);
            if (at >= 0 && at < shown.Length) { scale = shown[at].Key; Draw(); }
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

    private (string Key, string Label)[] ScalesShown => who is null ? Scales : Scales[..3];

    public override void Shown(object? argument)
    {
        if (argument is DateOnly date) { picked = date; scale = "week"; }
        if (argument is "exams") { scale = "term"; termMode = "exam"; }
        if (argument is Who next && next != who) { who = next; others = null; othersError = null; picked = null; scale = "week"; Gather(next); }
        now = Moment.Now(); Draw();
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
            othersError = "连不上 StuDev，暂时看不到这份课表。";
        }
        Draw();
    }

    /** Back to one's own timetable. */
    private void Mine() { who = null; others = null; othersError = null; picked = null; Draw(); }

    private void Shift(int direction)
    {
        if (scale is "term" or "list" || (who is null ? campus.Line : others) is not { } line) return;
        picked = Day(line).AddDays(direction * (scale == "week" ? 7 : 1));
        Draw();
    }

    private DateOnly Day(CampusLine line) => picked ?? (scale == "week" ? line.WeekShown(now) : now.Date);

    private void Draw()
    {
        lastScroll = frame?.VerticalOffset ?? 0;
        Children.Clear();
        if (campus.Error is { } error && campus.Line is null && campus.Repository is null)
        {
            Children.Add(Pages.Frame(Pages.Empty(error, Kit.Action("重试", () => { campus.Retry(); Draw(); }))));
            return;
        }
        if (campus.Repository is null) return;
        if (campus.Preferences.Class is null || campus.Line is null && campus.Classes.All(c => c.Id != campus.Preferences.Class))
        {
            var picker = Me.ClassPicker.Make(campus.Classes, c => campus.Preferences.SetClass(c.Id));
            picker.Margin = new Thickness(0, 48, 0, 0);
            Children.Add(Pages.Frame(picker));
            return;
        }
        if (who is { } other)
        {
            if (othersError is { } message) { Children.Add(Pages.Frame(Pages.Empty(message, Kit.Action("重试", () => { othersError = null; Gather(other); Draw(); })))); return; }
            if (others is null) { Children.Add(Pages.Frame(Pages.Header(other.Title, "正在读取这份课表…", Kit.Button("我的课表", Mine)))); return; }
            if (scale == "list") scale = "week";
        }
        if ((who is null ? campus.Line : others) is not { } line || campus.Term is not { } term) return;
        var mine = who is null;

        var day = Day(line);
        var ahead = picked is null ? (Clock.WeekStart(day).DayNumber - Clock.WeekStart(now.Date).DayNumber) / 7 : 0;
        var week = line.WeekOf(day); var nowWeek = line.WeekOf(now.Date);
        var monday = Clock.WeekStart(day);
        var termName = $"{term.Year}–{term.Year + 1} 学年第{(term.Number == 1 ? "一" : "二")}学期";
        var last = scale == "term" ? line.LastLesson() : null;
        var pending = line.Tasks.Count(t => t.Parent is null && t.Done is null && t.Deleted != true);
        var title = who is { } named ? named.Title : scale switch { "list" => "清单", "term" => termName, "week" => week is { } w ? $"第 {w} 周" : "假期", _ => $"{Clock.DateLabel(day)} {Clock.Weekdays[Clock.Weekday(day)]}" };
        var first = Clock.Parse(term.Weeks[0].Start); var end = Clock.Parse(term.Weeks[^1].End);
        var subtitle = scale switch
        {
            "list" => pending > 0 ? $"{pending} 件要做" : "没有要做的事",
            "term" => $"{Clock.DateLabel(first)} – {Clock.DateLabel(end)} · {(nowWeek is { } n ? $"第 {n} / {term.Weeks.Count} 周" : $"{term.Weeks.Count} 周")}{(last is { } l ? $" · 课上到 {Clock.DateLabel(l)}" : "")}",
            "week" => $"{(ahead == 1 ? "下周 · " : ahead > 1 ? $"{ahead} 周后 · " : "")}{Clock.DateLabel(monday)} – {Clock.DateLabel(monday.AddDays(6))}",
            _ => week is { } dw ? $"第 {dw} 周" : "假期",
        };
        if (wide && mine) subtitle += $" · {campus.Preferences.Class}";
        var actions = new List<UIElement>();
        if (scale is "day" or "week")
        {
            actions.Add(Kit.Button("上一个", () => Shift(-1), Icons.Back, iconOnly: true));
            actions.Add(Kit.Button("今天", () => { picked = null; Draw(); }));
            actions.Add(Kit.Button("下一个", () => Shift(1), Icons.Chevron, iconOnly: true));
        }
        if (mine) actions.Add(Kit.Button("新任务", () => TaskSheet.New(campus, now), Icons.Plus, 20));
        else actions.Add(Kit.Button("我的课表", Mine));

        var page = new StackPanel();
        page.Children.Add(Pages.Header(title, subtitle, actions.ToArray()));
        var tabs = Kit.Tabs(ScalesShown, scale, key => { scale = key; Draw(); }); tabs.Margin = new Thickness(0, 0, 0, 20);
        page.Children.Add(tabs);
        void Open(LineEvent e) { if (e.Task is { } task) TaskSheet.Open(campus, task.Id, now); else Events.Open(campus, e, now, mine ? null : line); }
        void OpenTask(World.PersonalTask task) => TaskSheet.Open(campus, task.Id, now);
        page.Children.Add(scale switch
        {
            "week" => WeekView.Make(line, day, now, wide, Open, OpenTask),
            "day" => DayView.Make(line, day, now, Open, OpenTask, date => { picked = date == now.Date ? null : date; Draw(); }, mine),
            "term" => TermView.Make(line, mine ? campus.Preferences.Class : who!.Type == "class" ? who.Id : null, now, termMode, mode => { termMode = mode; Draw(); }, date => { picked = date; scale = "week"; Draw(); }, Open),
            _ => ListView.Make(campus, line, now, OpenTask, Open, roomy),
        });
        frame = Pages.Frame(page);
        var keep = lastScroll;
        frame.Loaded += (_, _) => frame.ChangeView(null, keep, null, true);
        Children.Add(frame);
    }
}
