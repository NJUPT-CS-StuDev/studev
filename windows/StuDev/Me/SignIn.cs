// Signing in to one's StuDev account: student number, password, and the six digits of an authenticator when one is
// set; a forgotten password mails a reset link. Registering and the rest of the account live on the website, opened from here.
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
        async void Go()
        {
            if (signingIn || student.Text.Trim().Length == 0 || password.Password.Length == 0) return;
            signingIn = true; go!.IsEnabled = false; said.Text = "";
            student.IsEnabled = password.IsEnabled = totp.IsEnabled = false;
            ((TextBlock)go.Content).Text = "正在登录…";
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(go, "正在登录…");
            try { await Account.Shared.SignIn(student.Text, password.Password, totp.Text); App.Window?.Close(); signedIn?.Invoke(); }
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
        var register = new Tap { Content = Kit.Text("还没有账号？在网站注册", Role.Label, "brand"), HorizontalAlignment = HorizontalAlignment.Center };
        register.Click += async (_, _) => await Windows.System.Launcher.LaunchUriAsync(new Uri($"{Repository.Site}/login/"));
        var forgot = new Tap { Content = Kit.Text("忘记密码？发送重设链接到 QQ 邮箱", Role.Label, "brand"), HorizontalAlignment = HorizontalAlignment.Center };
        forgot.Click += async (_, _) =>
        {
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
        App.Window?.Sheet(column, 420);
    }
}
