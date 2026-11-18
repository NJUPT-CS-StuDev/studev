using System.Text.Json;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using StuDev.Ui;

namespace StuDev.Ai;

internal static class ToolSettings
{
    public static void Fill(StackPanel page)
    {
        var access = ToolAccess.Shared;
        Heading(page, "StuDev MCP");
        foreach (var (group, items) in ToolMenu.For(Assistant.Shared.Tools))
        {
            var label = Kit.Text(group, Role.Caption, "muted"); label.Margin = new Thickness(0, 12, 0, 3);
            page.Children.Add(label);
            foreach (var tool in items)
                page.Children.Add(Kit.Row("", Toggle(tool.Label, access.CampusAllowed(tool.Name), enabled => access.SetCampus(tool.Name, enabled))));
        }

        Heading(page, "Local Runtime MCP");
        page.Children.Add(Kit.Text("没有授权给 StuDev 的本机工具", Role.Label, "muted", wrap: true));

        Heading(page, "Web MCP");
        page.Children.Add(Kit.Text("使用这台电脑上已授权的网页工具。请输入 Local Runtime MCP 的浏览器工具专用密钥。", Role.Label, "muted", wrap: true));
        var key = new PasswordBox { Password = access.BrowserKey, PlaceholderText = "浏览器工具专用密钥", Margin = new Thickness(0, 10, 0, 4) };
        AutomationProperties.SetName(key, "浏览器工具专用密钥");
        page.Children.Add(key);
        var available = new StackPanel();
        var status = Kit.Text("", Role.Caption, "muted", wrap: true);
        Tap? load = null, disconnect = null;
        void Catalogue()
        {
            available.Children.Clear();
            if (access.Catalogue.Count == 0)
                available.Children.Add(Kit.Text("暂无工具", Role.Label, "muted"));
            foreach (var tool in access.Catalogue)
                available.Children.Add(Kit.Row("", Toggle(tool.Title, access.BrowserAllowed(tool.Name), enabled => access.SetBrowser(tool.Name, enabled))));
        }
        async Task Read()
        {
            load!.IsEnabled = disconnect!.IsEnabled = false;
            status.Text = "正在读取已授权工具…"; status.Foreground = Paint.Brush("muted");
            try { await access.Connect(key.Password); Catalogue(); status.Text = ""; }
            catch (Exception failure) when (failure is InvalidOperationException or JsonException or IOException)
            { status.Text = failure is InvalidOperationException ? failure.Message : "未能保存或读取浏览器工具。"; status.Foreground = Paint.Brush("danger"); }
            finally { load.IsEnabled = disconnect.IsEnabled = true; }
        }
        load = Kit.TextAction("读取已授权工具", () => App.Watch(Read()));
        disconnect = Kit.TextAction("断开连接", () => { access.Disconnect(); key.Password = ""; status.Text = ""; Catalogue(); }, colour: "muted");
        page.Children.Add(Kit.Line(16, load, disconnect));
        page.Children.Add(status);
        page.Children.Add(available);
        Catalogue();
    }

    private static void Heading(StackPanel page, string title)
    {
        var heading = Kit.Text(title, Role.Label, bold: true); heading.Margin = new Thickness(0, 20, 0, 6);
        page.Children.Add(heading);
    }

    private static Grid Toggle(string label, bool active, Action<bool> changed)
    {
        var row = new Grid { ColumnSpacing = 12 };
        row.ColumnDefinitions.Add(new ColumnDefinition());
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var words = Kit.Text(label, Role.Label, wrap: true); words.VerticalAlignment = VerticalAlignment.Center;
        row.Children.Add(words);
        var control = new ToggleSwitch { IsOn = active, OnContent = "", OffContent = "", MinWidth = 0 };
        AutomationProperties.SetName(control, label);
        control.Toggled += (_, _) => changed(control.IsOn);
        Grid.SetColumn(control, 1); row.Children.Add(control);
        return row;
    }
}
