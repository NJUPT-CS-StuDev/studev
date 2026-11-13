// 我: the class one is in, what one changed of the timetable, how it looks, how things stack, and the ways to say
// something back. MeApp.tsx, as a page of the window rather than a sheet.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using StuDev.Data;
using StuDev.Ui;
using StuDev.World;

namespace StuDev.Me;

public sealed partial class MeScreen : Screen
{
    private static readonly Dictionary<string, string> KindNames = new() { ["exam"] = "考试", ["task"] = "任务", ["lab"] = "实验", ["class"] = "课", ["run"] = "早锻炼" };
    private static readonly System.Text.Json.JsonElement Product = System.Text.Json.JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "product.json"))).RootElement;
    private readonly Campus campus = Campus.Shared;

    public MeScreen()
    {
        campus.Changed += () => DispatcherQueue.TryEnqueue(Draw);
        Paint.Turned += Draw;
        Draw();
    }
    public override void Shown(object? argument) => Draw();

    private static string Form(string kind, string? where = null) =>
        $"{Repository.Site}/fill/?id={Product.GetProperty("forms").GetProperty(kind).GetString()}{(where is null ? "" : $"&a.where={Uri.EscapeDataString(where)}")}";
    private static async void Browse(string url) => await Windows.System.Launcher.LaunchUriAsync(new Uri(url));

    private static UIElement Value(string text, string? small = null, string colour = "ink")
    {
        var v = Kit.Column(2, Kit.Text(text, Role.Label, colour, wrap: true));
        ((TextBlock)v.Children[0]).FontSize = 14;
        if (small is not null) v.Children.Add(Kit.Text(small, Role.Caption, "muted", wrap: true));
        return v;
    }

    private void Draw()
    {
        Children.Clear();
        var page = new StackPanel();
        page.Children.Add(Pages.Header("我", campus.Preferences.Class is { } k ? $"{k}{(campus.Classes.FirstOrDefault(c => c.Id == k)?.Major is { } m ? $" · {m}" : "")}" : "还没选班级"));
        void Row(string key, UIElement value, Action? open = null) => page.Children.Add(Kit.Row(key, value, open));
        var info = campus.Classes.FirstOrDefault(c => c.Id == campus.Preferences.Class);
        Row("班级", Value(campus.Preferences.Class is { } klass ? $"{klass}{(info?.Major is { } major ? $" · {major}" : "")}" : "选择班级"), PickClass);
        if (campus.Term is { } term)
        {
            var edits = Choices.Edits(campus.Preferences, term.Term);
            var changed = edits.Hidden.Count + edits.Added.Count + (edits.Names?.Count ?? 0);
            var said = string.Join("，", new[] { $"加了 {edits.Added.Count} 门", $"隐藏了 {edits.Hidden.Count} 门", edits.Names is { Count: > 0 } n ? $"改名 {n.Count} 门" : null }.Where(s => s is not null));
            var value = new Grid(); value.ColumnDefinitions.Add(new ColumnDefinition()); value.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            value.Children.Add(Value(said));
            if (changed > 0) { var undo = Kit.Button("还原", () => Choices.Edit(campus.Preferences, term.Term, e => new([], [], null, e.Custom))); Grid.SetColumn(undo, 1); value.Children.Add(undo); }
            Row("改动", value);
        }
        var look = Kit.Choice([("0", "跟随系统"), ("1", "浅色"), ("2", "深色")], Appearance.Current.ToString(), value => { Appearance.Set(int.Parse(value)); Draw(); });
        Row("外观", look);
        var order = campus.Line?.Order ?? CampusLine.LayerOrder;
        Row("叠放", Value(string.Join(" › ", order.Select(o => KindNames[o])), "同一时间有几件事时谁在前面"), () => Layering(order));
        Row("反馈", Value("哪里不顺手、哪里不对", "写一句就行，我们会看每一条"), () => Browse(Form("feedback", "Windows · 我")));
        Row("补充数据", Value("实验课表、讲座、校车、营业时间", "教务系统里没有的，审核后放进课表和地图"), () => Browse(Form("data")));
        if (campus.Line?.Run is { } run && campus.Term is { } t2)
        {
            page.Children.Add(Pages.Section("早锻炼"));
            var settings = campus.Preferences.Get<RunSettings>("run") ?? new([]);
            var grade = int.TryParse(info?.Grade, out var year) ? t2.Year - year + 1 : 0;
            var on = settings.On ?? (grade is 1 or 2);
            var row = new Grid(); row.ColumnDefinitions.Add(new ColumnDefinition()); row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.Children.Add(Value("显示在课表上", grade is 1 or 2 ? $"大{"一二"[grade - 1]}必做，本学期 {run.Required} 次" : "大三大四需要补跑时打开"));
            var toggle = Kit.Switch(on, next => campus.Preferences.Set("run", settings with { On = next }), "早锻炼显示在课表上"); toggle.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(toggle, 1); row.Children.Add(toggle);
            Row("", row);
        }
        page.Children.Add(Pages.Section("关于"));
        Row("学生发展中心", Value("南邮计软网安"), () => Browse($"{Repository.Site}/club/"));
        Row("下载 App", Value("安卓：提醒和桌面小组件"), () => Browse($"{Repository.Site}/download/"));
        var fine = Kit.Text($"数据版本 {campus.Repository?.Release.DataVersion ?? "—"} · 地图 {campus.Repository?.Release.MapVersion ?? "—"}", Role.Caption, "faint"); fine.Margin = new Thickness(0, 16, 0, 0);
        page.Children.Add(fine);
        var links = Kit.Line(14, Link("用户协议", $"{Repository.Site}/terms/"), Link("隐私政策", $"{Repository.Site}/privacy/"), Link("关于", $"{Repository.Site}/about/"));
        links.Margin = new Thickness(0, 6, 0, 0);
        page.Children.Add(links);
        Children.Add(Pages.Frame(page, 680));
    }

    private static FrameworkElement Link(string text, string url)
    {
        var tap = new Tap { Content = Kit.Text(text, Role.Caption, "muted") };
        tap.Click += (_, _) => Browse(url);
        return tap;
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
        column.Children.Add(Pages.SheetHead(Pages.SheetTitle("叠放顺序"), () => App.Window?.Close()));
        var lead = Kit.Text("同一时间有几件事时，靠前的显示在前面，后面的露出一条边，点开任何一件都能看到同时段的其他安排。这只改变显示，不会让哪件事消失。", Role.Label, "muted", wrap: true);
        lead.Margin = new Thickness(0, 6, 0, 10); column.Children.Add(lead);
        for (var at = 0; at < order.Count; at++)
        {
            var kind = order[at];
            var value = new Grid(); value.ColumnDefinitions.Add(new ColumnDefinition()); value.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            value.Children.Add(Value(KindNames[kind]));
            if (at > 0)
            {
                var index = at;
                var up = Kit.Button("上移", () =>
                {
                    var next = order.ToList(); (next[index - 1], next[index]) = (next[index], next[index - 1]);
                    campus.Preferences.Set("layers", next);
                    Layering(next);
                });
                Grid.SetColumn(up, 1); value.Children.Add(up);
            }
            column.Children.Add(Kit.Row($"第 {at + 1} 层", value));
        }
        if (campus.Preferences.Get<List<string>>("layers") is not null)
        {
            var reset = Kit.Action("恢复默认", () => { campus.Preferences.Change("layers", null); Layering(CampusLine.LayerOrder); }); reset.HorizontalAlignment = HorizontalAlignment.Stretch; reset.Margin = new Thickness(0, 12, 0, 0);
            column.Children.Add(reset);
        }
        App.Window?.Sheet(column, 460);
    }
}
