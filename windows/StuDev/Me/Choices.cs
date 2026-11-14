using StuDev.Data;
using StuDev.World;

namespace StuDev.Me;

public sealed record CustomCourse(string Id, string Name, List<int> Days, List<int> Periods, List<int> Weeks, string? Room = null, string? Teacher = null);
public sealed record TimetableEdits(List<string> Hidden, List<string> Added, Dictionary<string, string>? Names = null, List<CustomCourse>? Custom = null);
public sealed record LabChoices(List<string>? Off = null, List<string>? Drop = null, List<string>? Skip = null, List<string>? Classes = null);
public sealed record EventChoice(string? Avoid = null, long? Layer = null);
public sealed record RunSettings(List<string> Days, int Adjust = 0, bool? On = null);

public static class Choices
{
    /** Changes one term's edits of the timetable: what is hidden, added, renamed, one's own courses. */
    public static void Edit(Preferences prefs, string term, Func<TimetableEdits, TimetableEdits> change)
    {
        var all = prefs.Get("timetable", Data.StorageJson.Default.DictionaryStringTimetableEdits) ?? new();
        all[term] = change(all.GetValueOrDefault(term) ?? new([], []));
        prefs.Set("timetable", all, Data.StorageJson.Default.DictionaryStringTimetableEdits);
    }
    /** Hides a course from one's timetable, or takes back one added; one's own course is deleted. */
    public static void Hide(Preferences prefs, string term, string id) => Edit(prefs, term, edits => id.StartsWith("custom:")
        ? edits with { Custom = (edits.Custom ?? []).Where(c => $"custom:{c.Id}" != id).ToList() }
        : edits.Added.Contains(id) ? edits with { Added = edits.Added.Where(a => a != id).ToList() } : edits with { Hidden = [.. edits.Hidden, id] });
    public static void Rename(Preferences prefs, string term, string identity, string? name) => Edit(prefs, term, edits =>
    {
        var names = new Dictionary<string, string>(edits.Names ?? new());
        if (name is null) names.Remove(identity); else names[identity] = name;
        return edits with { Names = names.Count > 0 ? names : null };
    });
    /** Leaves out one lab (skip, by its id) or one lab course (drop, by its course key). */
    public static void LeaveLab(Preferences prefs, string key, string value)
    {
        var labs = prefs.Get("labs", Data.StorageJson.Default.LabChoices) ?? new();
        labs = key == "skip" ? labs with { Skip = [.. (labs.Skip ?? []).Append(value).Distinct()] } : labs with { Drop = [.. (labs.Drop ?? []).Append(value).Distinct()] };
        prefs.Set("labs", labs, Data.StorageJson.Default.LabChoices);
    }
    public static void SkipExam(Preferences prefs, string term, string klass, string exam)
    {
        var all = prefs.Get("examAttendance", Data.StorageJson.Default.DictionaryStringDictionaryStringBoolean) ?? new();
        var mine = all.GetValueOrDefault($"{term}:{klass}") ?? new();
        mine[exam] = false; all[$"{term}:{klass}"] = mine;
        prefs.Set("examAttendance", all, Data.StorageJson.Default.DictionaryStringDictionaryStringBoolean);
    }
    public static TimetableEdits Edits(Preferences prefs, string term) => prefs.Get("timetable", Data.StorageJson.Default.DictionaryStringTimetableEdits)?.GetValueOrDefault(term) ?? new([], []);
    public static string LabSheet(Lab lab)
    {
        var file = System.Text.RegularExpressions.Regex.Replace(lab.Source, @"\.[a-z]+$", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        file = System.Text.RegularExpressions.Regex.Replace(file, @"^\d{4}-\d{2}-\d{2}-", "");
        return System.Text.RegularExpressions.Regex.Replace(file, @"\d{4}-\d{4}学年第[一二]学期", "").Replace("-学生用表", "");
    }
    public static string LabCourse(Lab lab) => $"{LabSheet(lab)}:{System.Text.RegularExpressions.Regex.Replace(lab.Course.Name.Normalize(System.Text.NormalizationForm.FormKC).Trim().ToLowerInvariant(), @"\s+", " ")}";
    public static List<Lab> Labs(IEnumerable<Lab> labs, LabChoices? choices) => labs.Where(l =>
        choices?.Off?.Contains(LabSheet(l)) != true && choices?.Drop?.Contains(LabCourse(l)) != true && choices?.Skip?.Contains(l.Id) != true).ToList();
    public static string PreferenceKey(LineEvent e, string term, bool series = false)
    {
        if (e.Task is not null) return $"task:{e.Id}";
        var id = e.Id;
        if (series)
        {
            var code = e.Meeting?.Course.Code ?? e.Lab?.Course.Code ?? e.Exam?.Course.Code;
            var name = e.Meeting?.Course.Name ?? e.Lab?.Course.Name ?? e.Exam?.Course.Name;
            id = e.Lab is { } lab ? LabCourse(lab) : !string.IsNullOrWhiteSpace(code) ? code.Trim().ToUpperInvariant() : e.Meeting?.TeachingClass.Id ?? name?.Trim() ?? e.Kind;
        }
        return $"{term}:{e.Kind}:{(series ? "course:" : "")}{id}";
    }
    public static EventChoice Preference(LineEvent e, string term, Dictionary<string, EventChoice>? preferences)
    {
        var series = preferences?.GetValueOrDefault(PreferenceKey(e, term, true));
        var own = preferences?.GetValueOrDefault(PreferenceKey(e, term));
        return new(own?.Avoid ?? series?.Avoid ?? (e.Task?.Done is not null ? "allow" : e.Kind is "exam" or "task" ? "must" : "prefer"), own?.Layer ?? series?.Layer ?? 0);
    }
    public static List<TeachingMeeting> CustomMeetings(CustomCourse course) => course.Days.Select(day => new TeachingMeeting(
        $"custom:{course.Id}:{day}", new(null, course.Name, null, null, null, null, null, null, null),
        course.Teacher is { } teacher ? [new(teacher, teacher, null, null, course.Weeks)] : [], new($"custom:{course.Id}", null, null, null, null),
        null, course.Room, course.Room, day, course.Periods, course.Weeks, null, [], "event", "meeting")).ToList();
}
