// src/campus/timetable/model/examAttendance.ts, natively.
using StuDev.Data;

namespace StuDev.World;

/// Every exam the class's rows name is one's own until one says otherwise: missing an exam is the failure that matters,
/// so nothing is taken away by inference. What one takes away stays in sight, greyed, and comes back in a tap.
public static class ExamAttendance
{
    /// The exams one sits: all of them, but those one has explicitly said one does not take.
    public static List<Exam> Select(IEnumerable<Exam> exams, IReadOnlyDictionary<string, bool>? choices) =>
        exams.Where(e => choices?.GetValueOrDefault(e.Id, true) != false).ToList();
    /// The exams one has taken away, kept to show greyed and to restore.
    public static List<Exam> Skipped(IEnumerable<Exam> exams, IReadOnlyDictionary<string, bool>? choices) =>
        exams.Where(e => choices is not null && choices.TryGetValue(e.Id, out var attending) && !attending).ToList();
    /// Exams of courses one's timetable does not have, for the one-tap clean-up; one without a course code stays.
    public static List<Exam> Outside(IEnumerable<Exam> exams, IReadOnlySet<string> ownCodes) =>
        exams.Where(e => !string.IsNullOrEmpty(e.Course.Code) && !ownCodes.Contains(e.Course.Code)).ToList();
}
