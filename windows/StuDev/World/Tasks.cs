using System.Text.Json;
using StuDev.Data;

namespace StuDev.World;

public sealed record Deadline(string Date, int? Time = null, List<int>? Remind = null);
public sealed record PersonalTask
{
    public required string Id { get; init; }
    public required string Title { get; init; }
    public required string Modified { get; init; }
    public string? Note { get; init; }
    public string? Date { get; init; }
    public int? Start { get; init; }
    public int? End { get; init; }
    public Deadline? Due { get; init; }
    public List<int>? Remind { get; init; }
    public int? Priority { get; init; }
    public string? Parent { get; init; }
    public string? Course { get; init; }
    public double? Order { get; init; }
    public string? Done { get; init; }
    public bool? Deleted { get; init; }
}

/** The list and the timeline read the same tasks. Deletions stay until a later sync has seen them. */
public sealed class Tasks
{
    private static string File => Storage.PathFor("tasks.json");
    public List<PersonalTask> All { get; private set; }
    public IEnumerable<PersonalTask> Live => All.Where(t => t.Deleted != true);
    public event Action? Changed;
    public event Action<bool>? Saved;
    public Tasks() => All = System.IO.File.Exists(File)
        ? JsonSerializer.Deserialize<List<PersonalTask>>(System.IO.File.ReadAllText(File), Storage.Json) ?? throw new InvalidDataException("tasks") : [];

    public void Put(PersonalTask item)
    {
        PutMany([item]);
    }
    public void PutMany(IEnumerable<PersonalTask> items)
    {
        var changed = items.ToList();
        foreach (var item in changed)
        {
            if (item.Date is not null && item.Start is null) throw new ArgumentException("执行安排需要开始时间。");
            if (string.IsNullOrWhiteSpace(item.Title)) throw new ArgumentException("写下要做的事。");
            if (item.Date is not null && !DateOnly.TryParseExact(item.Date, "yyyy-MM-dd", out _) || item.Due is not null && !DateOnly.TryParseExact(item.Due.Date, "yyyy-MM-dd", out _)) throw new ArgumentException("日期无效。");
            if (item.Start is < 0 or > 1439 || item.End is < 1 or > 1440 || item.Start is not null && item.End <= item.Start || item.Due?.Time is < 0 or > 1439) throw new ArgumentException("时间无效。");
        }
        var ids = changed.Select(t => t.Id).ToHashSet(); var stamp = Me.Preferences.Stamp();
        Write(All.Where(t => !ids.Contains(t.Id)).Concat(changed.Select(t => t with { Modified = stamp })).ToList());
    }
    public void Toggle(PersonalTask item) => Put(item with { Done = item.Done is null ? Me.Preferences.Stamp() : null });
    public void Delete(string id)
    {
        Write(All.Select(t => t.Id == id || t.Parent == id
            ? new PersonalTask { Id = t.Id, Title = t.Title, Deleted = true, Modified = Me.Preferences.Stamp() } : t).ToList());
    }
    public void Adopt(List<PersonalTask> incoming)
    {
        var next = TaskRules.Merge(All, incoming);
        if (JsonSerializer.Serialize(All, Storage.Json) == JsonSerializer.Serialize(next, Storage.Json)) return;
        Write(next, true);
    }
    private void Write(List<PersonalTask> next, bool adopt = false)
    {
        Storage.Write(File, JsonSerializer.Serialize(next, Storage.Json)); All = next; Changed?.Invoke(); Saved?.Invoke(adopt);
    }
}

public static class TaskRules
{
    public static readonly string[] Groups = ["overdue", "today", "tomorrow", "week", "later", "someday"];
    /** The groups a task can be dragged into: they give it a day, or take its day away. */
    public static readonly string[] DropGroups = ["today", "tomorrow", "someday"];
    public static readonly (int Minutes, string Name)[] TimedReminders = [(0, "准时"), (15, "提前 15 分钟"), (60, "提前 1 小时"), (1440, "提前 1 天")];
    public static readonly (int Minutes, string Name)[] DayReminders = [(8 * 60, "当天 8:00"), (12 * 60, "当天 12:00"), (20 * 60, "当天 20:00")];
    public static readonly string[] Examples = ["明天下午3点 交毛概作业 !!", "周五前 交实验报告", "晚上8点到10点 自习", "下周三 答辩 #"];
    public static string NewId() => Guid.NewGuid().ToString();
    public static readonly string[] GroupNames = ["待补做", "今天", "明天", "未来 7 天", "更晚", "还没排日期"];
    public static List<PersonalTask> Merge(List<PersonalTask> mine, List<PersonalTask> theirs)
    {
        var merged = mine.ToDictionary(t => t.Id);
        foreach (var item in theirs)
            if (!merged.TryGetValue(item.Id, out var kept) || string.CompareOrdinal(item.Modified, kept.Modified) > 0) merged[item.Id] = item;
        return merged.Values.OrderBy(t => t.Id, StringComparer.Ordinal).ToList();
    }
    public static (string Date, int Time)? When(PersonalTask task)
    {
        var times = new List<(string Date, int Time)>();
        if (task.Date is not null) times.Add((task.Date, task.End ?? task.Start ?? 1440));
        if (task.Due is not null) times.Add((task.Due.Date, task.Due.Time ?? 1440));
        return times.Count == 0 ? null : times.OrderBy(t => t.Date, StringComparer.Ordinal).ThenBy(t => t.Time).First();
    }
    public static string Group(PersonalTask task, Moment now)
    {
        var at = When(task); if (at is null) return "someday";
        var days = Clock.Parse(at.Value.Date).DayNumber - now.Date.DayNumber;
        if (days < 0 || days == 0 && at.Value.Time <= now.Min) return "overdue";
        return days == 0 ? "today" : days == 1 ? "tomorrow" : days <= 7 ? "week" : "later";
    }
    public static readonly IComparer<PersonalTask> Order = Comparer<PersonalTask>.Create((a, b) =>
    {
        var order = a.Order is null ? b.Order is null ? 0 : 1 : b.Order is null ? -1 : a.Order.Value.CompareTo(b.Order.Value);
        if (order != 0) return order;
        var aa = When(a); var bb = When(b);
        var byDay = string.CompareOrdinal(aa?.Date ?? "9999", bb?.Date ?? "9999"); if (byDay != 0) return byDay;
        var byTime = (aa?.Time ?? 1440).CompareTo(bb?.Time ?? 1440); if (byTime != 0) return byTime;
        var priority = (b.Priority ?? 0).CompareTo(a.Priority ?? 0);
        return priority != 0 ? priority : string.CompareOrdinal(a.Id, b.Id);
    });
    public static Moment? ReminderAt(PersonalTask task, int remind, string anchor = "plan")
    {
        var day = anchor == "due" ? task.Due?.Date : task.Date;
        var time = anchor == "due" ? task.Due?.Time : task.Start;
        if (day is null) return null;
        var date = Clock.Parse(day); if (time is null) return new(date, remind);
        var min = time.Value - remind;
        while (min < 0) { min += 1440; date = date.AddDays(-1); }
        return new(date, min);
    }
    public static List<PersonalTask> Move(PersonalTask task, string group, int index, List<PersonalTask> shown, Moment now)
    {
        var moved = task;
        if (group != Group(task, now))
        {
            if (group is not ("today" or "tomorrow" or "someday")) return [];
            if (group == "someday") moved = task with { Date = null, Start = null, End = null, Remind = null, Due = null };
            else
            {
                var day = Clock.Text(now.Date.AddDays(group == "today" ? 0 : 1));
                var planFirst = task.Date is not null && (task.Due is null || string.CompareOrdinal(task.Date + (task.End ?? task.Start ?? 1440).ToString("D4"), task.Due.Date + (task.Due.Time ?? 1440).ToString("D4")) <= 0);
                moved = planFirst ? task with { Date = day } : task with { Due = task.Due is null ? new(day) : task.Due with { Date = day } };
            }
        }
        var list = shown.Where(t => t.Id != task.Id).ToList(); list.Insert(Math.Clamp(index, 0, list.Count), moved);
        return list.Select((t, i) => t with { Order = i }).Where((t, i) => t.Id == moved.Id || list[i].Order != i).ToList();
    }
}
