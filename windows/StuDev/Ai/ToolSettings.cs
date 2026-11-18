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

        Heading(page, "外部 MCP");
        var external = new StackPanel();
        page.Children.Add(external);
        FillExternal(external);
    }

    private static void FillExternal(StackPanel list)
    {
        list.Children.Clear();
        var service = ExternalMcp.Shared;
        foreach (var server in service.Servers)
        {
            var count = service.Available.Count(tool => tool.Server.Id == server.Id);
            var summary = Kit.Column(3, Kit.Text(server.Name, Role.Label, wrap: true),
                Kit.Text(server.Enabled ? $"{server.Endpoint.Host} · {count} 个可用工具" : $"{server.Endpoint.Host} · 已停用", Role.Caption, "muted", wrap: true));
            list.Children.Add(Kit.Row("", summary, () => EditExternal(server, () => FillExternal(list))));
        }
        list.Children.Add(Kit.TextAction("添加外部 MCP", () => EditExternal(null, () => FillExternal(list))));
    }

    private static void EditExternal(ExternalMcpServer? server, Action refresh)
    {
        var title = server is null ? "添加外部 MCP" : "编辑外部 MCP";
        var name = Kit.Field(server?.Name ?? "", "例如 Context7", "服务器名称");
        var address = Kit.Field(server?.Endpoint.AbsoluteUri ?? "", "https://mcp.context7.com/mcp", "MCP 地址");
        var token = new PasswordBox { Password = server?.Token ?? "", PlaceholderText = "访问令牌（可选）", MinHeight = Paint.Number("size", "control") };
        AutomationProperties.SetName(token, "访问令牌（可选）");
        var enabled = new CheckBox { Content = "启用这个服务器", IsChecked = server?.Enabled ?? true };
        var status = Kit.Text("", Role.Caption, "muted", wrap: true);
        var cancel = new CancellationTokenSource();
        var actions = Kit.Line(8, Kit.Action("取消", () => App.Window?.Close()));
        actions.HorizontalAlignment = HorizontalAlignment.Right;
        var content = Kit.Column(12, Pages.SheetHead(Pages.SheetTitle(title), () => App.Window?.Close()),
            name, address, token, enabled, status, actions);
        content.Padding = new Thickness(22, 20, 22, 18);
        Tap? save = null;
        async Task Save()
        {
            save!.IsEnabled = false;
            var cancelToken = cancel.Token;
            try
            {
                var next = ExternalMcpServer.Parse(server?.Id ?? Guid.NewGuid().ToString("N"), name.Text, address.Text, token.Password, enabled.IsChecked == true);
                status.Foreground = Paint.Brush("muted");
                status.Text = next.Enabled ? "正在读取可用工具…" : "";
                var found = next.Enabled ? await ExternalMcpConnection.Discover(next, cancelToken) : [];
                cancelToken.ThrowIfCancellationRequested();
                ExternalMcp.Shared.Save(next, found);
                App.Window?.Close();
                refresh();
            }
            catch (OperationCanceledException) when (cancelToken.IsCancellationRequested) { }
            catch (Exception failure) when (failure is InvalidOperationException or IOException or UnauthorizedAccessException)
            {
                status.Foreground = Paint.Brush("danger");
                status.Text = failure is InvalidOperationException ? failure.Message : "未能保存外部 MCP 设置。";
            }
            finally { save.IsEnabled = true; }
        }
        save = Kit.Action("保存", () => App.Watch(Save()), true);
        actions.Children.Add(save);
        if (server is not null)
        {
            foreach (var tool in ExternalMcp.Shared.Catalogue(server))
                content.Children.Insert(content.Children.Count - 2, Kit.Text(tool.Title, Role.Caption, "muted", wrap: true));
            var remove = Kit.TextAction("移除服务器", () =>
            {
                ExternalMcp.Shared.Remove(server);
                App.Window?.Close();
                refresh();
            }, colour: "danger");
            content.Children.Insert(content.Children.Count - 1, remove);
        }
        App.Window?.Sheet(content, 500, () => { cancel.Cancel(); cancel.Dispose(); });
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
