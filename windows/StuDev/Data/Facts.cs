// The campus facts as the data release writes them, read the same way the web (src/campus/world/facts.ts) and Android
// (data/AcademicFacts.kt) read them. Names follow the files: snake_case on disk, PascalCase here.
using System.Text.Json;
using System.Text.Json.Serialization;

namespace StuDev.Data;

public sealed record DataRelease(string Version, string Base, string BuiltAt, string Teaching, string? Exams, string? Labs, string Rooms, string? MapVersion, string? DataVersion,
    string? KnowledgeVersion, string MapBase, string KnowledgeBase, string SearchBase, string TextsBase, ReleaseFormats? Formats, string? SearchStableBase = null);
/** The encodings of the release's binary resources; a release in others is one only a newer app can use. */
public sealed record ReleaseFormats(string Search, string Models);
public sealed record AppRelease(string VersionName, int VersionCode);
public sealed record TeachingWeek(int Week, string Start, string End);
public sealed record TeachingTerm(string Term, int Year, int Number, List<TeachingWeek> Weeks, string ObservedAt);
public sealed record TeachingPeriod(int Period, string Start, string End, string? Part);
public sealed record Practice(string Name, List<int> Weeks, string Text);
public sealed record TeachingClass(string Id, string Name, string? Grade, string? College, string? Major, string? Campus, int? Students, List<Practice> Practice);
public sealed record Course(string? Code, string Name, string? Category, string? Nature, double? Credits, double? Hours, string? HoursComposition, string? Assessment, string? Exam);
public sealed record Teacher(string Id, string Name, string? Title, string? Role, List<int> Weeks);
public sealed record TeachingGroup(string Id, string? Name, int? Size, int? Enrolled, int? Capacity);
public sealed record TeachingMeeting(string Id, Course Course, List<Teacher> Teachers, TeachingGroup TeachingClass, string? Campus, string? Room, string? Location,
    int Weekday, List<int> Periods, List<int> Weeks, string? Method, List<string> Classes, string Kind, string Subtype);
public sealed record ClassSchedule([property: JsonPropertyName("class")] TeachingClass Klass, List<TeachingMeeting> Meetings);
public sealed record ExamCourse(string? Code, string Name);
public sealed record Exam(string Id, List<string> Classes, ExamCourse Course, string? Teacher, string? Campus, string Location, string? Room, string Date, string Start, string End,
    int? Students, string? Note, string Source, string Kind, string Subtype);
public sealed record ExamSource(string File, string Url, string Notice, string Title, string? Published = null);
public sealed record ExamVersion(string Id, string? Observed, string Published, bool Baseline, List<ExamSource> Files);
public sealed record ExamSlot(string Date, string Start, string End, string? Campus, string? Location, string? Teacher, int? Students, string? Note = null);
public sealed record ExamChange(string Version, string? Observed, ExamCourse Course, string Change, List<ExamSlot>? Before, List<ExamSlot>? After);
public sealed record ClassExams(List<Exam> Exams, List<ExamChange> Changes);
public sealed record ExamIndex(List<string> Classes, List<ExamSource> Sources, string? Checked, List<ExamVersion> History);
public sealed record ExamRecord(List<ExamChange> Changes, List<ExamSource> Sources, string? Checked, List<ExamVersion> History);
public sealed record Lab(string Id, List<string> Classes, int? Group, ExamCourse Course, string Project, List<string> Teachers, string Location, string Place, string Short,
    string? Room, int Week, int Weekday, List<int> Periods, string Date, string Start, string End, int? Students, string Source, string Kind, string Subtype);
public sealed record ClassLabs(List<Lab> Labs);
public sealed record LabIndex(List<string> Classes);
public sealed record DaySpan(string Name, string Start, string End);
public sealed record CalendarTerm(int Number, string Start, string End, int Weeks, [property: JsonPropertyName("break")] DaySpan? Pause, List<DaySpan>? Holidays, List<DaySpan>? Events);
public sealed record CalendarFile(List<CalendarTerm> Terms);
public sealed record MorningRun(int Required, string Start, string End, List<string> Time, List<List<int>> Bonus, int? FailScore, string Source);
public sealed record Room(string Id, string Building, string Floor, string Number, string Campus, List<string> Kinds, List<string> Names, bool? Listed, int? Seats);
public sealed record RoomIndex(string Term, List<TeachingWeek> Weeks, List<TeachingPeriod> Periods, List<Room> Rooms);
public sealed record RoomOccupant(string Kind, string Id, string Course, List<string> Teachers, List<string> Classes, List<int> Periods);
public sealed record RoomDay(string Date, int Week, int Weekday, Dictionary<string, List<string>>? Free, Dictionary<string, List<RoomOccupant>> Occupied, string? ObservedAt);

public sealed record KnowledgeChapter(string Title, List<string> Topics);
public sealed record KnowledgeCourse(string Id, string Name, List<string> Codes, List<string> Former, List<KnowledgeChapter> Chapters, string Path);
public sealed record MaterialRef(string Material, string Heading, string Anchor);
public sealed record KnowledgeTopic(string Id, string Title, List<string> Requires, string Path, List<string> TaughtBy, List<MaterialRef> References, List<string> LeadsTo);
public sealed record KnowledgeMaterial(string Path, string Title, string Kind, string Course, string? Term, string Source, int Sections);
public sealed record KnowledgeIndex(List<KnowledgeCourse> Courses, List<KnowledgeTopic> Topics, List<KnowledgeMaterial> Materials, List<string>? Media = null);

public sealed record CurriculumCourse(
    string Code, string Name, List<CurriculumEntry> Plans, List<string> Requires, List<string> Former);
public sealed record CurriculumEntry(string College, string Major, string Grade, int? Term, double? Credits,
    string Hours, string ExamMode, string Category, string Nature, string Weeks);

public static class Facts
{
    /** How every file of the release is read: snake_case names, numbers as numbers, unknown fields ignored. */
    public static JsonSerializerOptions Json => FactsJson.Default.Options;
}
