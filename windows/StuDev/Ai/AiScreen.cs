// AI, the fourth entry beside the timetable, the map and search: one conversation over the same tools as the other
// three, run on this device. The answer shows as it comes, drawn by docstream; what was looked up shows as steps one
// can open; rooms, places and routes it finds are things to tap; a task it drafts is saved only when confirmed. A
// question can be changed and an answer asked again, each growing a branch beside the old one. Conversations and what
// it keeps in mind are kept on this device. The model is the free quota (signed in) or one's own key. AiApp.tsx.
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using StuDev.Data;
using StuDev.Me;
using StuDev.Ui;
using StuDev.World;
using StuDev.Kernels.Docstream;

namespace StuDev.Ai;

public sealed partial class AiScreen : Screen
{
    private static readonly string[] Examples = ["这周有哪些截止和考试？", "今天下午哪里有空教室？", "帮我在下周找三次一小时复习，周五前完成", "从教三到图书馆怎么走？"];
    private static readonly HttpClient Http = new() { Timeout = Timeout.InfiniteTimeSpan };
    private readonly Campus campus = Campus.Shared;
    private readonly Assistant assistant = Assistant.Load(Path.Combine(AppContext.BaseDirectory, "world"));
    private readonly Grid side = new() { Width = 260 };
    private readonly Grid main = new();
    private StackPanel turns = new() { Spacing = 30 };
    private readonly ScrollViewer scroller = new() { HorizontalScrollMode = ScrollMode.Disabled, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
    private Border live = new();
    private List<SavedChat> chats = [];
    private string? current;
    private ChatThread thread = ChatThread.Empty;
    private List<TaskProposal> proposals = [];
    private readonly Dictionary<string, List<TaskProposal>> keptProposals = new();
    private (bool On, string Text) memory = (true, "");
    private (bool Own, Own Mine) choice = (false, Models.Starting);
    private bool busy;
    private string error = "";
    private string? editing;
    private string? from;
    private HashSet<string> fresh = [];
    private CancellationTokenSource? stop;
    private DocStream? stream;
    private string said = "";
    private bool liveDirty;
    private readonly DispatcherTimer frame = new() { Interval = TimeSpan.FromMilliseconds(40) };
    private readonly HashSet<string> openSteps = [];

    public AiScreen()
    {
        ReadKept();
        ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        ColumnDefinitions.Add(new ColumnDefinition());
        side.Background = Paint.Faded("surfaceSunken", .55);
        side.BorderBrush = Paint.Brush("line"); side.BorderThickness = new Thickness(0, 0, 1, 0);
        Children.Add(side);
        Grid.SetColumn(main, 1); Children.Add(main);
        frame.Tick += (_, _) => { if (liveDirty) { liveDirty = false; DrawLive(); } };
        Paint.Turned += Draw;
        Account.Shared.Changed += () => DispatcherQueue.TryEnqueue(Draw);
        Draw();
    }
    public override void Shown(object? argument) => Draw();

    // ——— what is kept on this device ———
    private void ReadKept()
    {
        if (Storage.Read("ai/chats.json") is { } text)
        {
            var kept = JsonNode.Parse(text)!;
            foreach (var item in kept["chats"]!.AsArray())
            {
                chats.Add(SavedChat.Of(item!.AsObject()));
                keptProposals[(string)item["id"]!] = item["proposals"] is JsonArray list ? list.Deserialize(StorageJson.Default.ListTaskProposal)! : [];
            }
            current = (string?)kept["current"];
            if (chats.FirstOrDefault(c => c.Id == current) is { } open) { thread = open.Thread; proposals = keptProposals.GetValueOrDefault(open.Id) ?? []; } else current = null;
        }
        if (Storage.Read("ai/memory.json") is { } m) { var node = JsonNode.Parse(m)!; memory = ((bool)node["on"]!, (string)node["text"]!); }
        if (Storage.Read("ai/model.json") is { } c)
        {
            var node = JsonNode.Parse(c)!;
            var mine = new Own((string)node["base"]!, (string)node["model"]!, Secure.Read("ai/key.bin") ?? "");
            choice = ((string)node["use"]! == "own" && mine.Key.Length > 0, mine);
        }
    }
    private void WriteChats() => Storage.Write(Storage.PathFor("ai/chats.json"), new JsonObject
    {
        ["chats"] = new JsonArray([.. chats.Select(c => { var o = c.ToJson(); o["proposals"] = JsonSerializer.SerializeToNode(keptProposals.GetValueOrDefault(c.Id) ?? [], StorageJson.Default.ListTaskProposal); return (JsonNode)o; })]),
        ["current"] = current,
    }.ToJsonString());
    private void WriteMemory() => Storage.Write(Storage.PathFor("ai/memory.json"), new JsonObject { ["on"] = memory.On, ["text"] = memory.Text }.ToJsonString());
    private void WriteChoice()
    {
        Storage.Write(Storage.PathFor("ai/model.json"), new JsonObject { ["use"] = choice.Own && choice.Mine.Key.Length > 0 ? "own" : "free", ["base"] = choice.Mine.Base, ["model"] = choice.Mine.Model }.ToJsonString());
        Secure.Write("ai/key.bin", choice.Mine.Key.Length > 0 ? choice.Mine.Key : null);
    }
    /** What is said in a conversation moves it to the top of the list and keeps it. */
    private void Keep()
    {
        if (thread.Nodes.Count == 0) return;
        var id = current ?? Guid.NewGuid().ToString();
        var before = chats.FirstOrDefault(c => c.Id == id);
        chats = [new SavedChat(id, before?.Title ?? "", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), thread), .. chats.Where(c => c.Id != id)];
        keptProposals[id] = proposals; current = id;
        WriteChats();
    }
    private void Open(string? id)
    {
        if (busy) return;
        var found = chats.FirstOrDefault(c => c.Id == id);
        thread = found?.Thread ?? ChatThread.Empty; proposals = found is null ? [] : keptProposals.GetValueOrDefault(found.Id) ?? [];
        current = found?.Id; error = ""; editing = null; openSteps.Clear();
        WriteChats(); Draw();
    }

    private Situation SituationNow()
    {
        var user = Account.Shared.User;
        return new(campus.Line?.WeekOf(CampusDay.Today()), campus.Preferences.Class, campus.Preferences.Campus,
            user is null ? null : user.RealName.Length > 0 ? user.RealName : user.Nickname.Length > 0 ? user.Nickname : null, user?.StudentId is { Length: > 0 } s ? s : null, memory.On ? memory.Text : null);
    }

    // ——— asking ———
    /** At most 24 messages go to the model, whole turns kept: a tool result never stays without its call. */
    private static List<JsonObject> Recent(List<JsonObject> history)
    {
        var all = history;
        while (all.Count > 24) { var next = all.FindIndex(1, m => (string?)m["role"] == "user"); if (next < 0) break; all = all[next..]; }
        return all;
    }

    private void Send(string question, string? parent = null)
    {
        var asked = question.Trim();
        if (asked.Length == 0 || busy) return;
        if (!(choice.Own && choice.Mine.Key.Length > 0) && Account.Shared.User is null) { SignIn(asked); return; }
        parent ??= thread.Tip();
        var id = Guid.NewGuid().ToString();
        App.Watch(Run(thread.Append(parent, id, new JsonObject { ["role"] = "user", ["content"] = asked }), id));
    }

    private async Task Run(ChatThread start, string at)
    {
        thread = start; var tip = at;
        fresh = []; from = at;
        void Grow(JsonObject message) { var id = Guid.NewGuid().ToString(); fresh.Add(id); thread = thread.Append(tip, id, message); tip = id; Keep(); Draw(); }
        var history = Recent(thread.Lineage(at).Select(n => n.Message).ToList());
        busy = true; error = ""; editing = null; Keep(); Draw();
        stop = new CancellationTokenSource(); var cancel = stop.Token;
        var situation = SituationNow();
        using var tools = new CampusTools(campus, assistant.ToolsFor(situation), Remember, proposal => { proposals = [.. proposals, proposal]; });
        frame.Start();
        try
        {
            for (var round = 0; round < Assistant.Rounds; round++)
            {
                var last = round == Assistant.Rounds - 1;
                said = ""; stream = new DocStream(); liveDirty = true;
                JsonObject answer;
                try { answer = choice.Own && choice.Mine.Key.Length > 0 ? await AskOwn(history, situation, last, cancel) : await AskFree(history, situation, last, cancel); }
                finally { stream.Dispose(); stream = null; live.Child = null; }
                history = [.. history, answer]; Grow(answer);
                if (answer["tool_calls"] is not JsonArray calls || calls.Count == 0) return;
                foreach (var item in calls)
                {
                    var call = item!; var function = call["function"]!;
                    JsonNode? result;
                    try { result = await tools.Execute((string)function["name"]!, JsonNode.Parse((string)function["arguments"]!)!.AsObject(), (string)call["id"]!); }
                    // A tool that fails tells the model why, as the web and Android do; the answer goes on.
                    catch (Exception failure) when (failure is ArgumentException or InvalidOperationException or InvalidDataException) { result = new JsonObject { ["error"] = failure.Message }; }
                    catch (Exception failure) when (failure is HttpRequestException or IOException or JsonException or TaskCanceledException) { result = new JsonObject { ["error"] = "校园数据暂不可读，请重试。" }; }
                    var message = new JsonObject { ["role"] = "tool", ["tool_call_id"] = (string)call["id"]!, ["content"] = result?.ToJsonString() ?? "null" };
                    history = [.. history, message]; Grow(message);
                }
            }
        }
        catch (OperationCanceledException) { if (said.Length > 0) Grow(new JsonObject { ["role"] = "assistant", ["content"] = said }); }
        catch (Exception failure) when (failure is InvalidOperationException or HttpRequestException or IOException or PlatformFailure or JsonException)
        { error = failure is HttpRequestException or IOException ? "连不上 AI，检查一下网络。" : failure.Message; }
        finally { frame.Stop(); busy = false; from = null; stop = null; Keep(); Draw(); }
    }

    private void OnDelta(string piece)
    {
        if (piece.Length == 0 || stream is null) return;
        said += piece;
        lastUpdate = stream.Push(piece);
        liveDirty = true;
    }
    private string? lastUpdate;

    private async Task<JsonObject> AskOwn(List<JsonObject> history, Situation situation, bool last, CancellationToken cancel)
    {
        var mine = choice.Mine;
        if (Models.AddressError(mine.Base) is { } wrong) throw new InvalidOperationException(wrong);
        using var request = new HttpRequestMessage(HttpMethod.Post, Models.Endpoint(mine.Base))
        { Content = new StringContent(assistant.Request(mine.Model, history, situation, DateTimeOffset.UtcNow, last).ToJsonString(), Encoding.UTF8, "application/json") };
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", mine.Key);
        HttpResponseMessage response;
        try { response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancel); }
        catch (HttpRequestException) { throw new InvalidOperationException("连不上你填的接口地址，检查一下地址和网络。"); }
        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                var text = await response.Content.ReadAsStringAsync(cancel);
                string? detail = null; try { detail = (string?)JsonNode.Parse(text)?["error"]?["message"]; } catch (JsonException) { }
                throw new InvalidOperationException((int)response.StatusCode switch
                {
                    401 => "API Key 不对，在“我的 API”里改一下。", 402 => "你的 API 余额不足。", 429 => "你的 API 请求太频繁，稍后再试。",
                    404 => "接口或模型不存在" + (detail is not null ? $"：{detail}" : "，检查地址和模型名。"),
                    var status => $"你的 API 没有回答（{status}）" + (detail is not null ? $"：{detail}" : ""),
                });
            }
            var completion = assistant.Read();
            using var reader = new StreamReader(await response.Content.ReadAsStreamAsync(cancel), Encoding.UTF8);
            while (await reader.ReadLineAsync(cancel) is { } line) OnDelta(completion.Take(line));
            return completion.Result();
        }
    }

    private async Task<JsonObject> AskFree(List<JsonObject> history, Situation situation, bool last, CancellationToken cancel)
    {
        JsonObject? answer = null; string? failed = null;
        var body = new JsonObject { ["messages"] = new JsonArray([.. history.Select(m => m.DeepClone())]), ["last"] = last, ["situation"] = situation.ToJson() };
        await Account.Shared.Stream("/ai", body, (kind, data) =>
        {
            switch (kind)
            {
                case "delta": DispatcherQueue.TryEnqueue(() => OnDelta((string?)data["content"] ?? "")); break;
                case "message": answer = data["message"]?.AsObject(); break;
                case "error": failed = (string?)data["message"]; break;
            }
        }, cancel);
        if (failed is not null) throw new InvalidOperationException(failed);
        return answer ?? throw new InvalidOperationException("回答中断了，请重试。");
    }

    private bool Remember(string fact)
    {
        if (!memory.On) throw new ArgumentException("记忆已关闭。");
        memory = (true, Memory.Remembered(memory.Text, fact)); WriteMemory();
        DispatcherQueue.TryEnqueue(DrawSide);
        return true;
    }

    private void Confirm(IEnumerable<string> keys)
    {
        foreach (var key in keys.ToList())
        {
            var proposal = proposals.FirstOrDefault(p => p.Key == key);
            if (proposal is null || proposal.Saved) continue;
            var now = proposal.Id is null ? null : campus.Tasks.All.FirstOrDefault(t => t.Id == proposal.Id && t.Deleted != true);
            if (proposal.Id is not null && now?.Modified != proposal.Expected) { error = "这个任务已经改过了，请让 AI 重新起草。"; continue; }
            campus.Tasks.Put(proposal.Task with { Id = proposal.Id ?? TaskRules.NewId(), Done = proposal.Task.Done == "awaiting-confirmation" ? Preferences.Stamp() : proposal.Task.Done });
            proposals = proposals.Select(p => p.Key == key ? p with { Saved = true } : p).ToList();
        }
        Keep(); Draw();
    }

    // ——— drawing ———
    private void Draw() { DrawSide(); DrawMain(); }

    private static Tap Icon(string label, string path, Action act, double box = 20, bool enabled = true)
    {
        var tap = new Tap(Paint.Clear, Paint.Brush("surfaceSunken")) { Content = Kit.Icon(path, 18, "muted", box), Width = 32, Height = 32, CornerRadius = new CornerRadius(8), IsEnabled = enabled, Opacity = enabled ? 1 : .35 };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(tap, label); ToolTipService.SetToolTip(tap, label);
        tap.Click += (_, _) => act();
        return tap;
    }
    private static Tap Pill(string label, Action act, bool go = false)
    {
        var words = Kit.Text(label, Role.Label, go ? "paper" : "ink"); words.FontSize = 14; words.HorizontalAlignment = HorizontalAlignment.Center; words.VerticalAlignment = VerticalAlignment.Center;
        var tap = new Tap(go ? Paint.Brush("ink") : Paint.Brush("paper"), go ? null : Paint.Brush("surfaceSunken")) { Content = words, Height = 34, Padding = new Thickness(16, 0, 16, 0), CornerRadius = new CornerRadius(17), BorderBrush = go ? Paint.Brush("ink") : Paint.Brush("line"), BorderThickness = new Thickness(1) };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(tap, label);
        tap.Click += (_, _) => act();
        return tap;
    }

    private void DrawSide()
    {
        side.Children.Clear(); side.RowDefinitions.Clear();
        side.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); side.RowDefinitions.Add(new RowDefinition()); side.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        var top = new Tap(Paint.Clear, Paint.Brush("surfaceSunken")) { Content = Kit.Line(8, Kit.Icon(Icons.Compose, 18, "ink", 20), Kit.Text("新对话", Role.Label, bold: true)), Height = 38, Padding = new Thickness(10, 0, 10, 0), CornerRadius = new CornerRadius(10), Margin = new Thickness(10, 12, 10, 4), IsEnabled = !busy };
        ((StackPanel)top.Content).VerticalAlignment = VerticalAlignment.Center;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(top, "新对话");
        top.Click += (_, _) => Open(null);
        side.Children.Add(top);
        var list = new StackPanel { Padding = new Thickness(10, 0, 10, 8) };
        foreach (var (name, group) in Chats.Groups(chats, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()))
        {
            var h = Kit.Text(name, Role.Caption, "faint"); h.Margin = new Thickness(10, 14, 0, 4); list.Children.Add(h);
            foreach (var chat in group)
            {
                var on = chat.Id == current;
                var title = Kit.Text(Chats.TitleOf(chat.Title, chat.Thread), Role.Label); title.FontSize = 14; title.VerticalAlignment = VerticalAlignment.Center;
                var row = new Tap(on ? Paint.Faded("ink", .08) : Paint.Clear, on ? null : Paint.Brush("surfaceSunken")) { Content = title, Height = 36, Padding = new Thickness(10, 0, 10, 0), CornerRadius = new CornerRadius(10) };
                Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(row, Chats.TitleOf(chat.Title, chat.Thread));
                var id = chat.Id; row.Click += (_, _) => Open(id);
                var menu = new MenuFlyout();
                var rename = new MenuFlyoutItem { Text = "重命名" }; rename.Click += (_, _) => Rename(id); menu.Items.Add(rename);
                var remove = new MenuFlyoutItem { Text = "删除", Foreground = Paint.Brush("danger") }; remove.Click += (_, _) => Remove(id); menu.Items.Add(remove);
                row.ContextFlyout = menu;
                list.Children.Add(row);
            }
        }
        if (chats.Count == 0) { var none = Kit.Text("问过的对话会列在这里，只存在这台设备上。", Role.Label, "faint", wrap: true); none.Margin = new Thickness(10, 14, 10, 0); list.Children.Add(none); }
        var scroll = new ScrollViewer { Content = list, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        Grid.SetRow(scroll, 1); side.Children.Add(scroll);
        var count = memory.Text.Split('\n').Count(l => l.Trim().Length > 0);
        var mind = new Grid { Padding = new Thickness(12) };
        mind.ColumnDefinitions.Add(new ColumnDefinition()); mind.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        mind.Children.Add(Kit.Text("记忆", Role.Body, bold: true));
        var state = Kit.Text(!memory.On ? "已关闭" : count > 0 ? $"记着 {count} 件事" : "还没有", Role.Caption, "muted"); state.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(state, 1); mind.Children.Add(state);
        var mindTap = new Tap(Paint.Clear, Paint.Brush("surfaceSunken")) { Content = mind, BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 1, 0, 0) };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(mindTap, "记忆");
        mindTap.Click += (_, _) => MemorySheet();
        Grid.SetRow(mindTap, 2); side.Children.Add(mindTap);
    }

    private void Rename(string id)
    {
        var chat = chats.First(c => c.Id == id);
        var box = Kit.Field(Chats.TitleOf(chat.Title, chat.Thread), "对话名称", "对话名称");
        void Save() { chats = chats.Select(c => c.Id == id ? c with { Title = box.Text.Trim()[..Math.Min(60, box.Text.Trim().Length)] } : c).ToList(); WriteChats(); App.Window?.Close(); DrawSide(); }
        box.KeyDown += (_, e) => { if (e.Key == Windows.System.VirtualKey.Enter) Save(); };
        var column = Kit.Column(14, Pages.SheetHead(Pages.SheetTitle("重命名"), () => App.Window?.Close()), box, Kit.Line(8, Pill("取消", () => App.Window?.Close()), Pill("保存", Save, true)));
        ((StackPanel)column.Children[2]).HorizontalAlignment = HorizontalAlignment.Right;
        column.Padding = new Thickness(22, 20, 22, 18);
        App.Window?.Sheet(column, 420);
    }
    private void Remove(string id)
    {
        chats = chats.Where(c => c.Id != id).ToList(); keptProposals.Remove(id);
        if (current == id) { current = null; thread = ChatThread.Empty; proposals = []; }
        WriteChats(); Draw();
    }

    private void DrawMain()
    {
        main.Children.Clear(); main.RowDefinitions.Clear();
        main.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); main.RowDefinitions.Add(new RowDefinition()); main.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        var own = choice.Own && choice.Mine.Key.Length > 0;
        var blank = thread.Path().Count == 0;
        // The bar: which model answers, and the conversation's name.
        var bar = new Grid { Padding = new Thickness(14, 8, 14, 0), ColumnSpacing = 6, MinHeight = 48 };
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); bar.ColumnDefinitions.Add(new ColumnDefinition());
        var model = new Tap(Paint.Clear, Paint.Brush("surfaceSunken")) { Content = Kit.Line(4, Kit.Text(own ? Models.Name(choice.Mine) : "免费额度", Role.Body, bold: true), Kit.Icon(Icons.Chevron, 14, "muted")), Height = 34, Padding = new Thickness(10, 0, 10, 0), CornerRadius = new CornerRadius(10) };
        ((StackPanel)model.Content).VerticalAlignment = VerticalAlignment.Center;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(model, "选择模型");
        var pick = new MenuFlyout();
        var free = new ToggleMenuFlyoutItem { Text = "免费额度 · 为爱发电", IsChecked = !own }; ToolTipService.SetToolTip(free, "登录后可用");
        free.Click += (_, _) => { choice = (false, choice.Mine); WriteChoice(); Draw(); };
        var mine = new ToggleMenuFlyoutItem { Text = choice.Mine.Key.Length > 0 ? $"我的 API · {Models.Name(choice.Mine)}" : "我的 API · 填上自己的 Key 就能用", IsChecked = own };
        mine.Click += (_, _) => { if (choice.Mine.Key.Length > 0) { choice = (true, choice.Mine); WriteChoice(); Draw(); } else OwnSheet(); };
        var set = new MenuFlyoutItem { Text = "设置我的 API…" }; set.Click += (_, _) => OwnSheet();
        pick.Items.Add(free); pick.Items.Add(mine); pick.Items.Add(new MenuFlyoutSeparator()); pick.Items.Add(set);
        model.Click += (_, _) => pick.ShowAt(model, new FlyoutShowOptions { Placement = FlyoutPlacementMode.BottomEdgeAlignedLeft });
        bar.Children.Add(model);
        if (!blank) { var title = Kit.Text(Chats.TitleOf(chats.FirstOrDefault(c => c.Id == current)?.Title ?? "", thread), Role.Body, "ink"); title.FontWeight = FontWeights.Medium; title.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(title, 1); bar.Children.Add(title); }
        main.Children.Add(bar);

        var column = new StackPanel { Padding = new Thickness(18, 12, 18, 28) };
        var composer = Composer();
        if (blank)
        {
            var hello = new StackPanel { Spacing = 16, Padding = new Thickness(18, 0, 18, 80) };
            var h = Kit.Text("有什么可以帮你？", Role.Title); h.FontSize = 28; h.HorizontalAlignment = HorizontalAlignment.Center; h.Margin = new Thickness(0, 0, 0, 6);
            hello.Children.Add(h); hello.Children.Add(composer);
            var examples = new WrapRow { Gap = 8, HorizontalAlignment = HorizontalAlignment.Center };
            foreach (var example in Examples)
            {
                var words = Kit.Text(example, Role.Label, "muted"); words.FontSize = 13.5;
                var tap = new Tap(Paint.Brush("paper"), Paint.Brush("surfaceSunken")) { Content = words, Padding = new Thickness(14, 8, 14, 9), CornerRadius = new CornerRadius(18), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(1) };
                Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(tap, example);
                var asked = example; tap.Click += (_, _) => Send(asked);
                examples.Children.Add(tap);
            }
            hello.Children.Add(examples);
            if (campus.Preferences.Class is null) hello.Children.Add(Fine("先在“我”里选好班级，AI 才能看到你的课表；搜索和空教室现在就能问。"));
            hello.Children.Add(Fine("可以问课表、地图和校园资料：查安排、找空闲、找空教室、问路、读通知。起草的任务你点一下才加进清单；对话和记忆存在这台设备上。"));
            if (error.Length > 0) hello.Children.Add(Kit.Text(error, Role.Body, "danger", wrap: true));
            var centred = Pages.Centre(hello, 768); centred.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetRow(centred, 1); main.Children.Add(centred);
            return;
        }
        turns = new StackPanel { Spacing = 30 };
        DrawTurns();
        column.Children.Add(turns);
        if (error.Length > 0)
        {
            var row = Kit.Line(10, Kit.Text(error, Role.Body, "danger", wrap: true));
            ((TextBlock)row.Children[0]).MaxWidth = 600;
            var lastQuestion = thread.Path().LastOrDefault(n => (string?)n.Message["role"] == "user");
            if (lastQuestion is not null) row.Children.Add(Pill("重试", () => { if (!busy) App.Watch(Run(thread, lastQuestion.Id)); }));
            row.Margin = new Thickness(0, 14, 0, 0);
            column.Children.Add(row);
        }
        scroller.Content = Pages.Centre(column, 768);
        Grid.SetRow(scroller, 1);
        main.Children.Add(scroller);
        var dock = Pages.Centre(composer, 768); dock.Padding = new Thickness(14, 6, 14, 14);
        Grid.SetRow(dock, 2); main.Children.Add(dock);
        DispatcherQueue.TryEnqueue(() => scroller.ChangeView(null, scroller.ScrollableHeight, null, true));
    }

    private static TextBlock Fine(string text) { var t = Kit.Text(text, Role.Label, "muted", wrap: true); t.HorizontalAlignment = HorizontalAlignment.Center; t.TextAlignment = TextAlignment.Center; return t; }

    private FrameworkElement Composer()
    {
        var box = new TextBox { PlaceholderText = "问点什么", AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MaxLength = 4000, MaxHeight = 200, FontSize = 16, BorderThickness = new Thickness(0), Background = Paint.Clear, Padding = new Thickness(0, 7, 0, 7), VerticalAlignment = VerticalAlignment.Center };
        box.Resources["TextControlBackgroundFocused"] = Paint.Clear; box.Resources["TextControlBackgroundPointerOver"] = Paint.Clear; box.Resources["TextControlBorderBrushFocused"] = Paint.Clear;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(box, "问点什么");
        var send = new Tap(Paint.Brush("ink")) { Width = 36, Height = 36, CornerRadius = new CornerRadius(18), VerticalAlignment = VerticalAlignment.Bottom, Content = Kit.Icon(busy ? Icons.Square : Icons.Up, 20, "paper", 20, 2) };
        ((FrameworkElement)send.Content).HorizontalAlignment = HorizontalAlignment.Center; ((FrameworkElement)send.Content).VerticalAlignment = VerticalAlignment.Center;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(send, busy ? "停止" : "发送");
        void Go() { if (busy) { stop?.Cancel(); return; } var text = box.Text; box.Text = ""; Send(text); }
        send.Click += (_, _) => Go();
        void Shade() { send.Opacity = busy || box.Text.Trim().Length > 0 ? 1 : .18; }
        box.TextChanged += (_, _) => Shade(); Shade();
        box.PreviewKeyDown += (_, e) =>
        {
            var shift = Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(Windows.System.VirtualKey.Shift).HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down);
            if (e.Key == Windows.System.VirtualKey.Enter && !shift) { e.Handled = true; Go(); }
        };
        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition()); grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.Children.Add(box); Grid.SetColumn(send, 1); grid.Children.Add(send);
        var shell = new Border { Child = grid, Padding = new Thickness(20, 9, 9, 9), CornerRadius = new CornerRadius(28), Background = Paint.Brush("paper"), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(1), Translation = new System.Numerics.Vector3(0, 0, 8) };
        shell.Shadow = new ThemeShadow();
        box.Loaded += (_, _) => { if (!busy) box.Focus(FocusState.Programmatic); };
        return shell;
    }

    private void DrawTurns()
    {
        live = new Border();
        turns.Children.Clear();
        var shown = thread.Path();
        var cut = from is null ? -1 : shown.FindIndex(n => n.Id == from);
        if (cut >= 0 && cut + 1 < shown.Count && !fresh.Contains(shown[cut + 1].Id)) shown = shown.Take(cut + 1).ToList();
        var results = shown.Where(n => (string?)n.Message["role"] == "tool").ToDictionary(n => (string)n.Message["tool_call_id"]!, n => { try { return JsonNode.Parse((string)n.Message["content"]!); } catch (JsonException) { return null; } });
        var groups = new List<(ChatNode Question, List<ChatNode> Replies)>();
        foreach (var node in shown) { if ((string?)node.Message["role"] == "user") groups.Add((node, [])); else if (groups.Count > 0) groups[^1].Replies.Add(node); }
        for (var g = 0; g < groups.Count; g++)
        {
            var (question, replies) = groups[g];
            var last = g == groups.Count - 1;
            var turn = new StackPanel { Spacing = 12 };
            var messages = replies.Select(r => r.Message).ToList();
            var calls = messages.SelectMany(m => m["tool_calls"]?.AsArray().Select(c => c!) ?? []).ToList();
            var answer = messages.LastOrDefault(m => (string?)m["role"] == "assistant" && m["content"] is JsonValue v && v.TryGetValue<string>(out var s) && s.Length > 0 && m["tool_calls"] is null)?["content"]?.GetValue<string>();
            var steps = Steps.Of(calls.Select(c => new Call((string)c["id"]!, (string)c["function"]!["name"]!, (string)c["function"]!["arguments"]!)).ToList(), results);
            var text = (string?)question.Message["content"] ?? "";
            var answering = last && busy;
            // The question, on the right.
            if (editing == question.Id) turn.Children.Add(Editing(text, question.Parent));
            else
            {
                var ask = new StackPanel { HorizontalAlignment = HorizontalAlignment.Right, Spacing = 4 };
                var bubble = new Border { CornerRadius = new CornerRadius(22), Padding = new Thickness(16, 10, 16, 10), Background = Paint.Faded("brand", .1), HorizontalAlignment = HorizontalAlignment.Right, MaxWidth = 560,
                    Child = new TextBlock { Text = text, FontSize = 16, LineHeight = 26, TextWrapping = TextWrapping.Wrap, Foreground = Paint.Brush("ink"), IsTextSelectionEnabled = true } };
                ask.Children.Add(bubble);
                var tools = Kit.Line(2, Icon("复制", Icons.Copy, () => Copy(text)), Icon("改问题", Icons.Pencil, () => { editing = question.Id; DrawMain(); }, enabled: !busy));
                tools.Children.Insert(0, Branches(question.Id)); tools.HorizontalAlignment = HorizontalAlignment.Right; tools.Opacity = 0;
                ask.PointerEntered += (_, _) => tools.Opacity = 1; ask.PointerExited += (_, _) => tools.Opacity = 0;
                ask.Children.Add(tools);
                turn.Children.Add(ask);
            }
            if (steps.Count > 0)
            {
                var open = openSteps.Contains(question.Id);
                var summary = Kit.Line(6, Kit.Text(Steps.Line(steps), Role.Label, steps.Any(s => s.Pending) ? "ink" : "muted"), Kit.Icon(Icons.Chevron, 12, "muted"));
                ((FrameworkElement)summary.Children[1]).RenderTransformOrigin = new Windows.Foundation.Point(.5, .5);
                ((FrameworkElement)summary.Children[1]).RenderTransform = new RotateTransform { Angle = open ? 90 : 0 };
                var head = new Tap { Content = summary, HorizontalAlignment = HorizontalAlignment.Left };
                var id = question.Id; head.Click += (_, _) => { if (!openSteps.Remove(id)) openSteps.Add(id); DrawTurns(); };
                turn.Children.Add(head);
                if (open)
                {
                    var list = new StackPanel { Spacing = 4, Padding = new Thickness(14, 0, 0, 0), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(2, 0, 0, 0) };
                    foreach (var step in steps)
                    {
                        var line = new TextBlock { TextWrapping = TextWrapping.Wrap, FontSize = 13.5, Foreground = Paint.Brush(step.Failed ? "danger" : "muted") };
                        line.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = step.Label, FontWeight = FontWeights.SemiBold, Foreground = Paint.Brush(step.Failed ? "danger" : "ink") });
                        if (step.Detail.Length > 0) line.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = "  " + step.Detail });
                        list.Children.Add(line);
                    }
                    turn.Children.Add(list);
                }
            }
            if (answer is not null) turn.Children.Add(Doc.Make(Doc.Read(answer), link: Link));
            if (last && busy) { turn.Children.Add(live); DrawLive(); }
            if (answering && stream is null && !steps.Any(s => s.Pending) && answer is null) turn.Children.Add(Kit.Text("正在想", Role.Body, "muted"));
            // What it found, to tap: every article it read, the last of anything else.
            var found = new Dictionary<string, (string Name, JsonNode Result)>();
            foreach (var call in calls)
                if (results.GetValueOrDefault((string)call["id"]!) is { } result && !(result is JsonObject o && o.ContainsKey("error")))
                    found[(string)call["function"]!["name"]! == "read" ? (string)call["id"]! : (string)call["function"]!["name"]!] = ((string)call["function"]!["name"]!, result);
            foreach (var (name, result) in found.Values) if (Found(name, result) is { } cards) turn.Children.Add(cards);
            var drafts = proposals.Where(p => calls.Any(c => (string)c["id"]! == p.Call)).ToList();
            if (drafts.Count > 0) turn.Children.Add(Drafts(drafts));
            if (!answering && replies.Count > 0)
            {
                var tools = Kit.Line(2);
                if (answer is not null) tools.Children.Add(Icon("复制", Icons.Copy, () => Copy(answer)));
                tools.Children.Add(Icon("重新回答", Icons.Again, () => { if (!busy) App.Watch(Run(thread, question.Id)); }, enabled: !busy));
                tools.Children.Add(Branches(replies[0].Id));
                turn.Children.Add(tools);
            }
            turns.Children.Add(turn);
        }
    }

    private void DrawLive()
    {
        if (stream is null || lastUpdate is null) { live.Child = null; return; }
        live.Child = Doc.Make(Doc.BlocksOf(lastUpdate), true, Link);
        scroller.ChangeView(null, scroller.ScrollableHeight, null, true);
    }

    private FrameworkElement Branches(string id)
    {
        var at = thread.SiblingsOf(id);
        if (at.Count < 2) return new Border();
        var row = Kit.Line(0, Icon("上一个版本", Icons.Back, () => { if (at.Previous is { } p) { thread = thread.Choose(p); Keep(); Draw(); } }, 16, !busy && at.Previous is not null),
            Kit.Text($"{at.Index + 1}/{at.Count}", Role.Caption, "muted"), Icon("下一个版本", Icons.Chevron, () => { if (at.Next is { } n) { thread = thread.Choose(n); Keep(); Draw(); } }, 16, !busy && at.Next is not null));
        ((FrameworkElement)row.Children[1]).VerticalAlignment = VerticalAlignment.Center;
        return row;
    }

    private FrameworkElement Editing(string text, string parent)
    {
        var box = new TextBox { Text = text, AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, FontSize = 16, BorderThickness = new Thickness(0), Background = Paint.Clear };
        box.Resources["TextControlBackgroundFocused"] = Paint.Clear; box.Resources["TextControlBorderBrushFocused"] = Paint.Clear;
        void Go() { if (box.Text.Trim().Length > 0) { editing = null; Send(box.Text, parent); } }
        box.KeyDown += (_, e) => { if (e.Key == Windows.System.VirtualKey.Escape) { editing = null; DrawMain(); } };
        box.Loaded += (_, _) => { box.Focus(FocusState.Programmatic); box.SelectionStart = box.Text.Length; };
        var buttons = Kit.Line(8, Pill("取消", () => { editing = null; DrawMain(); }), Pill("发送", Go, true)); buttons.HorizontalAlignment = HorizontalAlignment.Right;
        return new Border { Margin = new Thickness(80, 0, 0, 0), Padding = new Thickness(14, 12, 14, 12), CornerRadius = new CornerRadius(22), Background = Paint.Brush("surfaceSunken"), Child = Kit.Column(8, box, buttons) };
    }

    private static void Copy(string text)
    {
        var data = new Windows.ApplicationModel.DataTransfer.DataPackage(); data.SetText(text);
        Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(data);
    }

    /** A link inside the site, opened in its entry here. */
    private static void Link(string href)
    {
        var query = href.Contains('?') ? System.Web.HttpUtility.ParseQueryString(href[(href.IndexOf('?') + 1)..]) : null;
        if (href.StartsWith("/map/")) { if (query?["nav"] is { } nav) App.Open("map", ("nav", nav)); else if (query?["place"] is { } place) App.Open("map", ("place", place)); else App.Open("map"); }
        else if (href.StartsWith("/search/")) App.Open("search", ("query", query?["q"] ?? ""));
        else if (href == "/" || href.StartsWith("/?")) App.Open("timetable");
        else _ = Windows.System.Launcher.LaunchUriAsync(new Uri(Repository.Site + href));
    }

    /** What a tool found, as things to tap: rooms and places on the map, a route to follow, an article to read. */
    private static FrameworkElement? Found(string name, JsonNode result)
    {
        var cards = new WrapRow { Gap = 8 };
        void Card(string title, string small, Action open)
        {
            var body = Kit.Column(2, Kit.Text(title, Role.Body, bold: true), Kit.Text(small, Role.Caption, "muted"));
            ((TextBlock)body.Children[0]).FontSize = 14.5; ((TextBlock)body.Children[0]).MaxWidth = 280;
            var tap = new Tap(Paint.Brush("paper"), Paint.Brush("surfaceSunken")) { Content = body, Padding = new Thickness(12, 10, 12, 10), MinWidth = 132, CornerRadius = new CornerRadius(12), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(1) };
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(tap, title);
            tap.Click += (_, _) => open();
            cards.Children.Add(tap);
        }
        switch (name)
        {
            case "free_rooms" when result["rooms"] is JsonArray rooms:
                foreach (var r in rooms.Take(6)) { var id = (string)r!["room"]!; var minutes = (int)r["minutes"]!; Card(Names.Room(id), $"空到 {Clock.Hm((int)r["until"]!)} · {minutes / 60} 小时 {minutes % 60} 分", () => App.Open("map", ("place", id))); }
                break;
            case "route" when result["url"] is not null:
                Card($"导航到{(string)result["to"]!}", $"{(long)result["distance_m"]!} 米 · 约 {Math.Max(1, (int)Math.Round((long)result["duration_s"]! / 60.0))} 分钟", () => Link((string)result["url"]!));
                break;
            case "read" when result["url"] is not null:
                Card((string)result["title"]!, string.Join(" · ", new[] { (string?)result["source"], (string?)result["date"] }.Where(s => !string.IsNullOrEmpty(s))), () => _ = Windows.System.Launcher.LaunchUriAsync(new Uri((string)result["url"]!)));
                break;
            case "nearby" when result["places"] is JsonArray places:
                foreach (var p in places.Take(4)) { var id = (string)p!["id"]!; Card((string)p["name"]!, string.Join(" · ", new[] { $"{(long)p["metres"]!} 米", (string?)p["now"] }.Where(s => !string.IsNullOrEmpty(s))), () => App.Open("map", ("place", id))); }
                break;
            case "find_place" when result is JsonArray found:
                foreach (var p in found.Take(3)) { var id = (string)p!["id"]!; Card((string)p["name"]!, string.Join(" · ", new[] { (string?)p["where"], (string?)p["now"] }.Where(s => !string.IsNullOrEmpty(s))), () => App.Open("map", ("place", id))); }
                break;
            default: return null;
        }
        return cards.Children.Count > 0 ? cards : null;
    }

    /** The tasks one turn drafted, in one card: each to tick, then added together. */
    private FrameworkElement Drafts(List<TaskProposal> drafts)
    {
        var open = drafts.Where(d => !d.Saved).ToList();
        var picked = open.Select(d => d.Key).ToHashSet();
        var today = CampusDay.Today();
        var column = new StackPanel();
        var h = Kit.Text(open.Count > 0 ? $"起草了 {drafts.Count} 个任务" : $"已加到清单 · {drafts.Count} 个任务", Role.Label, "muted", bold: true); h.Margin = new Thickness(0, 0, 0, 6);
        column.Children.Add(h);
        Tap? add = null;
        void Count() { if (add is not null) { ((TextBlock)add.Content).Text = picked.Count == open.Count ? "全部加到清单" : $"加 {picked.Count} 个到清单"; add.IsEnabled = picked.Count > 0; add.Opacity = picked.Count > 0 ? 1 : .5; } }
        for (var i = 0; i < drafts.Count; i++)
        {
            var d = drafts[i]; var t = d.Task;
            var row = new Grid { ColumnSpacing = 12, MinHeight = 48, BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, i == 0 ? 0 : 1, 0, 0) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); row.ColumnDefinitions.Add(new ColumnDefinition()); row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            if (d.Saved) row.Children.Add(Kit.Check(true, 0, () => { }));
            else
            {
                var key = d.Key; var on = true; Tap? check = null;
                check = Kit.Check(false, 0, () => { });
                void Turn() { on = !on; if (on) picked.Add(key); else picked.Remove(key); var fresh = Kit.Check(on, 0, Turn); Grid.SetColumn(fresh, 0); row.Children.Remove(check); row.Children.Insert(0, fresh); check = fresh; Count(); }
                check = Kit.Check(true, 0, Turn);
                row.Children.Add(check);
            }
            var when = string.Join(" · ", new[] { t.Date is { } date ? $"{Clock.DayWord(date, today)} {Clock.Hm(t.Start!.Value)}{(t.End is { } e ? $"–{Clock.Hm(e)}" : "")}" : null, t.Due is { } due ? $"{Clock.DayWord(due.Date, today)}{(due.Time is { } dt ? $" {Clock.Hm(dt)}" : "")} 截止" : null }.Where(s => s is not null));
            var main = Kit.Column(1, Kit.Text($"{(d.Id is not null ? "改成 · " : "")}{t.Title}", Role.Body, d.Saved ? "muted" : "ink"), Kit.Text(when, Role.Caption, "muted"));
            main.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(main, 1); row.Children.Add(main);
            if (!d.Saved)
            {
                var drop = new Tap(Paint.Clear, Paint.Brush("surfaceSunken")) { Content = Kit.Icon(Icons.Cross, 12, "faint"), Width = 28, Height = 28, CornerRadius = new CornerRadius(6) };
                Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(drop, "不要这个");
                var key = d.Key; drop.Click += (_, _) => { proposals = proposals.Where(p => p.Key != key).ToList(); Keep(); DrawTurns(); };
                Grid.SetColumn(drop, 2); row.Children.Add(drop);
            }
            column.Children.Add(row);
        }
        if (open.Count > 0)
        {
            add = Kit.Action("全部加到清单", () => Confirm(picked), go: true); add.HorizontalAlignment = HorizontalAlignment.Stretch; add.Margin = new Thickness(0, 10, 0, 0);
            column.Children.Add(add);
        }
        return new Border { BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(16), Padding = new Thickness(14, 12, 14, 12), Background = Paint.Brush("paper"), Child = column };
    }

    // ——— settings ———
    private void MemorySheet()
    {
        var on = memory.On;
        var text = new TextBox { Text = System.Text.RegularExpressions.Regex.Replace(memory.Text, "^- ", "", System.Text.RegularExpressions.RegexOptions.Multiline), AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 140, MaxLength = Memory.Limit,
            FontSize = 14.5, PlaceholderText = "一行一件，比如：\n通信工程专业，在准备考研\n喜欢早上学习", BorderThickness = new Thickness(0), Background = Paint.Clear, Padding = new Thickness(14, 12, 14, 4) };
        text.Resources["TextControlBackgroundFocused"] = Paint.Clear; text.Resources["TextControlBorderBrushFocused"] = Paint.Clear; text.Resources["TextControlBackgroundPointerOver"] = Paint.Clear;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(text, "记忆");
        var column = new StackPanel { Spacing = 14, Padding = new Thickness(22, 20, 22, 18) };
        var body = new StackPanel();
        void Fill()
        {
            body.Children.Clear();
            if (on)
            {
                var count = text.Text.Split('\n').Count(l => l.Trim().Length > 0);
                var foot = Kit.Text(count > 0 ? $"记着 {count} 件事" : "聊天时说“记住……”，AI 也会写进来", Role.Caption, "muted"); foot.Margin = new Thickness(14, 2, 14, 10);
                body.Children.Add(new Border { CornerRadius = new CornerRadius(12), Background = Paint.Brush("surfaceSunken"), Child = Kit.Column(0, text, foot) });
            }
            else
            {
                var count = memory.Text.Split('\n').Count(l => l.Trim().Length > 0);
                body.Children.Add(new Border { CornerRadius = new CornerRadius(12), Background = Paint.Brush("surfaceSunken"), Padding = new Thickness(16), Child = Kit.Text($"记忆已关闭，AI 看不到这些内容，也不再记新的。{(count > 0 ? $"记着的 {count} 件事还在，打开就接着用。" : "")}", Role.Label, "muted", wrap: true) });
            }
        }
        var head = new Grid { ColumnSpacing = 16 };
        head.ColumnDefinitions.Add(new ColumnDefinition()); head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        head.Children.Add(Kit.Column(4, Pages.SheetTitle("记忆"), Kit.Text("AI 记下你的专业、习惯和偏好，回答会越来越贴合你。", Role.Label, "muted", wrap: true)));
        var switchHost = new Border(); Grid.SetColumn(switchHost, 1); head.Children.Add(switchHost);
        void Switch() { switchHost.Child = Kit.Switch(on, next => { on = next; Switch(); Fill(); }, "使用记忆"); }
        Switch();
        column.Children.Add(head); column.Children.Add(body); Fill();
        text.TextChanged += (_, _) => { if (body.Children.FirstOrDefault() is Border b && b.Child is StackPanel s && s.Children[1] is TextBlock foot) { var n = text.Text.Split('\n').Count(l => l.Trim().Length > 0); foot.Text = n > 0 ? $"记着 {n} 件事" : "聊天时说“记住……”，AI 也会写进来"; } };
        column.Children.Add(Kit.Text("只存在这台设备上，提问时随问题一起发给模型。", Role.Caption, "muted"));
        var buttons = new Grid { ColumnSpacing = 8 };
        buttons.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); buttons.ColumnDefinitions.Add(new ColumnDefinition()); buttons.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); buttons.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var clear = new Tap { Content = Kit.Text("全部清空", Role.Label, "muted"), VerticalAlignment = VerticalAlignment.Center }; clear.Click += (_, _) => text.Text = "";
        buttons.Children.Add(clear);
        var cancel = Pill("取消", () => App.Window?.Close()); Grid.SetColumn(cancel, 2); buttons.Children.Add(cancel);
        var save = Pill("保存", () =>
        {
            var kept = string.Join("\n", text.Text.Split('\n').Select(l => l.Trim()).Where(l => l.Length > 0).Select(l => $"- {l}"));
            memory = (on, on ? kept : memory.Text); WriteMemory(); App.Window?.Close(); DrawSide();
        }, true);
        Grid.SetColumn(save, 3); buttons.Children.Add(save);
        column.Children.Add(buttons);
        App.Window?.Sheet(column, 460);
    }

    private void OwnSheet()
    {
        var mine = choice.Mine;
        var address = Kit.Field(mine.Base, "https://api.deepseek.com", "接口地址");
        var model = Kit.Field(mine.Model, "deepseek-flash", "模型");
        var key = new PasswordBox { Password = mine.Key, PlaceholderText = "sk-…", MinHeight = 40, FontSize = 14.5 };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(key, "API Key");
        var hint = Kit.Text("", Role.Caption, "muted", wrap: true);
        Tap? save = null;
        void Check()
        {
            var wrong = Models.AddressError(address.Text);
            hint.Text = wrong ?? $"会请求 {Models.Endpoint(address.Text)}"; hint.Foreground = Paint.Brush(wrong is null ? "muted" : "danger");
            if (save is not null) { var ok = wrong is null && key.Password.Trim().Length > 0 && model.Text.Trim().Length > 0; save.IsEnabled = ok; save.Opacity = ok ? 1 : .5; }
        }
        TextBlock Label(string t) { var l = Kit.Text(t, Role.Label, "muted"); l.Margin = new Thickness(0, 4, 0, -6); return l; }
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(22, 20, 22, 18) };
        column.Children.Add(Pages.SheetHead(Pages.SheetTitle("我的 API"), () => App.Window?.Close()));
        column.Children.Add(Kit.Text("填一个兼容 OpenAI 接口的模型服务，比如 DeepSeek。Key 存在这台设备上，提问从这里直接发给服务商。", Role.Label, "muted", wrap: true));
        column.Children.Add(Label("接口地址")); column.Children.Add(address); column.Children.Add(hint);
        column.Children.Add(Label("模型")); column.Children.Add(model);
        column.Children.Add(Label("API Key")); column.Children.Add(key);
        var buttons = new Grid { ColumnSpacing = 8, Margin = new Thickness(0, 6, 0, 0) };
        buttons.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); buttons.ColumnDefinitions.Add(new ColumnDefinition()); buttons.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); buttons.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        if (mine.Key.Length > 0) buttons.Children.Add(Pill("清除 Key", () => { choice = (false, mine with { Key = "" }); WriteChoice(); App.Window?.Close(); Draw(); }));
        var cancel = Pill("取消", () => App.Window?.Close()); Grid.SetColumn(cancel, 2); buttons.Children.Add(cancel);
        save = Pill("保存并使用", () => { choice = (true, new Own(address.Text.Trim(), model.Text.Trim(), key.Password.Trim())); WriteChoice(); App.Window?.Close(); Draw(); }, true);
        Grid.SetColumn(save, 3); buttons.Children.Add(save);
        column.Children.Add(buttons);
        address.TextChanged += (_, _) => Check(); model.TextChanged += (_, _) => Check(); key.PasswordChanged += (_, _) => Check();
        Check();
        App.Window?.Sheet(column, 460);
    }

    /** Signing in for the free quota; the question waits and is asked once signed in. */
    private void SignIn(string question) => Me.SignIn.Show(() => Send(question));
}
