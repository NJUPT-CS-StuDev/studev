// The timetable: one's line through the term unfolded as a day, a week, the whole term, or a list of what is to be
// done. TimetableApp.tsx, natively: the same title and line under it, the same buttons, the same four tabs.
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
    private double lastScroll;
    private ScrollViewer? frame;
    private string termMode = "course";

    public TimetableScreen()
    {
        campus.Changed += () => DispatcherQueue.TryEnqueue(Draw);
        Paint.Turned += Draw;
        clock.Tick += (_, _) => { var next = Moment.Now(); if (next != now) { now = next; Draw(); } };
        clock.Start();
        SizeChanged += (_, e) => { var next = e.NewSize.Width >= 900; if (next != wide) { wide = next; Draw(); } };
        KeyboardAcceleratorPlacementMode = KeyboardAcceleratorPlacementMode.Hidden;
        Key(Windows.System.VirtualKey.Left, () => Shift(-1));
        Key(Windows.System.VirtualKey.Right, () => Shift(1));
        Key(Windows.System.VirtualKey.T, () => { picked = null; Draw(); });
        Key(Windows.System.VirtualKey.N, () => TaskSheet.New(campus, now), Windows.System.VirtualKeyModifiers.Control);
        PointerWheelChanged += (_, e) =>
        {
            if (!e.KeyModifiers.HasFlag(Windows.System.VirtualKeyModifiers.Control)) return;
            var at = Array.FindIndex(Scales, s => s.Key == scale) + (e.GetCurrentPoint(this).Properties.MouseWheelDelta < 0 ? 1 : -1);
            if (at >= 0 && at < Scales.Length) { scale = Scales[at].Key; Draw(); }
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

    public override void Shown(object? argument)
    {
        if (argument is DateOnly date) { picked = date; scale = "week"; }
        now = Moment.Now(); Draw();
    }

    private void Shift(int direction)
    {
        if (scale is "term" or "list" || campus.Line is not { } line) return;
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
        if (campus.Line is not { } line || campus.Term is not { } term) return;

        var day = Day(line);
        var ahead = picked is null ? (Clock.WeekStart(day).DayNumber - Clock.WeekStart(now.Date).DayNumber) / 7 : 0;
        var week = line.WeekOf(day); var nowWeek = line.WeekOf(now.Date);
        var monday = Clock.WeekStart(day);
        var termName = $"{term.Year}–{term.Year + 1} 学年第{(term.Number == 1 ? "一" : "二")}学期";
        var last = scale == "term" ? line.LastLesson() : null;
        var pending = line.Tasks.Count(t => t.Parent is null && t.Done is null && t.Deleted != true);
        var title = scale switch { "list" => "清单", "term" => termName, "week" => week is { } w ? $"第 {w} 周" : "假期", _ => $"{Clock.DateLabel(day)} {Clock.Weekdays[Clock.Weekday(day)]}" };
        var first = Clock.Parse(term.Weeks[0].Start); var end = Clock.Parse(term.Weeks[^1].End);
        var subtitle = scale switch
        {
            "list" => pending > 0 ? $"{pending} 件要做" : "没有要做的事",
            "term" => $"{Clock.DateLabel(first)} – {Clock.DateLabel(end)} · {(nowWeek is { } n ? $"第 {n} / {term.Weeks.Count} 周" : $"{term.Weeks.Count} 周")}{(last is { } l ? $" · 课上到 {Clock.DateLabel(l)}" : "")}",
            "week" => $"{(ahead == 1 ? "下周 · " : ahead > 1 ? $"{ahead} 周后 · " : "")}{Clock.DateLabel(monday)} – {Clock.DateLabel(monday.AddDays(6))}",
            _ => week is { } dw ? $"第 {dw} 周" : "假期",
        };
        if (wide) subtitle += $" · {campus.Preferences.Class}";
        var actions = new List<UIElement>();
        if (scale is "day" or "week")
        {
            actions.Add(Kit.Button("上一个", () => Shift(-1), Icons.Back, iconOnly: true));
            actions.Add(Kit.Button("今天", () => { picked = null; Draw(); }));
            actions.Add(Kit.Button("下一个", () => Shift(1), Icons.Chevron, iconOnly: true));
        }
        actions.Add(Kit.Button("新任务", () => TaskSheet.New(campus, now), Icons.Plus, 20));

        var page = new StackPanel();
        page.Children.Add(Pages.Header(title, subtitle, actions.ToArray()));
        var tabs = Kit.Tabs(Scales, scale, key => { scale = key; Draw(); }); tabs.Margin = new Thickness(0, 0, 0, 20);
        page.Children.Add(tabs);
        void Open(LineEvent e) { if (e.Task is { } task) TaskSheet.Open(campus, task.Id, now); else Events.Open(campus, e, now); }
        void OpenTask(World.PersonalTask task) => TaskSheet.Open(campus, task.Id, now);
        page.Children.Add(scale switch
        {
            "week" => WeekView.Make(line, day, now, wide, Open, OpenTask),
            "day" => DayView.Make(line, day, now, Open, OpenTask, date => { picked = date == now.Date ? null : date; Draw(); }),
            "term" => TermView.Make(line, now, termMode, mode => { termMode = mode; Draw(); }, date => { picked = date; scale = "week"; Draw(); }, Open),
            _ => ListView.Make(campus, line, now, OpenTask, Open),
        });
        frame = Pages.Frame(page);
        var keep = lastScroll;
        frame.Loaded += (_, _) => frame.ChangeView(null, keep, null, true);
        Children.Add(frame);
    }
}
