using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using StuDev.Ui;

namespace StuDev.Me;

public sealed partial class AccountScreen
{
    private void Security(StackPanel page)
    {
        var me = user!;
        page.Children.Add(Kit.Text("修改密码或认证器设置后，各设备需要重新登录。", Role.Label, "muted", wrap: true));
        SecretField(page, "当前密码", password, text => password = text, "account-current-password");
        if (me.TotpEnabled)
        {
            var factor = Kit.Field(code, "动态验证码或恢复码", "动态验证码或恢复码"); factor.MaxLength = 64;
            AutomationProperties.SetAutomationId(factor, "account-factor");
            factor.TextChanged += (_, _) => { code = factor.Text; EnableControls(); };
            page.Children.Add(Kit.Column(6, Kit.Text("动态验证码或恢复码", Role.Caption, "muted"), factor)); Watch(factor);
        }

        page.Children.Add(Pages.Section("修改密码"));
        SecretField(page, "新密码", newPassword, text => newPassword = text, "account-new-password");
        SecretField(page, "确认新密码", confirmPassword, text => confirmPassword = text, "account-confirm-password");
        page.Children.Add(Kit.Text("密码须为 12 至 256 个字符，请勿使用学校统一身份认证密码。", Role.Caption, "muted", wrap: true));
        Action(page, "修改密码并重新登录", "account-change-password", () =>
        {
            if (newPassword != confirmPassword) { error = "两次输入的新密码不一致。"; UpdateStatus(); return; }
            Run("正在修改密码…", async () =>
            {
                await Account.Shared.ChangePassword(password, newPassword, code);
                ClearSecrets(); notice = "密码已修改，请重新登录。";
            });
        }, () => state is not null && password.Length > 0 && newPassword.Length >= 12 && confirmPassword.Length > 0 && (!me.TotpEnabled || code.Trim().Length > 0));

        page.Children.Add(Kit.Hairline());
        page.Children.Add(Pages.Section("认证器验证"));
        page.Children.Add(Kit.Text(me.TotpEnabled ? "已开启。新设备登录和修改账号安全设置时需要验证。" : "可使用任意支持 TOTP 的认证器。", Role.Label, "muted", wrap: true));
        if (recovery.Count > 0)
        {
            page.Children.Add(Kit.Text("恢复码只显示一次，请妥善离线保存。每个恢复码仅可使用一次。", Role.Label, "brand", wrap: true));
            var saved = Kit.Text(string.Join('\n', recovery), Role.Label, wrap: true); saved.IsTextSelectionEnabled = true; saved.FontFamily = Kit.Mono;
            AutomationProperties.SetAutomationId(saved, "account-recovery-codes"); page.Children.Add(saved);
            Action(page, "我已保存恢复码", "account-recovery-saved", () => { recovery.Clear(); Draw(); });
        }
        if (!me.TotpEnabled)
        {
            if (secret.Length == 0)
                Action(page, "绑定认证器", "account-setup-totp", () => Run("正在准备认证器…", async () =>
                {
                    secret = await Account.Shared.SetupTotp(password); code = ""; notice = "请在认证器中添加密钥，再输入动态验证码。";
                }), () => state is not null && !state.PasswordChangeRequired && password.Length > 0);
            else
            {
                page.Children.Add(Kit.Text("在认证器中选择手动添加。名称填 StuDev，类型选基于时间，算法选 SHA-1，验证码为 6 位，每 30 秒更新。", Role.Caption, "muted", wrap: true));
                var key = Kit.Text(secret, Role.Label, wrap: true); key.IsTextSelectionEnabled = true; key.FontFamily = Kit.Mono;
                AutomationProperties.SetAutomationId(key, "account-totp-secret"); page.Children.Add(key);
                var factor = Kit.Field(code, "6 位动态验证码", "认证器的 6 位动态验证码"); factor.MaxLength = 6;
                AutomationProperties.SetAutomationId(factor, "account-enrollment-code");
                factor.TextChanged += (_, _) => { code = factor.Text; EnableControls(); }; Watch(factor); page.Children.Add(factor);
                Action(page, "确认绑定", "account-confirm-totp", () => Run("正在绑定认证器…", async () =>
                {
                    // The one-time codes are kept before any later request can fail.
                    recovery = await Account.Shared.ConfirmTotp(code);
                    password = code = secret = ""; notice = "认证器已绑定，请保存恢复码。";
                    // Confirmation changes the server's user revision. Show the
                    // recovery codes immediately while refreshing that revision.
                    _ = Verify();
                }), () => code.Length == 6, true);
            }
        }
        else if (me.Role != "owner")
            Action(page, "解绑认证器并重新登录", "account-disable-totp", () => Confirm("解绑认证器？", "解绑后，所有登录设备都需要重新登录。请确认已填写当前密码和动态验证码。", "确认解绑", () => Run("正在解绑认证器…", async () =>
            {
                await Account.Shared.DisableTotp(password, code); ClearSecrets(); notice = "认证器已解绑，请重新登录。";
            })), () => state is not null && password.Length > 0 && code.Trim().Length > 0);
        else page.Children.Add(Kit.Text("所有者账号需保留认证器验证。", Role.Caption, "muted", wrap: true));

        if (me.Role != "owner")
        {
            page.Children.Add(Kit.Hairline());
            page.Children.Add(Pages.Section("注销账号"));
            var mailbox = me.Email.Length > 0 ? me.Email : $"{me.Qq}@qq.com";
            page.Children.Add(Kit.Text($"确认邮件会发到 {mailbox}。在邮件中确认注销后，账号和学号绑定会删除，所有设备都会退出登录。注销后无法恢复。", Role.Label, "muted", wrap: true));
            Action(page, "发送注销确认邮件", "account-request-deletion", () => Confirm("申请注销账号？", $"确认邮件将发到 {mailbox}，链接 30 分钟内有效。请在邮件中确认注销。", "发送确认邮件", () => Run("正在发送确认邮件…", async () =>
            {
                await Account.Shared.RequestDeletion(password); password = ""; notice = $"注销确认邮件已发到 {mailbox}。请在 30 分钟内打开邮件并确认。";
            })), () => state is not null && password.Length > 0, colour: "danger");
        }
    }
}
