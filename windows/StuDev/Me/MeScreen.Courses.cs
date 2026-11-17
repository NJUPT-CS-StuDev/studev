using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using StuDev.Data;
using StuDev.Ui;
using StuDev.World;

namespace StuDev.Me;

public sealed partial class MeScreen
{
    private bool showHidden;
    private string courseQuery = "";

    private void CoursesPage(StackPanel page)
    {
        if (campus.Term is not { } term) { page.Children.Add(Pages.Empty("选择班级后即可管理课程。")); return; }
        var edits = Choices.Edits(campus.Preferences, term.Term);
        page.Children.Add(Kit.Line(8, Kit.Button("从全校添加", () => App.Open("search", "course")), Kit.Button("自定义课程", () => CustomEditor())));
        var query = Kit.Field(courseQuery, "搜索课程、代码或教师", "搜索我的课程");
        var search = Kit.SearchField(query); search.Margin = new Thickness(0, 14, 0, 8); page.Children.Add(search);
        page.Children.Add(Kit.Row("", Switched("显示已隐藏的课程", null, showHidden, on => { showHidden = on; Draw(); })));
        var list = new StackPanel(); page.Children.Add(list);
        void Results()
        {
            list.Children.Clear();
            var groups = Choices.ManagedCourses(campus.ClassMeetings, campus.Line?.CourseMeetings ?? [], edits).Where(c => showHidden || !c.Hidden).Where(c => c.Meetings.Any(m =>
                $"{m.Course.Name} {m.Course.Code} {edits.Names?.GetValueOrDefault(CourseTones.Identity(m.Course.Code, m.Course.Name))} {string.Join(' ', m.Teachers.Select(t => t.Name))}".Contains(courseQuery, StringComparison.OrdinalIgnoreCase))).ToList();
            foreach (var course in groups)
            {
                var first = course.Meetings[0];
                var name = course.Source == "custom" ? first.Course.Name : edits.Names?.GetValueOrDefault(CourseTones.Identity(first.Course.Code, first.Course.Name)) ?? Names.Course(first.Course.Name);
                var source = course.Source switch { "class" => "班级课程", "custom" => "自定义课程", _ => "全校选课" };
                var said = $"{(course.Hidden ? "已隐藏 · " : "")}{source} · {string.Join('、', course.Meetings.Select(m => Clock.Weekdays[m.Weekday]).Distinct())}";
                list.Children.Add(Kit.Row("", Value(name, said), () => CourseDetails(course)));
            }
            if (groups.Count == 0) list.Children.Add(Pages.Empty(courseQuery.Length == 0 ? "暂无课程，可从全校添加或自定义课程。" : "没有找到这门课程。"));
        }
        query.TextChanged += (_, _) => { courseQuery = query.Text.Trim(); Results(); };
        Results();
    }
    private void CourseDetails(ManagedCourse course)
    {
        if (campus.Term is not { } term) return;
        var edits = Choices.Edits(campus.Preferences, term.Term);
        var first = course.Meetings[0];
        var identity = CourseTones.Identity(first.Course.Code, first.Course.Name);
        var name = course.Source == "custom" ? first.Course.Name : edits.Names?.GetValueOrDefault(identity) ?? Names.Course(first.Course.Name);
        var custom = edits.Custom?.FirstOrDefault(c => $"custom:{c.Id}" == course.Id);
        var body = new StackPanel { Padding = new Thickness(20, 18, 20, 22), Spacing = 6 };
        body.Children.Add(Pages.SheetHead(Pages.SheetTitle(name), () => App.Window?.Close()));
        void Row(string key, string value, string? note = null, Action? open = null) => body.Children.Add(Kit.Row(key, Value(value, note), open));
        Row("来源", course.Source switch { "class" => $"班级课表 · {campus.Preferences.Class}", "custom" => "自定义课程", _ => "从全校课程添加" }, course.Hidden ? "已从个人课表隐藏" : null);
        if (custom is null && first.Course.Name != name) Row("原名", first.Course.Name);
        CourseInfo.Arrangements(body, campus, course.Meetings);
        if (custom is not null)
        {
            Row("", "编辑课程", "修改名称、时间、地点或教师", () => CustomEditor(custom));
        }
        else
        {
            var nameArea = new StackPanel { Spacing = 4, Margin = new Thickness(0, 12, 0, 0) };
            body.Children.Add(nameArea);
            void NameEditor(bool editing)
            {
                nameArea.Children.Clear();
                var row = new Grid { ColumnSpacing = 12 };
                row.ColumnDefinitions.Add(new ColumnDefinition()); row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                if (!editing)
                {
                    row.Children.Add(Value(name));
                    var edit = Kit.TextAction("编辑名称", () => NameEditor(true)); Grid.SetColumn(edit, 1); row.Children.Add(edit);
                }
                else
                {
                    var naming = Kit.Field(name, "课程名称", "课程名称"); naming.MaxLength = 60; row.Children.Add(naming);
                    var save = Kit.TextAction("保存名称", () => { Choices.Rename(campus.Preferences, term.Term, identity, naming.Text.Trim()); CourseDetails(course); Draw(); });
                    void Ready() { save.IsEnabled = naming.Text.Trim().Length > 0 && naming.Text.Trim() != name; save.Opacity = save.IsEnabled ? 1 : .45; }
                    naming.TextChanged += (_, _) => Ready(); Ready(); Grid.SetColumn(save, 1); row.Children.Add(save);
                    var secondary = Kit.Line(14, Kit.TextAction("取消", () => NameEditor(false), colour: "muted"));
                    if (edits.Names?.ContainsKey(identity) == true) secondary.Children.Add(Kit.TextAction("恢复原名", () => { Choices.Rename(campus.Preferences, term.Term, identity, null); CourseDetails(course); Draw(); }, colour: "muted"));
                    nameArea.Children.Add(row); nameArea.Children.Add(secondary); return;
                }
                nameArea.Children.Add(row);
            }
            NameEditor(false);
        }
        var related = LabFacts().Where(l => CourseTones.Same(l.Course.Code, l.Course.Name, first.Course.Code, first.Course.Name)).ToList();
        if (related.Count > 0)
        {
            body.Children.Add(Pages.Section("相关实验"));
            var choices = campus.Preferences.Get("labs", StorageJson.Default.LabChoices) ?? new();
            foreach (var lab in related)
            {
                var on = Choices.Labs([lab], choices).Count > 0;
                Row("", $"{Clock.DateLabel(Clock.Parse(lab.Date))} {lab.Start}–{lab.End}", $"{lab.Project} · {(lab.Room is { } room ? Names.Room(room) : lab.Location)}{(!on ? " · 已隐藏" : "")}");
            }
            Row("", "管理相关实验", "理论课的选择不影响实验", () => { App.Window?.Close(); Go("labs"); });
        }
        body.Children.Add(new Border { Height = 16 });
        if (custom is not null) Row("", "删除自定义课程", null, () => { Choices.Hide(campus.Preferences, term.Term, course.Id); App.Window?.Close(); Draw(); });
        else Row("", course.Hidden ? "恢复到课表" : course.Source == "added" ? "移除添加的课程" : "隐藏这门课", "只调整个人课表，实验另行选择", () => { if (course.Hidden) Choices.Restore(campus.Preferences, term.Term, course.Id); else Choices.Hide(campus.Preferences, term.Term, course.Id); App.Window?.Close(); Draw(); });
        App.Window?.Sheet(body, 560);
    }
    private void CustomEditor(CustomCourse? course = null)
    {
        if (campus.Term is not { } term) return;
        var body = new StackPanel { Padding = new Thickness(20, 18, 20, 22), Spacing = 8 };
        body.Children.Add(Pages.SheetHead(Pages.SheetTitle(course is null ? "添加自定义课程" : "编辑课程"), () => App.Window?.Close()));
        var name = Kit.Field(course?.Name ?? "", "课程名称", "课程名称"); body.Children.Add(name);
        body.Children.Add(Pages.Section("上课日"));
        var days = new WrapRow(); var checks = new Dictionary<int, CheckBox>();
        for (var day = 1; day <= 7; day++) { var check = new CheckBox { Content = Clock.Weekdays[day], IsChecked = course?.Days.Contains(day) ?? day == 1 }; checks[day] = check; days.Children.Add(check); }
        body.Children.Add(days);
        var from = course?.Periods[0] ?? 1; var to = course?.Periods[^1] ?? Math.Min(2, campus.Periods.Count);
        var options = campus.Periods.Select(p => (p.Period.ToString(), $"第 {p.Period} 节 · {p.Start}–{p.End}")).ToList();
        body.Children.Add(Kit.Row("开始节次", ChoiceField("开始节次", options, from.ToString(), value => from = int.Parse(value))));
        body.Children.Add(Kit.Row("结束节次", ChoiceField("结束节次", options, to.ToString(), value => to = int.Parse(value))));
        var weeks = Kit.Field(course is null ? $"1-{term.Weeks.Count}" : string.Join(',', course.Weeks), "如 1-16、单1-15 或 3,5,7", "教学周");
        body.Children.Add(Pages.Section("教学周")); body.Children.Add(weeks);
        var room = Kit.Field(course?.Room ?? "", "地点（可不填）", "地点"); body.Children.Add(room);
        var teacher = Kit.Field(course?.Teacher ?? "", "教师（可不填）", "教师"); body.Children.Add(teacher);
        var error = Kit.Text("", Role.Caption, "danger", wrap: true); body.Children.Add(error);
        var saveCourse = Kit.Action(course is null ? "添加课程" : "保存修改", () =>
        {
            var picked = checks.Where(c => c.Value.IsChecked == true).Select(c => c.Key).ToList();
            var parsed = Courses.Weeks(weeks.Text, term.Weeks.Count);
            if (name.Text.Trim().Length == 0 || picked.Count == 0 || parsed is null || from > to) { error.Text = "请填写课程名称，选择上课日，并检查教学周与节次。"; return; }
            string? Optional(string text, int limit = 60) => text.Trim().Length == 0 ? null : text.Trim()[..Math.Min(limit, text.Trim().Length)];
            Choices.SaveCustom(campus.Preferences, term.Term, new(course?.Id ?? Guid.NewGuid().ToString(), name.Text.Trim()[..Math.Min(60, name.Text.Trim().Length)], picked, [from, to], parsed, Optional(room.Text), Optional(teacher.Text, 40)));
            App.Window?.Close(); Draw();
        }, go: true);
        var footer = Kit.Line(16, Kit.TextAction("取消", () => App.Window?.Close(), colour: "muted"), saveCourse); footer.HorizontalAlignment = HorizontalAlignment.Right; footer.Margin = new Thickness(0, 12, 0, 0); body.Children.Add(footer);
        App.Window?.Sheet(body, 560);
    }
    private List<Lab> LabFacts() => campus.PersonalLabs;
    private void SetLabs(Func<LabChoices, LabChoices> change)
    {
        campus.Preferences.Set("labs", change(campus.Preferences.Get("labs", StorageJson.Default.LabChoices) ?? new()), StorageJson.Default.LabChoices);
        Draw();
    }
    private void LabsPage(StackPanel page)
    {
        page.Children.Add(Kit.Text("实验与理论课分别选择；隐藏理论课不会取消实验安排。", Role.Label, "muted", wrap: true));
        var choices = campus.Preferences.Get("labs", StorageJson.Default.LabChoices) ?? new();
        foreach (var name in choices.Classes ?? []) page.Children.Add(Kit.Row("", Value($"其他班级 · {name}"), () => SetLabs(c => c with { Classes = (c.Classes ?? []).Where(k => k != name).ToList() })));
        var extra = Kit.Field("", "添加其他班实验，如 B240402", "实验班级");
        var addError = Kit.Text("", Role.Caption, "danger", wrap: true);
        page.Children.Add(Kit.Line(8, extra, Kit.Button("添加", () => { var name = extra.Text.Trim().ToUpperInvariant(); if (!System.Text.RegularExpressions.Regex.IsMatch(name, @"^[A-Z]\d{6}(\([A-Z]{2}\))?$")) { addError.Text = "请填写完整班级号。"; return; } SetLabs(c => c with { Classes = [.. (c.Classes ?? []).Append(name).Distinct()] }); })));
        page.Children.Add(addError);
        if (campus.Error is not null) page.Children.Add(Kit.Row("", Value("实验安排暂时无法加载"), campus.Retry));
        var facts = LabFacts();
        foreach (var group in facts.GroupBy(Choices.LabSheet))
        {
            var sheet = group.Key;
            page.Children.Add(Kit.Row("", Switched(sheet, $"{group.Count()} 次实验", choices.Off?.Contains(sheet) != true, on => SetLabs(c => c with { Off = on ? (c.Off ?? []).Where(s => s != sheet).ToList() : [.. (c.Off ?? []).Append(sheet).Distinct()] }))));
            foreach (var course in group.GroupBy(Choices.LabCourse))
            {
                var key = course.Key;
                page.Children.Add(Kit.Row("", Switched(Names.Course(course.First().Course.Name), null, choices.Drop?.Contains(key) != true, on => SetLabs(c => c with { Drop = on ? (c.Drop ?? []).Where(k => k != key).ToList() : [.. (c.Drop ?? []).Append(key).Distinct()] }))));
                if (choices.Off?.Contains(sheet) == true || choices.Drop?.Contains(key) == true) continue;
                foreach (var lab in course) page.Children.Add(Kit.Row("", Switched($"{Clock.DateLabel(Clock.Parse(lab.Date))} {lab.Start}–{lab.End}", $"{lab.Project} · {(lab.Room is { } room ? Names.Room(room) : lab.Location)}", choices.Skip?.Contains(lab.Id) != true, on => SetLabs(c => c with { Skip = on ? (c.Skip ?? []).Where(id => id != lab.Id).ToList() : [.. (c.Skip ?? []).Append(lab.Id).Distinct()] }))));
            }
        }
        if (facts.Count == 0) page.Children.Add(Pages.Empty("暂无这个班级的实验安排。"));
        page.Children.Add(Kit.Row("", Value("提供实验课表", "上传新实验表，审核后更新"), () => Browse(Form("data"))));
    }
}
