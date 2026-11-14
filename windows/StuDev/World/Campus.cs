// What every page reads: the data release, one's settings, and one's line through the term, loaded once and kept
// fresh when the class changes. Android's CampusModel, for Windows.
using StuDev.Data;
using StuDev.Me;

namespace StuDev.World;

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
    public List<TeachingMeeting> ClassMeetings { get; private set; } = [];
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
        Preferences.Changed += () => { loading = null; _ = Load(); };
        Tasks.Changed += () => { if (Line is { } line) line.Tasks = Tasks.Live.ToList(); Changed?.Invoke(); };
    }

    public Task Load() => loading ??= Fetch();
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
            CampusLine? nextLine = null; List<TeachingMeeting> classMeetings = []; List<Lab> classLabs = [];
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
                var labFacts = classLabs.Concat(labChoices?.Classes is { Count: > 0 } extra
                    ? (await repo.AllLabs()).Where(l => l.Classes.Any(extra.Contains)) : []).DistinctBy(l => l.Id);
                var examChoices = Preferences.Get("examAttendance", Data.StorageJson.Default.DictionaryStringDictionaryStringBoolean)?.GetValueOrDefault($"{term.Term}:{klass}");
                var codes = meetings.Select(m => m.Course.Code).Where(code => !string.IsNullOrEmpty(code)).ToHashSet();
                var attendingExams = exams.Result.Where(e => examChoices?.GetValueOrDefault(e.Id, e.Course.Code is null || codes.Contains(e.Course.Code))
                    ?? (e.Course.Code is null || codes.Contains(e.Course.Code))).ToList();
                var run = Preferences.Get("run", Data.StorageJson.Default.RunSettings);
                var runs = await repo.Runs();
                var grade = int.TryParse(schedule.Result.Klass.Grade, out var year) ? term.Year - year + 1 : 0;
                if (version != generation) return;
                nextLine = new CampusLine(term, periods, meetings, Choices.Labs(labFacts, labChoices), attendingExams, CampusLine.HolidaysOf(calendar))
                {
                    Tasks = Tasks.Live.ToList(), CourseMeetings = chosen, CourseNames = edits.Names,
                    Preferences = Preferences.Get("events", Data.StorageJson.Default.DictionaryStringEventChoice),
                    Order = Preferences.Get("layers", Data.StorageJson.Default.ListString) is { } order && order.Count == CampusLine.LayerOrder.Length && CampusLine.LayerOrder.All(order.Contains) ? order : CampusLine.LayerOrder,
                    Run = (run?.On ?? (grade is 1 or 2)) ? runs.GetValueOrDefault(term.Term) : null,
                    RunDays = run?.Days ?? [], RunAdjust = run?.Adjust ?? 0,
                };
            }
            if (version != generation) return;
            repo.Activate();
            Repository = repo; Classes = classes; Term = term; Periods = periods; Calendar = calendar;
            ClassMeetings = classMeetings; ClassLabs = classLabs; Line = nextLine;
            Error = null;
        }
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
