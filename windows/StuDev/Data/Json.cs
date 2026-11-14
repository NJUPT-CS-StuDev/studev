// Every shape StuDev reads or writes as JSON, known at build time, so serialization needs no reflection and the app
// compiles ahead of time: the data release in snake_case, and what this device keeps in camelCase.
using System.Text.Json.Serialization;
using StuDev.Map;
using StuDev.Me;
using StuDev.World;

namespace StuDev.Data;

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.SnakeCaseLower, PropertyNameCaseInsensitive = true, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(DataRelease))]
[JsonSerializable(typeof(TeachingTerm))]
[JsonSerializable(typeof(List<TeachingPeriod>))]
[JsonSerializable(typeof(List<TeachingClass>))]
[JsonSerializable(typeof(ClassSchedule))]
[JsonSerializable(typeof(List<TeachingMeeting>))]
[JsonSerializable(typeof(RoomIndex))]
[JsonSerializable(typeof(RoomDay))]
[JsonSerializable(typeof(List<CourseMaterials>))]
[JsonSerializable(typeof(Dictionary<string, MorningRun>))]
[JsonSerializable(typeof(List<Lab>))]
[JsonSerializable(typeof(CalendarFile))]
[JsonSerializable(typeof(ExamIndex))]
[JsonSerializable(typeof(ClassExams))]
[JsonSerializable(typeof(LabIndex))]
[JsonSerializable(typeof(ClassLabs))]
[JsonSerializable(typeof(List<Place>))]
[JsonSerializable(typeof(Dictionary<string, OpeningRecord>))]
[JsonSerializable(typeof(CampusModel))]
public sealed partial class FactsJson : JsonSerializerContext;

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(List<PersonalTask>))]
[JsonSerializable(typeof(PersonalTask))]
[JsonSerializable(typeof(Dictionary<string, TimetableEdits>))]
[JsonSerializable(typeof(LabChoices))]
[JsonSerializable(typeof(Dictionary<string, Dictionary<string, bool>>))]
[JsonSerializable(typeof(Dictionary<string, EventChoice>))]
[JsonSerializable(typeof(RunSettings))]
[JsonSerializable(typeof(List<string>))]
[JsonSerializable(typeof(List<Channel>))]
[JsonSerializable(typeof(List<Ai.TaskProposal>))]
[JsonSerializable(typeof(StoredAccount))]
[JsonSerializable(typeof(AccountUser))]
public sealed partial class StorageJson : JsonSerializerContext;
