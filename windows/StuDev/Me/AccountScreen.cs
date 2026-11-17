using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using StuDev.Ui;

namespace StuDev.Me;

/** The same private account as web and Android, inside the application. */
public sealed partial class AccountScreen : Screen
{
    private readonly Action back;
    private AccountState? state;
    private AccountUser? user;
    private string tab = "profile";
    private string student = "", realName = "", nickname = "", signature = "";
    private string password = "", newPassword = "", confirmPassword = "", code = "", secret = "";
    private List<string> recovery = [];
    private List<AccountDevice> devices = [];
    private string? devicesFor;
    private bool active, busy, verifying, devicesLoading;
    private int visit, verificationVisit, devicesVisit;
    private bool profileDirty;
    private string? notice, error, devicesError;
    private TextBlock? status;
    private StackPanel? devicesRows;
    private TextBlock? devicesStatus;
    private readonly List<Control> deviceControls = [];
    private readonly List<(Control Control, Func<bool> Ready)> controls = [];

    public AccountScreen(Action back)
    {
        this.back = back;
        Account.Shared.Changed += () => DispatcherQueue.TryEnqueue(AccountChanged);
        Paint.Turned += () => { if (active) Draw(); };
        Unloaded += (_, _) => Leave();
    }

    public override void Shown(object? argument)
    {
        active = true; visit++;
        tab = argument is "security" or "devices" ? (string)argument : "profile"; notice = error = null;
        Accept(Account.Shared.CachedState, true);
        Draw();
        _ = Verify();
        if (tab == "devices") _ = LoadDevices();
    }

    public void Leave()
    {
        active = false; visit++;
        ClearSecrets();
        // Hidden pages keep no editable secrets or recovery codes in their visual tree.
        Children.Clear(); controls.Clear(); deviceControls.Clear();
    }

    private void ClearSecrets() { password = newPassword = confirmPassword = code = secret = ""; recovery.Clear(); }
    private void Accept(AccountState? value, bool resetDrafts = false)
    {
        var next = value?.User ?? Account.Shared.User;
        if (resetDrafts || next?.Id != user?.Id || !profileDirty)
        {
            student = next?.StudentId ?? ""; realName = next?.RealName ?? "";
            nickname = next?.DisplayNickname ?? ""; signature = next?.Signature ?? "";
            profileDirty = false;
        }
        if (next?.Id != user?.Id) { ClearSecrets(); devices.Clear(); devicesFor = null; }
        state = value; user = next;
    }

    private void AccountChanged()
    {
        if (!active || busy || verifying) return;
        var next = Account.Shared.User;
        if (next?.Id != user?.Id) { Accept(Account.Shared.CachedState, true); Draw(); }
    }

    private async Task Verify()
    {
        if (verifying && verificationVisit == visit || Account.Shared.User is null) return;
        var currentVisit = visit; var owner = Account.Shared.User.Id;
        verificationVisit = currentVisit; verifying = true; UpdateStatus(); EnableControls();
        try
        {
            var fresh = await Account.Shared.State();
            if (!active || currentVisit != visit || Account.Shared.User?.Id != owner) return;
            var changed = fresh.User != user || state?.ProfileRequired != fresh.ProfileRequired;
            Accept(fresh);
            if (changed) Draw();
        }
        catch (Exception failure) when (failure is PlatformFailure or HttpRequestException or TaskCanceledException)
        {
            if (active && currentVisit == visit) error = Message(failure);
        }
        finally
        {
            if (verificationVisit == currentVisit) verifying = false;
            if (active && currentVisit == visit)
            {
                if (Account.Shared.User?.Id != owner) { Accept(Account.Shared.CachedState, true); Draw(); }
                else { UpdateStatus(); EnableControls(); }
            }
        }
    }

    private static string Message(Exception failure) => failure is PlatformFailure platform ? platform.Message : "连接未完成，请检查网络后重试。";
    private void UpdateStatus()
    {
        if (status is null) return;
        status.Text = error ?? notice ?? (verifying ? "正在验证登录状态…" : "");
        status.Foreground = Paint.Brush(error is null ? "muted" : "danger");
        status.Visibility = status.Text.Length == 0 ? Visibility.Collapsed : Visibility.Visible;
    }

    private void Watch(Control control, Func<bool>? ready = null)
    {
        controls.Add((control, ready ?? (() => true)));
        control.IsEnabled = !busy && (ready?.Invoke() ?? true);
    }
    private void EnableControls() { foreach (var (control, ready) in controls) control.IsEnabled = !busy && ready(); }
    private async void Run(string progress, Func<Task> action)
    {
        if (busy || !active) return;
        var currentVisit = visit;
        busy = true; error = null; notice = progress; UpdateStatus(); EnableControls();
        try { await action(); }
        catch (Exception failure) when (failure is PlatformFailure or HttpRequestException or TaskCanceledException)
        {
            if (active && currentVisit == visit) { error = Message(failure); notice = null; }
        }
        finally
        {
            busy = false;
            if (active && currentVisit == visit) { Accept(Account.Shared.CachedState); Draw(); }
            else
            {
                ClearSecrets();
                if (active) { Accept(Account.Shared.CachedState); Draw(); }
            }
        }
    }

    private static StackPanel Words(string title, string? note = null)
    {
        var words = Kit.Column(3, Kit.Text(title, Role.Label, wrap: true));
        if (!string.IsNullOrEmpty(note)) words.Children.Add(Kit.Text(note, Role.Caption, "muted", wrap: true));
        return words;
    }
    private TextBox Field(StackPanel page, string label, string value, Action<string> change, string id, int max = 40, bool readOnly = false)
    {
        var box = Kit.Field(value, "", label); box.MaxLength = max; box.IsReadOnly = readOnly;
        AutomationProperties.SetAutomationId(box, id);
        box.TextChanged += (_, _) => { profileDirty = true; change(box.Text); };
        page.Children.Add(Kit.Column(6, Kit.Text(label, Role.Caption, "muted"), box));
        Watch(box, () => !verifying && state is not null);
        return box;
    }
    private PasswordBox SecretField(StackPanel page, string label, string value, Action<string> change, string id)
    {
        var box = new PasswordBox { Password = value, MaxLength = 256, FontSize = 14.5, MinHeight = Paint.Number("size", "control") };
        AutomationProperties.SetName(box, label); AutomationProperties.SetAutomationId(box, id);
        box.PasswordChanged += (_, _) => { change(box.Password); EnableControls(); };
        page.Children.Add(Kit.Column(6, Kit.Text(label, Role.Caption, "muted"), box)); Watch(box);
        return box;
    }
    private Tap Action(StackPanel page, string label, string id, Action run, Func<bool>? ready = null, bool primary = false, string colour = "ink")
    {
        var action = Kit.Action(label, run, primary, colour); action.HorizontalAlignment = HorizontalAlignment.Right;
        AutomationProperties.SetAutomationId(action, id); Watch(action, ready); page.Children.Add(action); return action;
    }

    private void Draw()
    {
        if (!active) return;
        Children.Clear(); controls.Clear();
        var page = new StackPanel { Spacing = 16 };
        page.Children.Add(Pages.Header("账号", "", Kit.TextAction("返回", back, Icons.Back)));
        AutomationProperties.SetAutomationId(page, "account-page");
        if (user is null)
        {
            page.Children.Add(Pages.Empty("登录后查看账号、管理安全与登录设备。", Kit.Action("登录 StuDev", () => SignIn.Show(() => Shown(null)), true)));
            if (notice is not null) page.Children.Add(Kit.Text(notice, Role.Label, "muted", wrap: true));
            Children.Add(Pages.Frame(page, 680)); return;
        }
        page.Children.Add(Kit.Tabs([("profile", "我的账号"), ("security", "账号安全"), ("devices", "登录设备")], tab, next =>
        {
            if (busy || next == tab) return;
            ClearSecrets(); tab = next; notice = error = null; Draw();
            if (tab == "devices" && devicesFor != user?.Id) _ = LoadDevices();
        }));
        status = Kit.Text("", Role.Label, "muted", wrap: true);
        AutomationProperties.SetAutomationId(status, "account-status");
        AutomationProperties.SetLiveSetting(status, AutomationLiveSetting.Polite);
        page.Children.Add(status); UpdateStatus();
        if (state?.PasswordChangeRequired == true || state?.EnrollmentRequired == true)
            page.Children.Add(Kit.Text($"请先在「账号安全」中{(state.PasswordChangeRequired ? "修改临时密码" : "绑定认证器")}，完成账号设置。", Role.Label, "brand", wrap: true));
        if (tab == "profile") Profile(page);
        else if (tab == "devices") Devices(page);
        else Security(page);
        page.Children.Add(Kit.Hairline());
        var exit = Kit.TextAction("退出登录", () => ConfirmExit(null), colour: "muted");
        AutomationProperties.SetAutomationId(exit, "account-signout"); Watch(exit); page.Children.Add(exit);
        Children.Add(Pages.Frame(page, 680));
    }

    private void Profile(StackPanel page)
    {
        var me = user!;
        var avatar = new AccountAvatar(64); avatar.Show(me);
        var identity = Kit.Line(16, avatar, Words(me.Nickname, $"学号 {me.StudentId}"));
        page.Children.Add(identity);
        var rows = new StackPanel();
        void Row(string key, string value) => rows.Children.Add(Kit.Row(key, Words(string.IsNullOrEmpty(value) ? "未设置" : value)));
        Row("学号", me.StudentId); Row("姓名", me.RealName); Row("昵称", me.DisplayNickname);
        Row("QQ 号", me.Qq); Row("联系邮箱", me.Email.Length > 0 ? me.Email : $"{me.Qq}@qq.com");
        if (me.Role != "user") { if (me.Department.Length > 0) Row("部门", me.Department); if (me.Title.Length > 0) Row("职责", me.Title); }
        page.Children.Add(rows);
        var incomplete = state?.ProfileRequired == true || !me.ProfileComplete;
        if (incomplete)
        {
            page.Children.Add(Kit.Text("请完善学号与姓名，确认后将与账号绑定。", Role.Label, "brand", wrap: true));
            Field(page, "学号", student, text => student = text, "account-student", 20, me.StudentId.Length > 0);
            Field(page, "真实姓名", realName, text => realName = text, "account-real-name", 40, me.RealName.Length > 0);
        }
        Field(page, "显示昵称（选填）", nickname, text => nickname = text, "account-nickname");
        Field(page, "个人签名（选填）", signature, text => signature = text, "account-signature", 120);
        page.Children.Add(Kit.Text(me.Role == "user" ? "其他同学只会看到你的昵称。身份与联系方式仅本人和管理员可见。" : "昵称与签名将显示在组织成员名录。", Role.Caption, "muted", wrap: true));
        Action(page, incomplete ? "确认并绑定身份" : "保存个人资料", "account-save-profile", () => Run("正在保存…", async () =>
        {
            await Account.Shared.SaveProfile(me.Revision, student, realName, nickname, signature);
            Accept(Account.Shared.CachedState, true); notice = "资料已保存。";
        }), () => !verifying && state is not null && !state.PasswordChangeRequired && !state.EnrollmentRequired && !state.MfaRequired, true);
        if (error is not null) page.Children.Add(Kit.TextAction("刷新账号信息", () => _ = Verify(), Icons.Again));
        page.Children.Add(Kit.Row("同步", Words("任务和课表设置在已登录的设备间同步", "桌面小组件位置、提醒和后台运行设置保留在这台电脑")));
    }

    private void Devices(StackPanel page)
    {
        page.Children.Add(Kit.Text("查看已登录的浏览器和应用，退出后需要重新登录。", Role.Label, "muted", wrap: true));
        var refresh = Kit.TextAction("刷新", () => _ = LoadDevices(), Icons.Again);
        refresh.HorizontalAlignment = HorizontalAlignment.Right;
        AutomationProperties.SetAutomationId(refresh, "account-refresh-devices"); Watch(refresh, () => !devicesLoading); page.Children.Add(refresh);
        devicesStatus = Kit.Text("", Role.Caption, "muted"); page.Children.Add(devicesStatus);
        devicesRows = new StackPanel(); page.Children.Add(devicesRows); DrawDevices();
    }

    private void DrawDevices()
    {
        if (devicesRows is null) return;
        foreach (var old in deviceControls) controls.RemoveAll(value => ReferenceEquals(value.Control, old));
        deviceControls.Clear();
        devicesRows.Children.Clear();
        if (devicesError is not null) devicesRows.Children.Add(Kit.Text(devicesError, Role.Label, "danger", wrap: true));
        if (devicesStatus is not null) { devicesStatus.Text = devicesLoading ? "正在读取设备…" : ""; devicesStatus.Visibility = devicesLoading ? Visibility.Visible : Visibility.Collapsed; }
        foreach (var device in devices)
        {
            var created = DateTimeOffset.TryParse(device.CreatedAt, out var at) ? at.ToOffset(TimeSpan.FromHours(8)).ToString("yyyy年M月d日 HH:mm") : device.CreatedAt;
            var row = new Grid { ColumnSpacing = 16, Padding = new Thickness(0, 12, 0, 12), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 1, 0, 0) };
            row.ColumnDefinitions.Add(new ColumnDefinition()); row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.Children.Add(Words(device.DeviceName + (device.Current ? " · 当前设备" : ""), $"{(device.Kind == "cookie" ? "浏览器" : "应用")} · 登录于 {created}"));
            var revoke = Kit.TextAction("退出", () => ConfirmExit(device), colour: "muted");
            AutomationProperties.SetAutomationId(revoke, device.Current ? "account-revoke-current" : "account-revoke-device");
            revoke.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(revoke, 1); Watch(revoke); deviceControls.Add(revoke); row.Children.Add(revoke); devicesRows.Children.Add(row);
        }
        if (!devicesLoading && devicesError is null && devicesFor is not null && devices.Count == 0) devicesRows.Children.Add(Pages.Empty("没有登录设备。"));
    }

    private async Task LoadDevices()
    {
        if (devicesLoading && devicesVisit == visit || user is null) return;
        var owner = user.Id; var currentVisit = visit;
        devicesVisit = currentVisit;
        devicesLoading = true; devicesError = null;
        // Retain the current rows and focused action during refresh.
        if (devicesStatus is not null) { devicesStatus.Text = "正在读取设备…"; devicesStatus.Visibility = Visibility.Visible; }
        EnableControls();
        try
        {
            var found = await Account.Shared.Devices();
            if (active && visit == currentVisit && Account.Shared.User?.Id == owner) { devices = found; devicesFor = owner; }
        }
        catch (Exception failure) when (failure is PlatformFailure or HttpRequestException or TaskCanceledException)
        { if (active && visit == currentVisit) devicesError = Message(failure); }
        finally
        {
            if (devicesVisit == currentVisit) devicesLoading = false;
            if (active && visit == currentVisit && tab == "devices") { DrawDevices(); EnableControls(); }
        }
    }

    private void ConfirmExit(AccountDevice? device)
    {
        Confirm(device is null ? "退出此账号？" : $"退出{device.DeviceName}？", "此设备需要重新登录才能使用账号服务。", "确认退出", () => Run("正在退出…", async () =>
        {
            if (device is null) await Account.Shared.SignOut(); else await Account.Shared.RevokeDevice(device.Id);
            if (device is null || device.Current) { Accept(null, true); notice = "已退出登录。"; }
            else { devices.RemoveAll(value => value.Id == device.Id); notice = "设备已退出登录。"; }
        }));
    }

    private static void Confirm(string title, string text, string label, Action confirm)
    {
        var page = new StackPanel { Padding = new Thickness(22), Spacing = 16 };
        page.Children.Add(Pages.SheetHead(Pages.SheetTitle(title), () => App.Window?.Close()));
        page.Children.Add(Kit.Text(text, Role.Label, "muted", wrap: true));
        var buttons = Kit.Line(12, Kit.TextAction("取消", () => App.Window?.Close(), colour: "muted"), Kit.Action(label, () => { App.Window?.Close(); confirm(); }, true));
        buttons.HorizontalAlignment = HorizontalAlignment.Right; page.Children.Add(buttons); App.Window?.Sheet(page, 440);
    }
}
