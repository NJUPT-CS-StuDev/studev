// Signing in to one's StuDev account: student number, password, and the six digits of an authenticator when one is
// set; registration and account management stay in the application. A forgotten password mails a reset link.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using StuDev.Data;
using StuDev.Ui;

namespace StuDev.Me;

public static class SignIn
{
    public static void Show(Action? signedIn = null)
    {
        var student = Kit.Field("", "学号", "学号");
        var password = new PasswordBox { PlaceholderText = "密码", MinHeight = 40, FontSize = 14.5 };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(password, "密码");
        var totp = Kit.Field("", "开了两步验证时填 6 位验证码", "验证码");
        var said = Kit.Text("", Role.Label, "danger", wrap: true);
        Tap? go = null;
        var signingIn = false;
        var active = true;
        async void Go()
        {
            if (signingIn || student.Text.Trim().Length == 0 || password.Password.Length == 0) return;
            signingIn = true; go!.IsEnabled = false; said.Text = "";
            student.IsEnabled = password.IsEnabled = totp.IsEnabled = false;
            ((TextBlock)go.Content).Text = "正在登录…";
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(go, "正在登录…");
            try
            {
                await Account.Shared.SignIn(student.Text, password.Password, totp.Text);
                if (active)
                {
                    App.Window?.Close();
                    if (signedIn is not null) signedIn();
                    else if (Account.Shared.CachedState is { } state && (state.EnrollmentRequired || state.PasswordChangeRequired || state.ProfileRequired || state.MfaRequired)) App.Open("me", "account");
                }
            }
            catch (PlatformFailure failure) { said.Text = failure.Message; }
            catch (Exception failure) when (failure is HttpRequestException or TaskCanceledException) { said.Text = "连不上 StuDev，检查一下网络。"; }
            finally {
                signingIn = false; go.IsEnabled = true;
                student.IsEnabled = password.IsEnabled = totp.IsEnabled = true;
                ((TextBlock)go.Content).Text = "登录";
                Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(go, "登录");
            }
        }
        password.KeyDown += (_, e) => { if (e.Key == Windows.System.VirtualKey.Enter) Go(); };
        totp.KeyDown += (_, e) => { if (e.Key == Windows.System.VirtualKey.Enter) Go(); };
        go = Kit.Action("登录", Go, go: true); go.HorizontalAlignment = HorizontalAlignment.Stretch;
        var register = Kit.TextAction("还没有账号？注册 StuDev", () => { if (!signingIn) Register(signedIn); });
        register.HorizontalAlignment = HorizontalAlignment.Center;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetAutomationId(register, "account-register");
        var forgot = new Tap { Content = Kit.Text("忘记密码？发送重设链接到 QQ 邮箱", Role.Label, "brand"), HorizontalAlignment = HorizontalAlignment.Center };
        forgot.Click += async (_, _) =>
        {
            if (signingIn) return;
            if (!System.Text.RegularExpressions.Regex.IsMatch(student.Text.Trim(), "^[A-Za-z0-9]{6,20}$")) { said.Text = "请先在上面填写学号。"; return; }
            forgot.IsEnabled = false;
            try { await Account.Forgot(student.Text); said.Text = "如果这个学号有账号，重设链接已经发到它绑定的 QQ 邮箱，30 分钟内有效。"; }
            catch (PlatformFailure failure) { said.Text = failure.Message; }
            catch (Exception failure) when (failure is HttpRequestException or TaskCanceledException) { said.Text = "连不上 StuDev，检查一下网络。"; }
            finally { forgot.IsEnabled = true; }
        };
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(22, 20, 22, 20) };
        column.Children.Add(Pages.SheetHead(Pages.SheetTitle("登录 StuDev"), () => App.Window?.Close()));
        column.Children.Add(Kit.Text("登录后可以用免费额度问 AI，任务在手机和电脑间同步。", Role.Label, "muted", wrap: true));
        column.Children.Add(student); column.Children.Add(password); column.Children.Add(totp);
        column.Children.Add(said); column.Children.Add(go); column.Children.Add(forgot); column.Children.Add(register);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetAutomationId(student, "account-login-student");
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetAutomationId(password, "account-login-password");
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetAutomationId(totp, "account-login-factor");
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetAutomationId(go, "account-submit");
        App.Window?.Sheet(column, 420, () => { active = false; password.Password = ""; totp.Text = ""; });
    }

    private static void Register(Action? signedIn)
    {
        var column = new StackPanel { Spacing = 14, Padding = new Thickness(22, 20, 22, 22) };
        column.Children.Add(Pages.SheetHead(Pages.SheetTitle("注册 StuDev"), () => App.Window?.Close()));
        column.Children.Add(Kit.Text("每位同学都可以注册，网页与 App 共用一个账号。", Role.Label, "muted", wrap: true));
        TextBox Field(string label, string id, int max)
        {
            var field = Kit.Field("", "", label); field.MaxLength = max;
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetAutomationId(field, id);
            column.Children.Add(Kit.Column(5, Kit.Text(label, Role.Caption, "muted"), field)); return field;
        }
        PasswordBox Password(string label, string id)
        {
            var field = new PasswordBox { MaxLength = 256, FontSize = 14.5, MinHeight = Paint.Number("size", "control") };
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(field, label);
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetAutomationId(field, id);
            column.Children.Add(Kit.Column(5, Kit.Text(label, Role.Caption, "muted"), field)); return field;
        }
        var student = Field("学号", "account-register-student", 20);
        var realName = Field("真实姓名", "account-register-name", 40);
        var nickname = Field("昵称（选填）", "account-register-nickname", 40);
        column.Children.Add(Kit.Text("留空使用默认昵称。其他同学可看到昵称、头像和签名。", Role.Caption, "muted", wrap: true));
        var qq = Field("联系 QQ", "account-register-qq", 12);
        column.Children.Add(Kit.Text("用于通知、找回密码和注销验证，也可匹配 QQ 头像。身份与联系方式仅本人和管理员可见。", Role.Caption, "muted", wrap: true));
        var password = Password("密码", "account-register-password");
        var confirm = Password("确认密码", "account-register-confirm");
        column.Children.Add(Kit.Text("密码需要 12–256 个字符，请勿使用学校统一身份认证密码。", Role.Caption, "muted", wrap: true));
        var agreed = false; var busy = false; var active = true;
        var agree = new StackPanel(); column.Children.Add(agree);
        Tap? submit = null;
        void Agreement()
        {
            agree.Children.Clear();
            var check = Kit.Check(agreed, 0, () => { if (!busy) { agreed = !agreed; Agreement(); } });
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(check, "同意用户协议与隐私政策");
            var row = new Grid { ColumnSpacing = 8 }; row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); row.ColumnDefinitions.Add(new ColumnDefinition());
            row.Children.Add(check);
            var words = Kit.Text("我已阅读并同意《用户协议》与《隐私政策》。", Role.Caption, "muted", wrap: true); Grid.SetColumn(words, 1); row.Children.Add(words); agree.Children.Add(row);
        }
        Agreement();
        var links = Kit.Line(18, Kit.TextAction("用户协议", async () => await Windows.System.Launcher.LaunchUriAsync(new Uri($"{Repository.Site}/terms/"))), Kit.TextAction("隐私政策", async () => await Windows.System.Launcher.LaunchUriAsync(new Uri($"{Repository.Site}/privacy/"))));
        column.Children.Add(links);
        var status = Kit.Text("", Role.Label, "danger", wrap: true); column.Children.Add(status);
        async void Create()
        {
            if (busy) return;
            if (!agreed) { status.Text = "请先阅读并同意用户协议与隐私政策。"; return; }
            if (password.Password != confirm.Password) { status.Text = "两次输入的密码不一致。"; return; }
            busy = true; submit!.IsEnabled = false; status.Text = "正在注册…"; status.Foreground = Paint.Brush("muted");
            student.IsEnabled = realName.IsEnabled = nickname.IsEnabled = qq.IsEnabled = password.IsEnabled = confirm.IsEnabled = false;
            try
            {
                await Account.Register(student.Text, realName.Text, nickname.Text, qq.Text, password.Password);
                if (active) Show(signedIn);
            }
            catch (Exception failure) when (failure is PlatformFailure or HttpRequestException or TaskCanceledException)
            { status.Text = failure is PlatformFailure platform ? platform.Message : "连接未完成，请检查网络后重试。"; status.Foreground = Paint.Brush("danger"); }
            finally
            {
                busy = false; submit.IsEnabled = true;
                student.IsEnabled = realName.IsEnabled = nickname.IsEnabled = qq.IsEnabled = password.IsEnabled = confirm.IsEnabled = true;
            }
        }
        submit = Kit.Action("创建账号", Create, true); submit.HorizontalAlignment = HorizontalAlignment.Right;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetAutomationId(submit, "account-register-submit"); column.Children.Add(submit);
        column.Children.Add(Kit.TextAction("已有账号？返回登录", () => { if (!busy) Show(signedIn); }));
        App.Window?.Sheet(column, 460, () => { active = false; password.Password = confirm.Password = ""; });
    }
}
