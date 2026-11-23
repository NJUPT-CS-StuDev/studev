// A check for updates answers in a sheet over whatever page is open, as Android's dialog does: while it looks, then
// what it found, with the one thing to do next.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using StuDev.Ui;
using StuDev.World;

namespace StuDev.Me;

internal static class UpdateSheet
{
    private static int asked;

    /** Asked for from 我: looks for a newer StuDev and newer campus data. */
    public static async void Check(Campus campus)
    {
        var mine = ++asked;
        Show("正在检查更新", "正在检查应用和校园数据的版本。", null, busy: true);
        var before = campus.Repository?.Release.Version;
        var app = await Updates.Check();
        await campus.Refresh();
        if (mine != asked || App.Window?.SheetOpen != true) return;
        var versions = $"StuDev {Updates.Version} · 数据 {campus.Repository?.Release.DataVersion ?? "—"}";
        var fresh = campus.Repository?.Release.Version != before;
        if (campus.AppRequired) { Required(campus); return; }
        switch (app)
        {
            case Updates.Outcome.Ready:
                Show($"新版本 {Updates.Ready} 已准备好", (fresh ? "校园数据已更新。" : "") + "重启 StuDev 即可更新，班级和设置都会保留。", ("立即重启更新", Updates.RestartNow));
                break;
            case Updates.Outcome.Offline:
                Show("无法连接更新服务", $"仍可使用已保存的校园数据，请联网后重试。\n{versions}", null);
                break;
            default:
                if (campus.UpdateError is { } error) Show("校园数据更新失败", $"{error}\n{versions}", null);
                else Show(fresh ? "校园数据已更新" : "已是最新", app == Updates.Outcome.NotInstalled ? $"{versions}\n当前运行的是便携版。请到下载页获取新版本。" : versions,
                    app == Updates.Outcome.NotInstalled ? ("打开下载页", () => Browse($"{Data.Repository.Site}/download/")) : null);
                break;
        }
    }

    /** The site now publishes data only a newer StuDev reads: say so over everything, and fetch the update. */
    public static async void Required(Campus campus)
    {
        var mine = ++asked;
        Show("请更新 StuDev", "请更新应用以使用最新的校园数据。正在下载新版本…", null, busy: true);
        var app = await Updates.Check();
        if (mine != asked || App.Window?.SheetOpen != true) return;
        if (app == Updates.Outcome.Ready) Show($"新版本 {Updates.Ready} 已准备好", "重启 StuDev 即可更新，班级和设置都会保留。", ("立即重启更新", Updates.RestartNow));
        else Show("请更新 StuDev", "请到下载页安装新版本，以使用最新的校园数据。班级和设置都会保留。", ("打开下载页", () => Browse($"{Data.Repository.Site}/download/")));
    }

    private static void Show(string title, string text, (string Label, Action Act)? go, bool busy = false)
    {
        var page = new StackPanel { Padding = new Thickness(22), Spacing = 16 };
        page.Children.Add(Pages.SheetHead(Pages.SheetTitle(title), () => App.Window?.Close()));
        if (busy) page.Children.Add(Kit.Line(12, new ProgressRing { IsActive = true, Width = 20, Height = 20 }, Kit.Text(text, Role.Label, "muted", wrap: true)));
        else page.Children.Add(Kit.Text(text, Role.Label, "muted", wrap: true));
        var buttons = go is { } action
            ? Kit.Line(12, Kit.TextAction("稍后", () => App.Window?.Close(), colour: "muted"), Kit.Action(action.Label, () => { App.Window?.Close(); action.Act(); }, true))
            : Kit.Line(12, Kit.Action(busy ? "关闭" : "好", () => App.Window?.Close()));
        buttons.HorizontalAlignment = HorizontalAlignment.Right;
        page.Children.Add(buttons);
        App.Window?.Sheet(page, 440);
    }

    private static async void Browse(string url) => await Windows.System.Launcher.LaunchUriAsync(new Uri(url));
}
