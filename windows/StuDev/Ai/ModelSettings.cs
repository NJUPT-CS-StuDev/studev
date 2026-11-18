using System.Text.Json;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Microsoft.UI.Xaml.Shapes;
using StuDev.Ui;

namespace StuDev.Ai;

/** The device's model services, managed together in settings. */
internal static class ModelSettings
{
    private static readonly HttpClient Http = new(new HttpClientHandler { AllowAutoRedirect = false })
    { Timeout = TimeSpan.FromSeconds(20) };

    public static void Fill(StackPanel page, Action refresh)
    {
        var providers = ModelProviders.Shared;
        var free = Assistant.Shared.FreeService;
        page.Children.Add(Kit.Row("", Kit.Line(10, FreeAvatar(32), Summary(free.ModelName, free.Description))));
        foreach (var provider in providers.Configured)
        {
            var count = provider.Models.Count(model => model.Enabled);
            page.Children.Add(Kit.Row("", Summary(provider.Name, $"{(provider.Enabled ? "已启用" : "已停用")} · {count} 个模型已启用"),
                () => Edit(provider, provider.Runtime, refresh)));
        }
        page.Children.Add(Kit.TextAction("添加 API 服务商", () => Edit(null, false, refresh)));
        if (providers.Find(ModelProviders.RuntimeId) is null)
            page.Children.Add(Kit.TextAction("连接 Local Runtime MCP", () => Edit(null, true, refresh)));
    }

    private static StackPanel Summary(string name, string description) =>
        Kit.Column(3, Kit.Text(name, Role.Label, wrap: true), Kit.Text(description, Role.Caption, "muted", wrap: true));

    internal static BitmapImage FreeAvatarImage() => new(new Uri("ms-appx:///Assets/hicancan-avatar.png"));

    internal static Ellipse FreeAvatar(double size) => new()
    {
        Width = size, Height = size, VerticalAlignment = VerticalAlignment.Center,
        Fill = new ImageBrush { ImageSource = FreeAvatarImage(), Stretch = Stretch.UniformToFill },
    };

    private static void Edit(ModelProvider? provider, bool runtime, Action refresh)
    {
        var service = ModelProviders.Shared;
        var title = provider?.Name ?? (runtime ? ModelProviders.RuntimeName : "添加 API 服务商");
        var name = Kit.Field(provider?.Name ?? "", "例如 DeepSeek、腾讯云", "服务商名称");
        var address = Kit.Field(provider?.Address ?? (runtime ? Models.Runtime.Base : ""), "https://api.deepseek.com", "接口地址");
        var secretLabel = runtime ? "模型专用密钥" : "API Key";
        var secret = new PasswordBox { Password = provider?.Key ?? "", PlaceholderText = secretLabel, MinHeight = Paint.Number("size", "control"), FontSize = 14.5 };
        AutomationProperties.SetName(secret, secretLabel);
        var enabled = new CheckBox { Content = "启用服务商", IsChecked = provider?.Enabled ?? true };
        var models = provider?.Models.ToList() ?? [];
        var list = new StackPanel { Spacing = 2 };
        var field = Kit.Field("", "输入模型 ID", "模型 ID");
        var status = Kit.Text("", Role.Caption, "muted", wrap: true);
        var cancelDiscovery = new CancellationTokenSource();
        var column = Kit.Column(12, Pages.SheetHead(Pages.SheetTitle(title), () => App.Window?.Close()));
        column.Padding = new Thickness(22, 20, 22, 18);
        TextBlock Label(string text)
        {
            var label = Kit.Text(text, Role.Label, "muted"); label.Margin = new Thickness(0, 4, 0, -6); return label;
        }
        if (!runtime) { column.Children.Add(Label("服务商名称")); column.Children.Add(name); }
        column.Children.Add(Label("接口地址")); column.Children.Add(address);
        column.Children.Add(Label(secretLabel)); column.Children.Add(secret);
        column.Children.Add(enabled);

        void ShowModels()
        {
            list.Children.Clear();
            foreach (var model in models)
            {
                var check = new CheckBox { Content = Kit.Text(model.Id, Role.Label, wrap: true), IsChecked = model.Enabled };
                AutomationProperties.SetName(check, model.Id);
                void Enable(bool on)
                {
                    var at = models.FindIndex(value => value.Id == model.Id);
                    if (at >= 0) models[at] = model with { Enabled = on };
                }
                check.Checked += (_, _) => Enable(true);
                check.Unchecked += (_, _) => Enable(false);
                list.Children.Add(check);
            }
        }

        void Report(string message, bool bad = false)
        {
            status.Text = message;
            status.Foreground = Paint.Brush(bad ? "danger" : "muted");
        }
        async Task Discover(Tap button)
        {
            var root = address.Text.Trim();
            var key = secret.Password.Trim();
            button.IsEnabled = false;
            Report("正在拉取模型列表…");
            try
            {
                var found = await Models.FetchModelsAsync(Http, root, key, runtime, cancelDiscovery.Token);
                if (cancelDiscovery.IsCancellationRequested || root != address.Text.Trim() || key != secret.Password.Trim()) return;
                var existing = models.Select(model => model.Id).ToHashSet(StringComparer.Ordinal);
                models.AddRange(found.Where(existing.Add).Select(id => new ProviderModel(id, false)));
                ShowModels();
                Report($"已获取 {found.Count} 个模型。勾选后可在聊天中选择。");
            }
            catch (InvalidOperationException failure) { if (!cancelDiscovery.IsCancellationRequested) Report(failure.Message, true); }
            catch (OperationCanceledException) { if (!cancelDiscovery.IsCancellationRequested) Report("模型列表请求超时。", true); }
            catch (Exception failure) when (failure is IOException or HttpRequestException or JsonException)
            { if (!cancelDiscovery.IsCancellationRequested) Report("未能读取模型列表，请检查接口地址，或手动添加模型。", true); }
            finally { button.IsEnabled = true; }
        }
        Tap? pull = null;
        pull = Kit.Action("拉取模型列表", () => App.Watch(Discover(pull!)));
        column.Children.Add(Label("启用的模型"));
        column.Children.Add(pull);
        column.Children.Add(new ScrollViewer { Content = list, MaxHeight = 180, HorizontalScrollMode = ScrollMode.Disabled, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
        void Add()
        {
            var id = field.Text.Trim();
            if (id.Length == 0) { Report("请输入模型 ID。", true); return; }
            var at = models.FindIndex(model => model.Id == id);
            if (at < 0) models.Add(new(id));
            else models[at] = models[at] with { Enabled = true };
            field.Text = "";
            Report("");
            ShowModels();
        }
        var add = Kit.Action("添加模型", Add);
        var newModel = new Grid { ColumnSpacing = 8 };
        newModel.ColumnDefinitions.Add(new ColumnDefinition()); newModel.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        newModel.Children.Add(field); Grid.SetColumn(add, 1); newModel.Children.Add(add);
        field.KeyDown += (_, keyEvent) => { if (keyEvent.Key == Windows.System.VirtualKey.Enter) { keyEvent.Handled = true; Add(); } };
        column.Children.Add(newModel);
        column.Children.Add(status);
        ShowModels();

        void Save()
        {
            var label = runtime ? ModelProviders.RuntimeName : name.Text.Trim();
            var root = address.Text.Trim();
            var key = secret.Password.Trim();
            if (label.Length == 0) { Report("请为服务商填写名称。", true); return; }
            if (Models.AddressError(root, runtime) is { } wrong) { Report(wrong, true); return; }
            if (key.Length == 0) { Report($"请填写{secretLabel}。", true); return; }
            var id = provider?.Id ?? (runtime ? ModelProviders.RuntimeId : Guid.NewGuid().ToString("N"));
            service.Put(new(id, label, root, key, enabled.IsChecked == true, models.ToList()));
            App.Window?.Close(); refresh();
        }
        void Remove()
        {
            if (provider is null) return;
            var content = Kit.Column(12,
                Pages.SheetHead(Pages.SheetTitle("移除服务商"), () => App.Window?.Close()),
                Kit.Text($"移除「{provider.Name}」及本机密钥。现有聊天需要重新选择模型才能继续。", Role.Body, wrap: true),
                Kit.Line(8, Kit.Action("取消", () => App.Window?.Close()),
                    Kit.Action("移除", () => { service.Remove(provider.Id); App.Window?.Close(); refresh(); }, colour: "danger")));
            content.Padding = new Thickness(22, 20, 22, 18);
            App.Window?.Sheet(content, 420);
        }
        var actions = Kit.Line(8, Kit.Action("取消", () => App.Window?.Close()), Kit.Action("保存", Save, true));
        actions.HorizontalAlignment = HorizontalAlignment.Right;
        if (provider is not null) column.Children.Add(Kit.TextAction("移除服务商", Remove, colour: "danger"));
        column.Children.Add(actions);
        App.Window?.Sheet(column, 500, () => { cancelDiscovery.Cancel(); cancelDiscovery.Dispose(); });
    }
}
