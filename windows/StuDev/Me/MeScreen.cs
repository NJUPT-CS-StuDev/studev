using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using StuDev.Ai;
using StuDev.Data;
using StuDev.Ui;
using StuDev.World;

namespace StuDev.Me;

/** Personal settings grouped by the student's task; course management belongs to timetable settings. */
public sealed partial class MeScreen : Screen
{
    private static readonly Dictionary<string, string> KindNames = new() { ["exam"] = "考试", ["task"] = "任务", ["lab"] = "实验", ["class"] = "课程", ["run"] = "早锻炼" };
    private readonly Campus campus = Campus.Shared;
    private string section = "home";
    private AccountScreen? accountPage;

    public MeScreen()
    {
        campus.Changed += () => DispatcherQueue.TryEnqueue(Draw);
        Account.Shared.Changed += () => DispatcherQueue.TryEnqueue(Draw);
        Updates.Changed += () => DispatcherQueue.TryEnqueue(Draw);
        Paint.Turned += Draw;
        Device.Changed += () => DispatcherQueue.TryEnqueue(Draw);
        Draw();
    }
    public override void Shown(object? argument)
    {
        accountPage?.Leave(); section = "home"; App.Window?.AccountPages(false); Draw();
        if (argument is "account") Go("account");
        if (argument is "models") Go("models");
        if (argument is "tools") Go("tools");
        if (argument is Uri address) Go("account", System.Web.HttpUtility.ParseQueryString(address.Query)["tab"]);
    }
    private void Go(string next, string? accountTab = null)
    {
        if (section == "account" && next != "account") accountPage?.Leave();
        section = next; App.Window?.AccountPages(section == "account"); Draw();
        if (section == "account") accountPage!.Shown(accountTab);
    }
    private static string CollectionLink(string kind, string? where = null) =>
        $"/forms/?id={Product.Root.GetProperty("forms").GetProperty(kind).GetString()}{(where is null ? "" : $"&a.where={Uri.EscapeDataString(where)}")}";
    private static UIElement Value(string text, string? small = null, string colour = "ink")
    {
        var v = Kit.Column(2, Kit.Text(text, Role.Label, colour, wrap: true));
        if (small is not null) v.Children.Add(Kit.Text(small, Role.Caption, "muted", wrap: true));
        return v;
    }
    private static ComboBox ChoiceField(string label, IEnumerable<(string Key, string Text)> choices, string selected, Action<string> choose)
    {
        var box = new ComboBox { MinWidth = 170, HorizontalAlignment = HorizontalAlignment.Stretch };
        foreach (var (key, text) in choices) { var item = new ComboBoxItem { Content = text, Tag = key }; box.Items.Add(item); if (key == selected) box.SelectedItem = item; }
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(box, label);
        box.SelectionChanged += (_, _) => { if (box.SelectedItem is ComboBoxItem { Tag: string value }) choose(value); };
        return box;
    }
    private static UIElement Switched(string text, string? small, bool on, Action<bool> turn)
    {
        var row = new Grid { ColumnSpacing = 16 };
        row.ColumnDefinitions.Add(new ColumnDefinition()); row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.Children.Add(Value(text, small));
        var toggle = Kit.Switch(on, turn, text); toggle.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(toggle, 1); row.Children.Add(toggle);
        return row;
    }
    private void Draw()
    {
        if (section == "account")
        {
            accountPage ??= new AccountScreen(() => Go("home"));
            if (!Children.Contains(accountPage)) { Children.Clear(); Children.Add(accountPage); }
            return;
        }
        Children.Clear();
        var page = new StackPanel();
        var title = section switch { "timetable" => "课表设置", "courses" => "我的课程", "labs" => "实验安排", "appearance" => "外观", "device" => "提醒与后台", "about" => "帮助与关于", "account" => "账号", "models" => "模型", "tools" => "工具", _ => "我" };
        void Back()
        {
            if (section is "tools" or "models") App.Open("ai");
            else Go(section is "courses" or "labs" ? "timetable" : "home");
        }
        if (section == "home") page.Children.Add(Pages.Header(title, ""));
        else
        {
            var name = Kit.Text(title, Role.Title);
            name.VerticalAlignment = VerticalAlignment.Center;
            var header = Kit.Line(10, Kit.Button("返回", Back, Icons.Back, iconOnly: true), name);
            header.Margin = new Thickness(0, 0, 0, 18);
            page.Children.Add(header);
        }
        void Row(string key, UIElement value, Action? open = null) => page.Children.Add(Kit.Row(key, value, open));
        var user = Account.Shared.User;
        var info = campus.Classes.FirstOrDefault(c => c.Id == campus.Preferences.Class);
        if (section == "home")
        {
            Row("", Value(user?.Nickname ?? "未登录", user is null ? "登录后同步任务和课表设置" : "账号设置 · 任务和课表设置自动同步"), () => { if (user is null) SignIn.Show(() => Go("account")); else Go("account"); });
            Row("", Value("收集", "在浏览器打开收集页面"), () => App.OpenLink("/forms/"));
            Row("", Value("成员", "在浏览器查看成员"), () => App.OpenLink("/members/"));
            Row("", Value("课表设置", campus.Preferences.Class is { } klass ? $"{klass} · {info?.Major}" : "选择班级、调整课程与实验"), () => Go("timetable"));
            Row("", Value("外观", "跟随系统、浅色或深色"), () => Go("appearance"));
            Row("", Value("桌面小组件", "把课表和任务放到桌面"), WidgetSheet.Open);
            Row("", Value("提醒与后台", "课前提醒、托盘和开机启动"), () => Go("device"));
            if (Updates.Ready is { } ready) Row("", Value($"新版本 {ready} 已准备好", "重启后更新"), Updates.RestartNow);
            else Row("", Value("检查更新", $"StuDev {Updates.Version} · 数据 {campus.Repository?.Release.DataVersion ?? "—"}"), () => UpdateSheet.Check(campus));
            Row("", Value("帮助与关于", "意见反馈、提交资料与服务协议"), () => Go("about"));
        }
        if (section == "timetable")
        {
            Row("班级", Value(campus.Preferences.Class ?? "选择班级", info?.Major), PickClass);
            Row("", Value("我的课程", "添加、隐藏课程或调整上课安排"), () => Go("courses"));
            Row("", Value("实验安排", "单独选择要显示的实验"), () => Go("labs"));
            var order = campus.Line?.Order ?? CampusLine.LayerOrder;
            Row("", Value("时间冲突时的显示顺序", string.Join(" › ", order.Select(o => KindNames[o]))), () => Layering(order));
            if (campus.Run is { } run && campus.Term is { } term)
            {
                var settings = campus.Preferences.Get("run", StorageJson.Default.RunSettings) ?? new([]);
                var grade = int.TryParse(info?.Grade, out var year) ? term.Year - year + 1 : 0;
                Row("", Switched("显示早锻炼", $"本学期需完成 {run.Required} 次", settings.On ?? (grade is 1 or 2), on => campus.Preferences.Set("run", settings with { On = on }, StorageJson.Default.RunSettings)));
            }
            if (campus.Term is { } current)
            {
                var edits = Choices.Edits(campus.Preferences, current.Term);
                if (edits.Added.Count + edits.Hidden.Count + (edits.Names?.Count ?? 0) > 0)
                    Row("", Value("恢复班级课程", "恢复班级课表，保留自定义课程"), () => Choices.Edit(campus.Preferences, current.Term, e => new([], [], null, e.Custom)));
            }
        }
        if (section == "courses") CoursesPage(page);
        if (section == "labs") LabsPage(page);
        if (section == "models") ModelSettings.Fill(page, Draw);
        if (section == "tools") ToolSettings.Fill(page);
        if (section == "appearance") Row("主题", ChoiceField("主题", [("0", "跟随系统"), ("1", "浅色"), ("2", "深色")], Appearance.Current.ToString(), value => Appearance.Set(int.Parse(value))));
        if (section == "device")
        {
            var device = Device.Settings;
            Row("", Switched("课前提醒", "课程、实验和考试开始前提醒", device.Reminders, on => Device.Set(Device.Settings with { Reminders = on })));
            if (device.Reminders) Row("提前时间", ChoiceField("提前时间", [("5", "5 分钟"), ("10", "10 分钟"), ("15", "15 分钟"), ("30", "30 分钟")], device.Lead.ToString(), value => Device.Set(Device.Settings with { Lead = int.Parse(value) })));
            Row("", Switched("关闭窗口后留在托盘", "关窗后仍可使用桌面小组件和提醒，可在托盘菜单中退出", device.Tray, on => Device.Set(Device.Settings with { Tray = on })));
            Row("", Switched("开机启动", "登录 Windows 后在后台启动", Device.StartsAtSignIn, on => Device.StartsAtSignIn = on));
        }
        if (section == "about")
        {
            Row("", Value("意见反馈", "在浏览器报告问题或提出建议"), () => App.OpenLink(CollectionLink("feedback", "Windows · 我")));
            Row("", Value("提供校园资料", "在浏览器提交实验课表、讲座信息、校车时刻或营业时间"), () => App.OpenLink(CollectionLink("data")));
            Row("", Value("学生发展中心", "南邮计软网安"), () => App.OpenLink("/club/"));
            Row("", Value("下载 StuDev", "网页、Android 和 Windows"), () => App.OpenLink("/download/"));
            Row("", Value("用户协议"), () => App.OpenLink("/terms/"));
            Row("", Value("隐私政策"), () => App.OpenLink("/privacy/"));
            page.Children.Add(Kit.Text($"StuDev {Updates.Version} · 数据 {campus.Repository?.Release.DataVersion ?? "—"}", Role.Caption, "muted"));
        }
        Children.Add(Pages.Frame(page, 680));
    }
    private void PickClass()
    {
        var column = new StackPanel { Padding = new Thickness(20, 18, 16, 20), Spacing = 12 };
        column.Children.Add(Pages.SheetHead(Pages.SheetTitle("选择班级"), () => App.Window?.Close()));
        column.Children.Add(ClassPicker.Make(campus.Classes, c => { campus.Preferences.SetClass(c.Id); App.Window?.Close(); }, false));
        App.Window?.Sheet(column, 480);
    }
    private void Layering(IReadOnlyList<string> order)
    {
        var column = new StackPanel { Padding = new Thickness(20, 18, 20, 20), Spacing = 4 };
        column.Children.Add(Pages.SheetHead(Pages.SheetTitle("时间冲突时的显示顺序"), () => App.Window?.Close()));
        column.Children.Add(Kit.Text("同一时间有多项安排时，课表优先显示排在前面的类型。点击该安排可查看其余项目。", Role.Label, "muted", wrap: true));
        for (var at = 0; at < order.Count; at++)
        {
            var value = new Grid(); value.ColumnDefinitions.Add(new ColumnDefinition()); value.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            value.Children.Add(Value(KindNames[order[at]]));
            if (at > 0)
            {
                var index = at;
                var up = Kit.Button("上移", () => { var next = order.ToList(); (next[index - 1], next[index]) = (next[index], next[index - 1]); campus.Preferences.Set("layers", next, StorageJson.Default.ListString); Layering(next); });
                Grid.SetColumn(up, 1); value.Children.Add(up);
            }
            column.Children.Add(Kit.Row($"{at + 1}", value));
        }
        column.Children.Add(Kit.TextAction("恢复默认", () => { campus.Preferences.Change("layers", null); Layering(CampusLine.LayerOrder); }));
        App.Window?.Sheet(column, 520);
    }
}
