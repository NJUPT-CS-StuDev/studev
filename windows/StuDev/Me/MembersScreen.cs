using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using StuDev.Ui;

namespace StuDev.Me;

/** A member directory consumes only the public projection, independently of account management. */
public sealed partial class MembersScreen : Screen
{
    private readonly Action back;
    private readonly StackPanel content = new() { Spacing = 12 };
    private readonly List<PublicMember> members = [];
    private TextBox? search;
    private TextBlock? status;
    private string query = "", owner = "";
    private string? selected, error;
    private PublicMember? detail;
    private int total, visit;
    private bool active, loading;
    private CancellationTokenSource? debounce;

    public MembersScreen(Action back)
    {
        this.back = back;
        Account.Shared.Changed += () => DispatcherQueue.TryEnqueue(AccountChanged);
        Paint.Turned += () => { if (active) Draw(); };
        Unloaded += (_, _) => Leave();
    }

    public override void Shown(object? argument)
    {
        active = true; visit++;
        selected = null; detail = null; error = null; query = "";
        if (argument is Uri uri)
        {
            var values = System.Web.HttpUtility.ParseQueryString(uri.Query);
            selected = values["id"];
            query = values["query"] ?? "";
        }
        owner = Account.Shared.User?.Id ?? "";
        members.Clear(); total = 0; loading = false;
        Draw();
        if (owner.Length > 0) _ = selected is null ? Load(true) : LoadDetail();
    }

    public void Leave() { active = false; visit++; debounce?.Cancel(); debounce?.Dispose(); debounce = null; }
    private void AccountChanged()
    {
        if (!active || owner == (Account.Shared.User?.Id ?? "")) return;
        owner = Account.Shared.User?.Id ?? ""; visit++; members.Clear(); detail = null; total = 0; error = null; loading = false;
        Draw();
        if (owner.Length > 0) _ = selected is null ? Load(true) : LoadDetail();
    }
    private void Back()
    {
        if (selected is null) { back(); return; }
        selected = null; detail = null; error = null; visit++; loading = false; Draw();
        if (members.Count == 0 && owner.Length > 0) _ = Load(true);
    }
    private void Draw()
    {
        Children.Clear();
        var page = new StackPanel { Spacing = 12 };
        page.Children.Add(Pages.Header(selected is null ? "成员" : "成员资料", "", Kit.TextAction("返回", Back, Icons.Back)));
        if (Account.Shared.User is null)
        {
            page.Children.Add(Pages.Empty("登录后查看成员", Kit.Action("登录", () => SignIn.Show(() => AccountChanged()))));
        }
        else
        {
            if (selected is null)
            {
                search = Kit.Field(query, "搜索昵称", "搜索昵称");
                AutomationProperties.SetAutomationId(search, "members-search");
                search.TextChanged += (_, _) => { query = search.Text; QueueSearch(); };
                page.Children.Add(Kit.SearchField(search));
            }
            status = Kit.Text("", Role.Caption, "muted", wrap: true);
            AutomationProperties.SetAutomationId(status, "members-status");
            page.Children.Add(status); page.Children.Add(content); Fill();
        }
        Children.Add(Pages.Frame(page, 680));
    }
    private void QueueSearch()
    {
        debounce?.Cancel(); debounce?.Dispose(); debounce = new();
        var signal = debounce.Token;
        // Invalidate the active response immediately; it must not replace a newer query.
        visit++; loading = false;
        _ = SearchLater(signal);
    }
    private async Task SearchLater(CancellationToken signal)
    {
        try { await Task.Delay(250, signal); if (active && selected is null) await Load(true); }
        catch (OperationCanceledException) { }
    }
    private async Task Load(bool reset)
    {
        if (!active || loading || Account.Shared.User is null) return;
        var at = ++visit; var requested = query.Trim(); var account = owner;
        loading = true; error = null;
        if (reset) members.Clear();
        Fill();
        try
        {
            var page = await Account.Shared.Members(requested, reset ? 0 : members.Count);
            if (!active || at != visit || owner != account || selected is not null) return;
            foreach (var member in page.Items) if (!members.Any(item => item.Id == member.Id)) members.Add(member);
            total = page.Total;
        }
        catch (Exception failure) when (failure is PlatformFailure or HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        { if (active && at == visit) error = failure is PlatformFailure ? failure.Message : "成员暂时无法加载，请重试。"; }
        finally { if (active && at == visit) { loading = false; Fill(); } }
    }
    private async Task LoadDetail()
    {
        if (!active || selected is null || Account.Shared.User is null) return;
        var at = ++visit; var id = selected; var account = owner;
        loading = true; error = null; detail = null; Fill();
        try
        {
            var member = await Account.Shared.Member(id);
            if (active && at == visit && owner == account && selected == id) detail = member;
        }
        catch (Exception failure) when (failure is PlatformFailure or HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        { if (active && at == visit) error = failure is PlatformFailure ? failure.Message : "资料暂时无法加载，请重试。"; }
        finally { if (active && at == visit) { loading = false; Fill(); } }
    }
    private static AccountAvatar Face(PublicMember member, double size)
    {
        var face = new AccountAvatar(size);
        face.ShowImage(member.AvatarUrl, System.Globalization.StringInfo.GetNextTextElement(member.Nickname.Length > 0 ? member.Nickname : "我"));
        return face;
    }
    private void Fill()
    {
        if (status is null) return;
        status.Text = loading ? selected is null ? "正在读取成员…" : "正在读取资料…" : selected is null ? $"共 {total} 位成员" : "";
        content.Children.Clear();
        if (error is not null)
        {
            content.Children.Add(Kit.Text(error, Role.Label, "danger", wrap: true));
            content.Children.Add(Kit.TextAction("重试", () => { if (selected is null) _ = Load(true); else _ = LoadDetail(); }, Icons.Again));
        }
        if (selected is not null)
        {
            if (detail is { } member)
            {
                var card = Kit.Column(16, Face(member, 88), Kit.Text(member.Nickname, Role.Title, wrap: true), Kit.Text(member.Signature.Length > 0 ? member.Signature : "还没有签名", Role.Body, "muted", wrap: true));
                card.HorizontalAlignment = HorizontalAlignment.Center; card.Margin = new Thickness(0, 24, 0, 24);
                foreach (FrameworkElement child in card.Children) child.HorizontalAlignment = HorizontalAlignment.Center;
                content.Children.Add(card);
            }
            return;
        }
        foreach (var member in members)
        {
            var row = new Grid { ColumnSpacing = 14, Padding = new Thickness(0, 12, 0, 12) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); row.ColumnDefinitions.Add(new ColumnDefinition()); row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.Children.Add(Face(member, 48));
            var name = Kit.Text(member.Nickname, Role.Body, bold: true); name.TextTrimming = TextTrimming.CharacterEllipsis;
            var words = Kit.Column(4, name);
            if (member.Signature.Length > 0) { var signature = Kit.Text(member.Signature, Role.Caption, "muted", wrap: true); signature.MaxLines = 2; signature.TextTrimming = TextTrimming.CharacterEllipsis; words.Children.Add(signature); }
            Grid.SetColumn(words, 1); row.Children.Add(words);
            var chevron = Kit.Icon(Icons.Chevron, 16, "faint"); Grid.SetColumn(chevron, 2); row.Children.Add(chevron);
            var tap = new Tap { Content = row, HorizontalContentAlignment = HorizontalAlignment.Stretch, Padding = new Thickness(0), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 0, 0, 1) };
            AutomationProperties.SetName(tap, member.Nickname); AutomationProperties.SetAutomationId(tap, "member-" + member.Id);
            tap.Click += (_, _) => { selected = member.Id; visit++; loading = false; Draw(); _ = LoadDetail(); };
            content.Children.Add(tap);
        }
        if (members.Count == 0 && !loading && error is null) content.Children.Add(Pages.Empty("没有找到这个昵称"));
        if (members.Count < total && !loading) content.Children.Add(Kit.TextAction("加载更多", () => _ = Load(false)));
    }
}
