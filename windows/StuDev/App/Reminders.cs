// Reminders as Windows notifications, the same as Android's (LessonReminders.kt): lessons, labs and exams a set time
// before they start when lesson reminders are on, and one's own tasks when each was asked to. A notification opens
// StuDev, and a lesson's offers the way to its room. Each is sent once.
using System.Text.Json;
using Microsoft.UI.Dispatching;
using Microsoft.Windows.AppNotifications;
using Microsoft.Windows.AppNotifications.Builder;
using StuDev.Data;
using StuDev.Me;
using StuDev.World;

namespace StuDev;

internal static class Reminders
{
    private const string File = "reminded.json";
    private static readonly HashSet<string> Sent = Storage.Read(File) is { } text ? JsonSerializer.Deserialize(text, DeviceJson.Default.ListString)!.ToHashSet() : [];
    private static DispatcherQueueTimer? timer;

    public static void Start(DispatcherQueue queue)
    {
        AppNotificationManager.Default.NotificationInvoked += (_, e) => queue.TryEnqueue(() =>
        {
            App.Window?.Bring();
            if (e.Arguments.TryGetValue("nav", out var room)) App.Open("map", ("nav", room));
            else App.Open("timetable");
        });
        AppNotificationManager.Default.Register();
        timer = queue.CreateTimer(); timer.Interval = TimeSpan.FromSeconds(30); timer.Tick += (_, _) => Check();
        timer.Start();
        Check();
    }

    private static DateTime At(DateOnly date, int minute) => date.ToDateTime(TimeOnly.MinValue).AddMinutes(minute);

    private static void Check()
    {
        var campus = Campus.Shared;
        var now = CampusDay.Now();
        var plans = new List<(string Id, string Title, string? Room, DateTime At, DateTime Start)>();
        if (Device.Settings.Reminders && campus.Line is { } line)
        {
            var lead = Math.Clamp(Device.Settings.Lead, 1, 120);
            for (var d = 0; d < 2; d++)
                foreach (var e in line.On(DateOnly.FromDateTime(now).AddDays(d)).Where(e => e.Kind is "class" or "lab" or "exam"))
                    plans.Add(($"{e.Id}", $"{(e.Kind == "exam" ? "考试" : e.Kind == "lab" ? "实验" : "上课")}还有 {lead} 分钟 · {e.Name}", e.Room, At(e.Date, e.Start).AddMinutes(-lead), At(e.Date, e.Start)));
        }
        foreach (var task in campus.Tasks.Live.Where(t => t.Parent is null && t.Done is null))
            foreach (var (anchor, list) in new[] { ("plan", task.Remind ?? []), ("due", task.Due?.Remind ?? []) })
                foreach (var remind in list)
                {
                    if (TaskRules.ReminderAt(task, remind, anchor) is not { } at) continue;
                    var day = Clock.Parse(anchor == "due" ? task.Due!.Date : task.Date!);
                    var time = anchor == "due" ? task.Due!.Time ?? 1439 : task.Start ?? 0;
                    plans.Add(($"task:{task.Id}:{anchor}:{remind}", anchor == "due" ? $"截止提醒 · {task.Title}" : remind == 0 ? $"任务开始 · {task.Title}" : $"执行提醒 · {task.Title}", null, At(at.Date, at.Min), At(day, time)));
                }
        var changed = false;
        foreach (var plan in plans.Where(p => p.At <= now && now < p.Start && !Sent.Contains(p.Id)))
        {
            var builder = new AppNotificationBuilder().AddText(plan.Title).AddText(plan.Room is not null ? Names.Room(plan.Room) : "打开 StuDev 查看详情");
            if (plan.Room is not null && Names.Placed(plan.Room)) builder.AddButton(new AppNotificationButton($"导航到 {Names.Room(plan.Room)}").AddArgument("nav", plan.Room));
            AppNotificationManager.Default.Show(builder.BuildNotification());
            Sent.Add(plan.Id); changed = true;
        }
        if (!changed) return;
        // Only what could still come round is kept: the last two days' ids.
        var keep = plans.Select(p => p.Id).ToHashSet();
        Sent.RemoveWhere(id => !keep.Contains(id));
        Storage.Write(Storage.PathFor(File), JsonSerializer.Serialize(Sent.ToList(), DeviceJson.Default.ListString));
    }
}
