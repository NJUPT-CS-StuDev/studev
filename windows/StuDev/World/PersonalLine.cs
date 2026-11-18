using StuDev.Data;
using StuDev.Me;

namespace StuDev.World;

/** The selected class and personal course changes form the same line in the app and for local queries. */
public sealed record PersonalLine(CampusLine Line, List<TeachingMeeting> ClassMeetings, List<Lab> ClassLabs, List<Lab> PersonalLabs, MorningRun? Run)
{
    public static async Task<PersonalLine> Read(Repository repo, Preferences preferences, string klass, TeachingTerm term, List<TeachingPeriod> periods, List<CalendarTerm> calendar)
    {
        var schedule = repo.Schedule(klass);
        var exams = repo.Exams(klass);
        var labs = repo.Labs(klass);
        var runs = repo.Runs();
        await Task.WhenAll(schedule, exams, labs, runs);
        var classMeetings = schedule.Result.Meetings;
        var classLabs = labs.Result;
        var edits = Choices.Edits(preferences, term.Term);
        var facts = edits.Added.Count > 0 ? await repo.Meetings() : classMeetings;
        var chosen = classMeetings.Concat(facts.Where(m => edits.Added.Contains(m.TeachingClass.Id))).DistinctBy(m => m.Id).ToList();
        var meetings = chosen.Where(m => !edits.Hidden.Contains(m.TeachingClass.Id)).Concat((edits.Custom ?? []).SelectMany(Choices.CustomMeetings)).ToList();
        var labChoices = preferences.Get("labs", StorageJson.Default.LabChoices);
        var personalLabs = classLabs.Concat(labChoices?.Classes is { Count: > 0 } extra
            ? (await repo.AllLabs()).Where(l => l.Classes.Any(extra.Contains)) : []).DistinctBy(l => l.Id).OrderBy(l => l.Date).ThenBy(l => l.Start).ToList();
        var examChoices = preferences.Get("examAttendance", StorageJson.Default.DictionaryStringDictionaryStringBoolean)?.GetValueOrDefault($"{term.Term}:{klass}");
        var codes = meetings.Select(m => m.Course.Code).Where(code => !string.IsNullOrEmpty(code)).ToHashSet();
        var attendingExams = exams.Result.Where(e => examChoices?.GetValueOrDefault(e.Id, e.Course.Code is null || codes.Contains(e.Course.Code))
            ?? (e.Course.Code is null || codes.Contains(e.Course.Code))).ToList();
        var run = preferences.Get("run", StorageJson.Default.RunSettings);
        var runRule = runs.Result.GetValueOrDefault(term.Term);
        var grade = int.TryParse(schedule.Result.Klass.Grade, out var year) ? term.Year - year + 1 : 0;
        var line = new CampusLine(term, periods, meetings, Choices.Labs(personalLabs, labChoices), attendingExams, CampusLine.HolidaysOf(calendar))
        {
            CourseMeetings = chosen,
            CourseNames = edits.Names,
            Preferences = preferences.Get("events", StorageJson.Default.DictionaryStringEventChoice),
            Order = preferences.Get("layers", StorageJson.Default.ListString) is { } order && order.Count == CampusLine.LayerOrder.Length && CampusLine.LayerOrder.All(order.Contains) ? order : CampusLine.LayerOrder,
            Run = (run?.On ?? (grade is 1 or 2)) ? runRule : null,
            RunDays = run?.Days ?? [],
            RunAdjust = run?.Adjust ?? 0,
        };
        return new(line, classMeetings, classLabs, personalLabs, runRule);
    }
}
