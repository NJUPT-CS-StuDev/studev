using Microsoft.UI.Xaml.Controls;
using StuDev.Data;
using StuDev.Ui;
using StuDev.World;

namespace StuDev.Me;

/** Published course details, shared by one's course manager and the campus course catalogue. */
public static class CourseInfo
{
    public static void Arrangements(StackPanel body, Campus campus, List<TeachingMeeting> meetings)
    {
        var first = meetings[0];
        void Row(string key, string value, string? note = null) {
            var words = Kit.Column(2, Kit.Text(value, Role.Label, wrap: true));
            if (note is not null) words.Children.Add(Kit.Text(note, Role.Caption, "muted", wrap: true));
            body.Children.Add(Kit.Row(key, words));
        }
        if (first.Course.Code is { } code) Row("课程代码", code);
        var teachers = meetings.SelectMany(meeting => meeting.Teachers).Select(teacher => teacher.Name).Distinct().ToList();
        if (teachers.Count > 0) Row("教师", string.Join('、', teachers));
        body.Children.Add(Pages.Section("上课安排"));
        foreach (var meeting in meetings)
        {
            var start = campus.Periods.FirstOrDefault(period => period.Period == meeting.Periods[0])?.Start;
            var end = campus.Periods.FirstOrDefault(period => period.Period == meeting.Periods[^1])?.End;
            Row("", $"{Clock.Weekdays[meeting.Weekday]} · 第 {meeting.Periods[0]}–{meeting.Periods[^1]} 节{(start is not null && end is not null ? $" · {start}–{end}" : "")}", $"{Lessons.WeeksText(meeting.Weeks)} · {(meeting.Room is { } room ? Names.Room(room) : meeting.Location ?? "地点未定")}");
        }
    }
}
