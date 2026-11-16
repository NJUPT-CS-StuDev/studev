// What every page reads: the data release, one's settings, and one's line through the term, loaded once and kept
// fresh when the class changes. Android's CampusModel, for Windows.
using StuDev.Data;
using StuDev.Me;

namespace StuDev.World;

/** Whose timetable is shown when it is not one's own: a class, a teacher, a room or a course, by its name. */
public sealed record Who(string Type, string Id)
{
    public string Title => Type switch { "teacher" => $"{Id} 老师", "room" => Names.Room(Id), _ => Id };
}

public sealed class Campus
{
    public static Campus Shared { get; } = new();
    public Preferences Preferences { get; } = Preferences.Load();
    public Tasks Tasks { get; } = new();
    public Repository? Repository { get; private set; }
    public CampusLine? Line { get; private set; }
    public List<TeachingClass> Classes { get; private set; } = [];
    public TeachingTerm? Term { get; private set; }
    public List<TeachingPeriod> Periods { get; private set; } = [];
    public List<CalendarTerm> Calendar { get; private set; } = [];
    public List<Lab> ClassLabs { get; private set; } = [];
    public List<Lab> PersonalLabs { get; private set; } = [];
    public List<TeachingMeeting> ClassMeetings { get; private set; } = [];
    public MorningRun? Run { get; private set; }
    public string? Error { get; private set; }
    public string? UpdateError { get; private set; }
    public event Action? Changed;
    private Task? loading;
    private Task? updating;
    private bool checkedRelease;
    private bool rediscovered;
    private int generation;

    private Campus()
    {
        Preferences.Changed += changed => { if (changed.Overlaps(SettingsSync.Line)) { loading = null; _ = Load(); } };
        Tasks.Changed += () => { if (Line is { } line) line.Tasks = Tasks.Live.ToList(); Changed?.Invoke(); };
    }

    public Task Load() => loading ??= Fetch();

    /** Someone else's line through the term, as Android's TimetableScreen gathers it: their lessons, labs and exams. */
    public async Task<CampusLine?> LineOf(Who who)
    {
        if (Repository is not { } repo || Term is not { } term) return null;
        var meetings = who.Type switch
        {
            "class" => (await repo.Schedule(who.Id)).Meetings,
            "teacher" => (await repo.Meetings()).Where(m => m.Teachers.Any(t => t.Name == who.Id)).ToList(),
            "course" => (await repo.Meetings()).Where(m => Names.Course(m.Course.Name) == who.Id).ToList(),
            "room" => (await repo.Meetings()).Where(m => m.Room == who.Id).ToList(),
            _ => throw new ArgumentException($"no timetable of a {who.Type}"),
        };
        var labs = who.Type switch
        {
            "class" => await repo.Labs(who.Id),
            "teacher" => (await repo.AllLabs()).Where(l => l.Teachers.Contains(who.Id)).ToList(),
            "course" => (await repo.AllLabs()).Where(l => Names.Course(l.Course.Name) == who.Id).ToList(),
            _ => (await repo.AllLabs()).Where(l => l.Room == who.Id).ToList(),
        };
        var exams = who.Type switch
        {
            "class" => await repo.Exams(who.Id),
            "course" => (await repo.AllExams()).Where(x => Names.Course(x.Course.Name) == who.Id).ToList(),
            _ => [],
        };
        return new CampusLine(term, Periods, meetings, labs, exams, CampusLine.HolidaysOf(Calendar)) { Order = Line?.Order ?? CampusLine.LayerOrder };
    }
    /** After a failure: start again from the release kept on disk, or the site's latest. */
    /** Asks every page to draw again, as after a change only the page itself knows of. */
    public void Touch() => Changed?.Invoke();
    public void Retry() { Error = null; loading = null; _ = Load(); }
    public Task Refresh() => updating ??= Update();
    private async Task Update()
    {
        try
        {
            var latest = await Data.Repository.Discover();
            UpdateError = null;
            if (Repository?.Release.Version != latest.Release.Version) { loading = Fetch(latest); await loading; }
        }
        catch (Exception error) when (error is HttpRequestException or IOException or TaskCanceledException or System.Text.Json.JsonException)
        { UpdateError = "暂时无法检查更新，继续使用已保存的校园数据。"; }
        catch (NotSupportedException error) { UpdateError = error.Message; _ = Updates.Check(); }
        finally { updating = null; Changed?.Invoke(); }
    }

    private async Task Fetch(Repository? source = null)
    {
        var version = ++generation;
        try
        {
            var repo = source ?? Repository ?? await Data.Repository.Open();
            var termTask = repo.Term(); var periodsTask = repo.Periods(); var classesTask = repo.Classes(); var calendarTask = repo.Calendar();
            await Task.WhenAll(termTask, periodsTask, classesTask, calendarTask);
            if (version != generation) return;
            var classes = classesTask.Result;
            var term = termTask.Result; var periods = periodsTask.Result; var calendar = calendarTask.Result;
            CampusLine? nextLine = null; List<TeachingMeeting> classMeetings = []; List<Lab> classLabs = []; List<Lab> personalLabs = []; MorningRun? runRule = null;
            if (Preferences.Class is { } klass && classes.Any(c => c.Id == klass))
            {
                var schedule = repo.Schedule(klass); var exams = repo.Exams(klass); var labs = repo.Labs(klass);
                await Task.WhenAll(schedule, exams, labs);
                if (version != generation) return;
                classMeetings = schedule.Result.Meetings; classLabs = labs.Result;
                var edits = Choices.Edits(Preferences, term.Term);
                var facts = edits.Added.Count > 0 ? await repo.Meetings() : classMeetings;
                var chosen = classMeetings.Concat(facts.Where(m => edits.Added.Contains(m.TeachingClass.Id))).DistinctBy(m => m.Id).ToList();
                var meetings = chosen.Where(m => !edits.Hidden.Contains(m.TeachingClass.Id)).Concat((edits.Custom ?? []).SelectMany(Choices.CustomMeetings)).ToList();
                var labChoices = Preferences.Get("labs", Data.StorageJson.Default.LabChoices);
                personalLabs = classLabs.Concat(labChoices?.Classes is { Count: > 0 } extra
                    ? (await repo.AllLabs()).Where(l => l.Classes.Any(extra.Contains)) : []).DistinctBy(l => l.Id).OrderBy(l => l.Date).ThenBy(l => l.Start).ToList();
                var examChoices = Preferences.Get("examAttendance", Data.StorageJson.Default.DictionaryStringDictionaryStringBoolean)?.GetValueOrDefault($"{term.Term}:{klass}");
                var codes = meetings.Select(m => m.Course.Code).Where(code => !string.IsNullOrEmpty(code)).ToHashSet();
                var attendingExams = exams.Result.Where(e => examChoices?.GetValueOrDefault(e.Id, e.Course.Code is null || codes.Contains(e.Course.Code))
                    ?? (e.Course.Code is null || codes.Contains(e.Course.Code))).ToList();
                var run = Preferences.Get("run", Data.StorageJson.Default.RunSettings);
                var runs = await repo.Runs();
                runRule = runs.GetValueOrDefault(term.Term);
                var grade = int.TryParse(schedule.Result.Klass.Grade, out var year) ? term.Year - year + 1 : 0;
                if (version != generation) return;
                nextLine = new CampusLine(term, periods, meetings, Choices.Labs(personalLabs, labChoices), attendingExams, CampusLine.HolidaysOf(calendar))
                {
                    Tasks = Tasks.Live.ToList(), CourseMeetings = chosen, CourseNames = edits.Names,
                    Preferences = Preferences.Get("events", Data.StorageJson.Default.DictionaryStringEventChoice),
                    Order = Preferences.Get("layers", Data.StorageJson.Default.ListString) is { } order && order.Count == CampusLine.LayerOrder.Length && CampusLine.LayerOrder.All(order.Contains) ? order : CampusLine.LayerOrder,
                    Run = (run?.On ?? (grade is 1 or 2)) ? runRule : null,
                    RunDays = run?.Days ?? [], RunAdjust = run?.Adjust ?? 0,
                };
            }
            if (version != generation) return;
            repo.Activate();
            Repository = repo; Classes = classes; Term = term; Periods = periods; Calendar = calendar;
            ClassMeetings = classMeetings; ClassLabs = classLabs; PersonalLabs = personalLabs; Line = nextLine; Run = runRule;
            Error = null;
        }
        catch (NotSupportedException error) { Error = error.Message; loading = null; _ = Updates.Check(); }
        catch (HttpRequestException e) when (e.StatusCode == System.Net.HttpStatusCode.NotFound && source is null && Repository is null && !rediscovered)
        {
            // The release kept on disk was retired from the site before its files were all fetched: start from the latest.
            rediscovered = true;
            try { loading = Fetch(await Data.Repository.Discover()); await loading; return; }
            catch (Exception again) when (again is HttpRequestException or IOException or TaskCanceledException) { Error = "连不上 StuDev，检查一下网络。"; loading = null; }
        }
        catch (Exception e) when (e is HttpRequestException or IOException or TaskCanceledException)
        {
            if (source is not null && Repository is not null) UpdateError = "更新未完成，继续使用已保存的校园数据。";
            else Error = "连不上 StuDev，检查一下网络。";
            loading = null;
        }
        catch (System.Text.Json.JsonException)
        {
            if (source is not null && Repository is not null) UpdateError = "新版校园数据无法读取，已保留当前版本。";
            else Error = "这份校园数据无法读取，请检查应用更新。";
            loading = null;
        }
        Changed?.Invoke();
        if (!checkedRelease && Repository is not null) { checkedRelease = true; _ = Refresh(); }
    }
}
