using StuDev.Data;

namespace StuDev.World;

/** Public exam versions and their selected class's impact; the TypeScript implementation owns the answers. */
public static class Exams
{
    public sealed record Version(string Id, string? Observed, string? Published, bool Baseline, List<ExamSource> Files, List<ExamChange> Changes);
    public static List<Version> History(ExamRecord record) => record.History.Select(version => new Version(version.Id, version.Observed, version.Published, version.Baseline, version.Files, record.Changes.Where(change => change.Version == version.Id).ToList())).Reverse().ToList();
    public static string Impact(bool baseline, List<ExamChange> changes) => baseline ? "首次记录" : changes.Count > 0 ? $"本班 {changes.Count} 门考试有变动" : "本次更新未影响本班";
    public static string Time(string value)
    {
        if (value.Length == 10) return Clock.DateLabel(Clock.Parse(value));
        var local = CampusDay.At(DateTimeOffset.Parse(value, System.Globalization.CultureInfo.InvariantCulture));
        return $"{local.Month}月{local.Day}日 {local:HH:mm}";
    }
    public static string VersionTime(ExamVersion version) => version.Observed is { } at ? $"{Time(at)} 发现" : $"{Time(version.Published!)} 官方发布";
    public static string VersionTime(Version version) => version.Observed is { } at ? $"{Time(at)} 发现" : $"{Time(version.Published!)} 官方发布";
    public static string FileName(string file) => System.Text.RegularExpressions.Regex.Replace(file, @"^\d{4}-\d{2}-\d{2}-", "");
    public static List<ExamChange> ChangesOf(ExamRecord? record, Exam exam) => record?.Changes.Where(change => change.Change != "removed" && (change.Course.Code ?? change.Course.Name) == (exam.Course.Code ?? exam.Course.Name) && (change.After?.Any(slot => slot.Date == exam.Date && slot.Start == exam.Start) ?? false)).ToList() ?? [];
    private static readonly (string Label, Func<ExamSlot, string?> Read)[] Fields = [
        ("时间", slot => $"{slot.Date} {slot.Start}–{slot.End}"), ("地点", slot => slot.Location), ("校区", slot => slot.Campus), ("老师", slot => slot.Teacher), ("人数", slot => slot.Students?.ToString()), ("备注", slot => slot.Note),
    ];
    private static string SlotText(List<ExamSlot>? slots, Func<ExamSlot, string?> read) => slots is { Count: > 0 } ? string.Join("、", slots.Select(slot => read(slot) is { Length: > 0 } value ? value : "未填写").Distinct()) : "未填写";
    public static List<string> ChangeLines(ExamChange change) => change.Change switch {
        "changed" => Fields.Select(field => (field.Label, Before: SlotText(change.Before, field.Read), After: SlotText(change.After, field.Read))).Where(field => field.Before != field.After).Select(field => $"{field.Label}：{field.Before} → {field.After}").ToList(),
        "added" => [$"{SlotText(change.After, Fields[0].Read)} · {SlotText(change.After, Fields[1].Read)}"],
        _ => [$"原定 {SlotText(change.Before, Fields[0].Read)}"],
    };
    public static string ChangeName(string value) => value switch { "added" => "新增", "changed" => "调整", _ => "已移除" };
}
