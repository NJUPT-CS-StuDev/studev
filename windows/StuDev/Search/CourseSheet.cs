using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using StuDev.Data;
using StuDev.Me;
using StuDev.Ui;
using StuDev.World;

namespace StuDev.Search;

/** The campus course catalogue uses the course manager's facts and selection operations. */
public static class CourseSheet
{
    public static void Open(string name)
    {
        var body = new StackPanel { Padding = new Thickness(20, 18, 20, 22), Spacing = 8 };
        body.Children.Add(Pages.SheetHead(Pages.SheetTitle(name), () => App.Window?.Close()));
        var content = new StackPanel(); content.Children.Add(Kit.Text("正在加载上课安排…", Role.Label, "muted")); body.Children.Add(content);
        App.Window?.Sheet(body, 560);
        _ = Load(content, name);
    }
    private static async Task Load(StackPanel content, string name)
    {
        var campus = Campus.Shared;
        if (campus.Repository is not { } repository || campus.Term is null) return;
        try
        {
            var rows = (await repository.Meetings()).Where(meeting => Names.Course(meeting.Course.Name) == name).ToList();
            content.Children.Clear();
            if (rows.Count == 0) { content.Children.Add(Pages.Empty("没有找到这门课的上课安排。")); return; }
            content.Children.Add(Kit.Row("课程", Kit.Text("查看全部上课时段", Role.Label), () => { App.Window?.Close(); App.OpenLink($"/?who=course:{Uri.EscapeDataString(name)}&scale=week"); }));
            content.Children.Add(Pages.Section("选择教学班"));
            foreach (var group in rows.GroupBy(meeting => meeting.TeachingClass.Id))
            {
                var meetings = group.OrderBy(meeting => meeting.Weekday).ThenBy(meeting => meeting.Periods[0]).ToList();
                var teachers = string.Join('、', meetings.SelectMany(meeting => meeting.Teachers).Select(teacher => teacher.Name).Distinct());
                var title = teachers.Length > 0 ? teachers : "教师待定";
                var small = string.Join(" · ", new[] { meetings[0].Campus, string.Join("、", meetings.Select(meeting => Clock.Weekdays[meeting.Weekday]).Distinct()) }.Where(value => !string.IsNullOrEmpty(value)));
                var row = Kit.Row("", Kit.Column(2, Kit.Text(title, Role.Body), Kit.Text(small, Role.Caption, "muted")), () => Group(meetings));
                Microsoft.UI.Xaml.Automation.AutomationProperties.SetAutomationId(row, $"catalog-teaching-class:{group.Key}");
                content.Children.Add(row);
            }
        }
        catch (Exception error) when (error is HttpRequestException or IOException or TaskCanceledException or System.Text.Json.JsonException)
        {
            content.Children.Clear(); content.Children.Add(Pages.Empty("上课安排暂时无法加载", Kit.TextAction("重试", () => _ = Load(content, name), Icons.Again)));
        }
    }
    private static void Group(List<TeachingMeeting> meetings)
    {
        var campus = Campus.Shared;
        if (campus.Term is not { } term) return;
        var id = meetings[0].TeachingClass.Id;
        var name = Names.Course(meetings[0].Course.Name);
        var body = new StackPanel { Padding = new Thickness(20, 18, 20, 22), Spacing = 8 };
        body.Children.Add(Pages.SheetHead(Pages.SheetTitle(name), () => App.Window?.Close()));
        CourseInfo.Arrangements(body, campus, meetings);
        body.Children.Add(Kit.TextAction("预览课表", () => { App.Window?.Close(); App.OpenLink($"/?preview={Uri.EscapeDataString(id)}&scale=week"); }));
        var own = campus.ClassMeetings.Any(meeting => meeting.TeachingClass.Id == id);
        var edits = Choices.Edits(campus.Preferences, term.Term);
        if (own && !edits.Hidden.Contains(id)) body.Children.Add(Kit.Text("已在我的课表", Role.Label, "muted"));
        else if (own) body.Children.Add(Kit.Action("恢复到课表", () => { Choices.Restore(campus.Preferences, term.Term, id); App.Window?.Close(); }));
        else if (edits.Added.Contains(id)) body.Children.Add(Kit.TextAction("从我的课表移除", () => { Choices.Hide(campus.Preferences, term.Term, id); App.Window?.Close(); }));
        else body.Children.Add(Kit.Action("加入课表", () => { Choices.Add(campus.Preferences, term.Term, id); App.Window?.Close(); }, go: true));
        App.Window?.Sheet(body, 520);
    }
}
