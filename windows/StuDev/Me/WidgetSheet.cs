// The desktop widgets, put on the desktop and taken off it here: the two kinds there are (the list and the calendar,
// the app's two kinds of view), and those already placed. Opened from 我 and from the tray.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using StuDev.Ui;

namespace StuDev.Me;

public static class WidgetSheet
{
    private static readonly (string Kind, string Name, string Said)[] Kinds =
    [
        ("list", "任务", "查看待办和考试，勾选已完成的任务"),
        ("calendar", "课表", "按日、周或学期查看课程、实验和考试"),
    ];
    private static readonly Dictionary<string, string> ViewNames = new() { ["today"] = "今天", ["all"] = "全部", ["day"] = "日", ["week"] = "周", ["term"] = "学期" };

    public static void Open() => App.Window?.Sheet(Make(), 480);

    private static FrameworkElement Make()
    {
        var column = new StackPanel { Padding = new Thickness(20, 18, 20, 22), Spacing = 14 };
        column.Children.Add(Pages.SheetHead(Pages.SheetTitle("桌面小组件"), () => App.Window?.Close()));
        var kinds = new StackPanel { Background = Paint.Brush("surfaceSunken"), CornerRadius = new CornerRadius(12), Padding = new Thickness(16, 4, 12, 4) };
        foreach (var (kind, name, said) in Kinds)
        {
            var row = new Grid { Padding = new Thickness(0, 12, 0, 12) };
            row.ColumnDefinitions.Add(new ColumnDefinition()); row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.Children.Add(Kit.Column(2, Kit.Text(name, Role.Body), Kit.Text(said, Role.Caption, "muted")));
            var add = Kit.Action("添加", () => { Device.AddWidget(kind); Open(); }, colour: "brand");
            add.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(add, 1); row.Children.Add(add);
            kinds.Children.Add(row);
        }
        column.Children.Add(kinds);
        var placed = Device.Widgets;
        if (placed.Count > 0)
        {
            column.Children.Add(Pages.Section("桌面上的小组件"));
            var list = new StackPanel();
            foreach (var widget in placed)
            {
                var row = new Grid { Padding = new Thickness(0, 8, 0, 8) };
                row.ColumnDefinitions.Add(new ColumnDefinition()); row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                var kindName = Kinds.FirstOrDefault(k => k.Kind == widget.Kind).Name ?? widget.Kind;
                var state = string.Join(" · ", new[] { ViewNames.GetValueOrDefault(widget.View, widget.View), widget.OnTop ? "窗口置顶" : "固定在桌面", widget.Locked ? "已锁定" : null }.Where(s => s is not null));
                row.Children.Add(Kit.Column(2, Kit.Text(kindName, Role.Label), Kit.Text(state, Role.Caption, "muted")));
                var id = widget.Id;
                var remove = Kit.Action("移除", () => { Device.RemoveWidget(id); Open(); });
                remove.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(remove, 1); row.Children.Add(remove);
                list.Children.Add(row);
            }
            column.Children.Add(list);
            var hidden = Device.Settings.WidgetsHidden;
            column.Children.Add(Kit.Action(hidden ? "显示桌面小组件" : "暂时隐藏桌面小组件", () => { Device.Set(Device.Settings with { WidgetsHidden = !hidden }); Open(); }));
        }
        var hint = Kit.Text("拖动标题栏可移动小组件，拖动边缘可调整大小。靠近屏幕边缘或其他小组件时会自动对齐。可在右上角菜单中调整不透明度、锁定位置或置顶。", Role.Caption, "faint", wrap: true);
        column.Children.Add(hint);
        return column;
    }
}
