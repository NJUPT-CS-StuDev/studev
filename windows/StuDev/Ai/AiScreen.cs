// AI, the fourth entry beside the timetable, the map and search: one conversation over the same tools as the other
// three, run on this device. The answer shows as it comes, drawn by docstream; what was looked up shows as steps one
// can open; rooms, places and routes it finds are things to tap; a task it drafts is saved only when confirmed. A
// question can be changed and an answer asked again, each growing a branch beside the old one. Conversations and what
// it keeps in mind are kept on this device. Each conversation chooses a model service and model. AiApp.tsx.
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Media;
using StuDev.Data;
using StuDev.Me;
using StuDev.Ui;
using StuDev.World;
using StuDev.Kernels.Docstream;

namespace StuDev.Ai;

public sealed partial class AiScreen : Screen
{
    private static readonly string[] Examples = ["这周有哪些截止和考试？", "今天下午哪里有空教室？", "计网里 TCP 拥塞控制有哪些真题考过？", "按培养方案看大二有哪些核心课？"];
    private static readonly HttpClient Http = new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = Timeout.InfiniteTimeSpan };
    private readonly Campus campus = Campus.Shared;
    private readonly ModelProviders providers = ModelProviders.Shared;
    private readonly Assistant assistant = Assistant.Load(Path.Combine(AppContext.BaseDirectory, "world"));
    private readonly Grid side = new() { Width = 260 };
    private readonly Grid main = new();
    private StackPanel turns = new() { Spacing = 30 };
    private readonly ScrollViewer scroller = new() { HorizontalScrollMode = ScrollMode.Disabled, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
    private Border live = new();
    private List<SavedChat> chats = [];
    private string? current;
    private JsonObject? runtimeRequest;
    private string? runtimeFirstAssistant;
    private ChatThread thread = ChatThread.Empty;
    private List<TaskProposal> proposals = [];
    private readonly Dictionary<string, List<TaskProposal>> keptProposals = new();
    /** What the AI keeps in mind, one of the parts of oneself (preferences "memory"), so it goes with one to one's other devices. */
    private (bool On, string Text) memory
    {
        get => Campus.Shared.Preferences.Part("memory") is JsonObject kept ? ((bool)kept["on"]!, (string)kept["text"]!) : (true, "");
        set => Campus.Shared.Preferences.Change("memory", new JsonObject { ["on"] = value.On, ["text"] = value.Text });
    }
    private ModelChoice choice = ModelChoice.Free;
    private bool startsRuntime;
    private bool busy;
    private string error = "";
    private string? editing;
    private string? from;
    private HashSet<string> fresh = [];
    private CancellationTokenSource? stop;
    private DocStream? stream;
    private string said = "";
    private string? runtimeStage;
    private string draft = "";
    private bool compact, conversationsOpen;
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
        SizeChanged += (_, change) => { var narrow = change.NewSize.Width < 760; if (compact != narrow) { compact = narrow; conversationsOpen = false; Draw(); } };
        Paint.Turned += Draw;
        Account.Shared.Changed += () => DispatcherQueue.TryEnqueue(Draw);
        providers.Changed += () => DispatcherQueue.TryEnqueue(Draw);
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
                var chat = SavedChat.Of(item!.AsObject());
                chats.Add(chat with { Choice = chat.Choice ?? providers.PreviousChoice ?? ModelChoice.Free });
                keptProposals[(string)item["id"]!] = item["proposals"] is JsonArray list ? list.Deserialize(StorageJson.Default.ListTaskProposal)! : [];
            }
            current = (string?)kept["current"];
            if (chats.FirstOrDefault(c => c.Id == current) is { } open)
            {
                thread = open.Thread; proposals = keptProposals.GetValueOrDefault(open.Id) ?? [];
                choice = open.Choice ?? ModelChoice.Free; startsRuntime = open.StartsRuntime;
            }
            else current = null;
            if (providers.PreviousChoice is not null) WriteChats();
        }
        providers.CompleteImport();
    }
    private void WriteChats() => Storage.Write(Storage.PathFor("ai/chats.json"), new JsonObject
    {
        ["chats"] = new JsonArray([.. chats.Select(c => { var o = c.ToJson(); o["proposals"] = JsonSerializer.SerializeToNode(keptProposals.GetValueOrDefault(c.Id) ?? [], StorageJson.Default.ListTaskProposal); return (JsonNode)o; })]),
        ["current"] = current,
    }.ToJsonString());
    private void Choose(ModelChoice next)
    {
        if (busy || choice == next) return;
        startsRuntime = next.ProviderId == ModelProviders.RuntimeId && thread.Nodes.Count > 0;
        choice = next;
        runtimeRequest = null; runtimeFirstAssistant = null;
        error = "";
        if (chats.FirstOrDefault(chat => chat.Id == current) is { } open)
        {
            chats = chats.Select(chat => chat.Id == open.Id ? chat with { Choice = choice, StartsRuntime = startsRuntime } : chat).ToList();
            WriteChats();
        }
        Draw();
    }
    /** What is said in a conversation moves it to the top of the list and keeps it. */
    private void Keep()
    {
        if (thread.Nodes.Count == 0) return;
        var id = current ?? Guid.NewGuid().ToString();
        var before = chats.FirstOrDefault(c => c.Id == id);
        chats = [new SavedChat(id, before?.Title ?? "", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), thread, before?.Forks, before?.RuntimeModels, choice, startsRuntime), .. chats.Where(c => c.Id != id)];
        keptProposals[id] = proposals; current = id;
        WriteChats();
    }
    private void Open(string? id)
    {
        if (busy) return;
        var found = chats.FirstOrDefault(c => c.Id == id);
        thread = found?.Thread ?? ChatThread.Empty; proposals = found is null ? [] : keptProposals.GetValueOrDefault(found.Id) ?? [];
        choice = found?.Choice ?? ModelChoice.Free; startsRuntime = found?.StartsRuntime == true;
        current = found?.Id ?? Guid.NewGuid().ToString(); error = ""; editing = null; openSteps.Clear();
        runtimeRequest = null; runtimeFirstAssistant = null;
        conversationsOpen = false;
        WriteChats(); Draw();
    }

    private Situation SituationNow()
    {
        int? week = campus.Term is { } term ? CampusLine.WeekOf(term, CampusDay.Today()) ?? 0 : null;
        return new(week, campus.Preferences.Class, campus.Preferences.Campus, memory.On ? memory.Text : null);
    }

    // ——— asking ———
    /** At most 24 messages go to the model, whole turns kept: a tool result never stays without its call. */
    private static List<JsonObject> Recent(List<JsonObject> history)
    {
        var all = history;
        while (all.Count > 24) { var next = all.FindIndex(1, m => (string?)m["role"] == "user"); if (next < 0) break; all = all[next..]; }
        return all;
    }

    private void Send(string question, string? parent = null, bool clearDraft = false)
    {
        var asked = question.Trim();
        if (asked.Length == 0 || busy) return;
        if (providers.Resolve(choice, out var provider) is { } unavailable) { error = unavailable; Draw(); return; }
        if (clearDraft) draft = "";
        if (provider is null && Account.Shared.User is null) { SignIn(asked); return; }
        parent ??= thread.Tip();
        var fork = parent != thread.Tip();
        var id = Guid.NewGuid().ToString();
        App.Watch(Run(thread.Append(parent, id, new JsonObject { ["role"] = "user", ["content"] = asked }), id, fork));
    }

    private async Task Run(ChatThread start, string at, bool fork = false, JsonObject? retryRequest = null, string? firstAssistant = null)
    {
        if (providers.Resolve(choice, out var provider) is { } unavailable) { error = unavailable; Draw(); return; }
        thread = start; var tip = at;
        fresh = []; from = at;
        busy = true; error = ""; editing = null; Keep(); Draw();
        var runtime = provider?.Runtime == true;
        var chat = chats.First(c => c.Id == current);
        if (runtime && chat.RuntimeModels?.Contains(provider!.Model) != true)
        {
            chat = chat with { RuntimeModels = [.. chat.RuntimeModels ?? [], provider!.Model] };
            chats = chats.Select(saved => saved.Id == chat.Id ? chat : saved).ToList(); WriteChats();
        }
        firstAssistant ??= runtime && (fork || startsRuntime) ? Guid.NewGuid().ToString() : null;
        if (firstAssistant is not null && chat.Forks?.Contains(firstAssistant) != true)
        {
            chat = chat with { Forks = [.. chat.Forks ?? [], firstAssistant] };
            chats = chats.Select(saved => saved.Id == chat.Id ? chat : saved).ToList(); WriteChats();
        }
        var conversationId = retryRequest?["conversation_id"]?.GetValue<string>() ?? firstAssistant ?? chat.ConversationId(at, start);
        runtimeFirstAssistant = firstAssistant;
        void Grow(JsonObject message)
        {
            var id = (string?)message["role"] == "assistant" && firstAssistant is not null ? firstAssistant : Guid.NewGuid().ToString();
            if (id == firstAssistant) { firstAssistant = null; runtimeFirstAssistant = null; startsRuntime = false; }
            fresh.Add(id); thread = thread.Append(tip, id, message); tip = id; Keep(); Draw();
        }
        var history = thread.Lineage(at).Select(n => n.Message).ToList();
        if (!runtime) history = Recent(history);
        stop = new CancellationTokenSource(); var cancel = stop.Token;
        var situation = SituationNow();
        using var tools = new CampusTools(campus, assistant.ToolsFor(situation), Remember, proposal => { proposals = [.. proposals, proposal]; });
        frame.Start();
        try
        {
            for (var round = 0; round < Assistant.Rounds; round++)
            {
                var last = round == Assistant.Rounds - 1;
                said = ""; lastUpdate = null; runtimeStage = null; stream = new DocStream(); liveDirty = true;
                JsonObject answer;
                try { answer = provider is not null ? await AskOwn(provider, history, situation, last, cancel, conversationId, round == 0 ? retryRequest : null) : await AskFree(history, situation, last, cancel); }
                finally { stream.Dispose(); stream = null; live.Child = null; }
                history = [.. history, answer]; Grow(answer);
                if (answer["tool_calls"] is not JsonArray calls || calls.Count == 0) { runtimeRequest = null; runtimeFirstAssistant = null; return; }
                foreach (var item in calls)
                {
                    var call = item!; var function = call["function"]!;
                    JsonNode? result;
                    try { result = await tools.Execute((string)function["name"]!, JsonNode.Parse((string)function["arguments"]!)!.AsObject(), (string)call["id"]!); }
                    // A tool that fails tells the model why, as the web and Android do; the answer goes on.
                    catch (UnknownReference failure) { result = new JsonObject { ["error"] = failure.Message, ["code"] = "unknown-reference" }; }
                    catch (Exception failure) when (failure is ArgumentException or InvalidOperationException or InvalidDataException) { result = new JsonObject { ["error"] = failure.Message }; }
                    catch (Exception failure) when (failure is HttpRequestException or IOException or JsonException or TaskCanceledException) { result = new JsonObject { ["error"] = "校园数据暂不可读，请重试。" }; }
                    var message = new JsonObject { ["role"] = "tool", ["tool_call_id"] = (string)call["id"]!, ["content"] = result?.ToJsonString() ?? "null" };
                    history = [.. history, message]; Grow(message);
                }
            }
        }
        catch (OperationCanceledException)
        {
            if (said.Length > 0)
            {
                Grow(new JsonObject { ["role"] = "assistant", ["content"] = said });
            }
            runtimeRequest = null; runtimeFirstAssistant = null;
        }
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

    private async Task<JsonObject> AskOwn(Own mine, List<JsonObject> history, Situation situation, bool last, CancellationToken cancel, string conversationId, JsonObject? retryRequest = null)
    {
        if (Models.AddressError(mine.Base, mine.Runtime) is { } wrong) throw new InvalidOperationException(wrong);
        var payload = retryRequest?.DeepClone().AsObject() ?? assistant.Request(mine.Model, history, situation, DateTimeOffset.UtcNow, last, mine.Runtime, conversationId);
        if (mine.Runtime) { if (retryRequest is not null) payload["retry"] = true; runtimeRequest = payload.DeepClone().AsObject(); }
        using var request = new HttpRequestMessage(HttpMethod.Post, Models.Endpoint(mine.Base))
        { Content = new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json") };
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
                string? detail = null, code = null; try { var failure = JsonNode.Parse(text)?["error"]; detail = (string?)failure?["message"]; code = (string?)failure?["code"]; } catch (JsonException) { }
                if (mine.Runtime) throw new InvalidOperationException(assistant.RuntimeError(code, detail ?? $"本地模型未能完成请求（{(int)response.StatusCode}）。"));
                throw new InvalidOperationException((int)response.StatusCode switch
                {
                    401 => "API Key 不对，请在「模型服务」里修改。", 402 => "你的 API 余额不足。", 429 => "你的 API 请求太频繁，稍后再试。",
                    404 => "接口或模型不存在" + (detail is not null ? $"：{detail}" : "，检查地址和模型名。"),
                    var status => $"你的 API 没有回答（{status}）" + (detail is not null ? $"：{detail}" : ""),
                });
            }
            var completion = assistant.Read(mine.Runtime);
            using var reader = new StreamReader(await response.Content.ReadAsStreamAsync(cancel), Encoding.UTF8);
            while (await reader.ReadLineAsync(cancel) is { } line)
            {
                if (mine.Runtime && line.StartsWith(": stage ", StringComparison.Ordinal))
                {
                    runtimeStage = assistant.RuntimeStage(line[8..]);
                    liveDirty = true;
                }
                OnDelta(completion.Take(line));
            }
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
        memory = (true, Memory.Remembered(memory.Text, fact));
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
    private void Draw()
    {
        side.Visibility = !compact || conversationsOpen ? Visibility.Visible : Visibility.Collapsed;
        side.Width = compact ? double.NaN : 260;
        side.HorizontalAlignment = compact ? HorizontalAlignment.Stretch : HorizontalAlignment.Left;
        Grid.SetColumnSpan(side, compact ? 2 : 1);
        main.Visibility = compact && conversationsOpen ? Visibility.Collapsed : Visibility.Visible;
        DrawSide(); DrawMain();
    }

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
        if (compact)
        {
            var heading = new StackPanel();
            heading.Children.Add(Kit.TextAction("返回对话", () => { conversationsOpen = false; Draw(); }, Icons.Back));
            heading.Children.Add(top); side.Children.Add(heading);
        }
        else side.Children.Add(top);
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
        var removed = chats.FirstOrDefault(chat => chat.Id == id);
        var provider = providers.Find(ModelProviders.RuntimeId);
        chats = chats.Where(c => c.Id != id).ToList(); keptProposals.Remove(id);
        if (current == id) Open(null);
        else { WriteChats(); Draw(); }
        if (removed?.RuntimeModels is { Count: > 0 } && provider is { Key.Length: > 0 })
            App.Watch(CloseModelPages(removed, new(provider.Address, "", provider.Key, true)));
    }
    private async Task CloseModelPages(SavedChat removed, Own provider)
    {
        try { await Models.CloseConversationsAsync(Http, provider, removed.RuntimeModels ?? [], [removed.Id, .. removed.Forks ?? []]); }
        catch (Exception failure) when (failure is HttpRequestException or OperationCanceledException or InvalidOperationException)
        {
            var reason = failure is InvalidOperationException ? failure.Message : failure is OperationCanceledException ? "本地模型服务没有及时响应，网页尚未关闭。" : "无法连接本地模型服务，网页尚未关闭。";
            var body = Kit.Column(12, Pages.SheetHead(Pages.SheetTitle("对话已删除"), () => App.Window?.Close()), Kit.Text($"本机记录已删除。{reason}", Role.Body, "muted", wrap: true));
            body.Padding = new Thickness(22, 20, 22, 18); App.Window?.Sheet(body, 420);
        }
    }

    private void DrawMain()
    {
        main.Children.Clear(); main.RowDefinitions.Clear();
        main.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); main.RowDefinitions.Add(new RowDefinition()); main.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        var blank = thread.Path().Count == 0;
        // The bar gives the conversation its name. The picker stays with the question below.
        var bar = new Grid { Padding = new Thickness(14, 8, 14, 0), ColumnSpacing = 6, MinHeight = 48 };
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); bar.ColumnDefinitions.Add(new ColumnDefinition());
        if (compact) bar.Children.Add(Icon("对话", Icons.Note, () => { conversationsOpen = true; Draw(); }, 16));
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
            hello.Children.Add(Fine("可以问课表、空教室和地图，还能查课程知识、培养方案、真题与通知。任务草案经你确认后才会保存。对话保存在当前设备，记忆在登录后同步。"));
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
            if (lastQuestion is not null) row.Children.Add(Kit.TextAction("重试", () => { if (!busy) App.Watch(runtimeRequest is { } failed ? Run(thread, thread.Tip(), retryRequest: failed, firstAssistant: runtimeFirstAssistant) : Run(thread, lastQuestion.Id)); }, Icons.Again));
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

    private Tap ModelPicker()
    {
        var selected = providers.Find(choice.ProviderId);
        var picked = selected?.ModelName(choice.ModelId) ?? choice.ModelId;
        var label = Kit.Text($"{selected?.Name ?? "服务商已移除"} · {picked}", Role.Label);
        label.MaxWidth = compact ? 168 : 285;
        label.TextTrimming = TextTrimming.CharacterEllipsis;
        var content = Kit.Line(6, label, Kit.Icon(Icons.Chevron, 13, "muted"));
        if (selected?.IsFree == true)
        {
            var avatar = new Image { Source = new Microsoft.UI.Xaml.Media.Imaging.BitmapImage(new Uri(Models.OwnerAvatar)) };
            content.Children.Insert(0, new Border { Width = 16, Height = 16, CornerRadius = new CornerRadius(8), Child = avatar });
        }
        content.VerticalAlignment = VerticalAlignment.Center;
        var button = new Tap(Paint.Clear, Paint.Brush("surfaceSunken"))
        { Content = content, MinHeight = 36, HorizontalAlignment = HorizontalAlignment.Left, Padding = new Thickness(10, 0, 10, 0), CornerRadius = new CornerRadius(10), IsEnabled = !busy };
        AutomationProperties.SetName(button, $"选择服务商，当前 {label.Text}");
        AutomationProperties.SetAutomationId(button, "ai-provider");
        var menu = new MenuFlyout();
        menu.Items.Add(new MenuFlyoutItem { Text = "选择服务商", IsEnabled = false });
        foreach (var provider in providers.Available)
        {
            var service = new MenuFlyoutSubItem { Text = provider.Name };
            service.Items.Add(new MenuFlyoutItem { Text = "选择模型", IsEnabled = false });
            foreach (var model in provider.Models.Where(model => model.Enabled))
            {
                var next = new ModelChoice(provider.Id, model.Id);
                var item = new ToggleMenuFlyoutItem { Text = provider.ModelName(model.Id), IsChecked = next == choice };
                item.Click += (_, _) => Choose(next);
                service.Items.Add(item);
            }
            menu.Items.Add(service);
        }
        menu.Items.Add(new MenuFlyoutSeparator());
        var settings = new MenuFlyoutItem { Text = "管理模型服务" };
        settings.Click += (_, _) => App.Open("me", "models");
        menu.Items.Add(settings);
        button.Click += (_, _) => menu.ShowAt(button, new FlyoutShowOptions { Placement = FlyoutPlacementMode.TopEdgeAlignedLeft });
        return button;
    }

    private FrameworkElement Composer()
    {
        var box = new TextBox { Text = draft, PlaceholderText = "问点什么", AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MaxLength = 4000, MaxHeight = 200, FontSize = 16, BorderThickness = new Thickness(0), Background = Paint.Clear, Padding = new Thickness(0, 7, 0, 7), VerticalAlignment = VerticalAlignment.Center };
        box.Resources["TextControlBackgroundFocused"] = Paint.Clear; box.Resources["TextControlBackgroundPointerOver"] = Paint.Clear; box.Resources["TextControlBorderBrushFocused"] = Paint.Clear;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(box, "问点什么");
        var send = new Tap(Paint.Brush("ink")) { Width = 36, Height = 36, CornerRadius = new CornerRadius(18), VerticalAlignment = VerticalAlignment.Bottom, Content = Kit.Icon(busy ? Icons.Square : Icons.Up, 20, "paper", 20, 2) };
        ((FrameworkElement)send.Content).HorizontalAlignment = HorizontalAlignment.Center; ((FrameworkElement)send.Content).VerticalAlignment = VerticalAlignment.Center;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(send, busy ? "停止" : "发送");
        void Go() { if (busy) { stop?.Cancel(); return; } Send(box.Text, clearDraft: true); }
        send.Click += (_, _) => Go();
        void Shade() { send.Opacity = busy || box.Text.Trim().Length > 0 ? 1 : .18; }
        box.TextChanged += (_, _) => { draft = box.Text; Shade(); }; Shade();
        box.PreviewKeyDown += (_, e) =>
        {
            var shift = Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(Windows.System.VirtualKey.Shift).HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down);
            if (e.Key == Windows.System.VirtualKey.Enter && !shift) { e.Handled = true; Go(); }
        };
        var grid = new Grid { ColumnSpacing = 8, RowSpacing = 4 };
        grid.ColumnDefinitions.Add(new ColumnDefinition()); grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        Grid.SetColumnSpan(box, 2); grid.Children.Add(box);
        var model = ModelPicker(); Grid.SetRow(model, 1); grid.Children.Add(model);
        Grid.SetRow(send, 1); Grid.SetColumn(send, 1); grid.Children.Add(send);
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
                AutomationProperties.SetName(head, Steps.Line(steps));
                AutomationProperties.SetAutomationId(head, $"ai-steps:{question.Id}");
                var id = question.Id; head.Click += (_, _) => { if (!openSteps.Remove(id)) openSteps.Add(id); DrawTurns(); };
                turn.Children.Add(head);
                if (open)
                {
                    var list = new StackPanel { Spacing = 4, Padding = new Thickness(14, 0, 0, 0), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(2, 0, 0, 0) };
                    for (var index = 0; index < steps.Count; index++)
                    {
                        var step = steps[index]; var call = calls[index];
                        var line = new TextBlock { TextWrapping = TextWrapping.Wrap, FontSize = 13.5, Foreground = Paint.Brush(step.Failed ? "danger" : "muted") };
                        line.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = step.Label, FontWeight = FontWeights.SemiBold, Foreground = Paint.Brush(step.Failed ? "danger" : "ink") });
                        if (step.Detail.Length > 0) line.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = "  " + step.Detail });
                        var inspect = new Tap { Content = line, HorizontalAlignment = HorizontalAlignment.Stretch };
                        AutomationProperties.SetName(inspect, $"{step.Label}：{step.Detail}，查看调用详情");
                        AutomationProperties.SetAutomationId(inspect, $"ai-call:{(string)call["id"]!}");
                        inspect.Click += (_, _) =>
                        {
                            var column = new StackPanel { Padding = new Thickness(20, 18, 20, 22), Spacing = 10 };
                            column.Children.Add(Pages.SheetHead(Pages.SheetTitle(step.Label), () => App.Window?.Close()));
                            var arguments = (string?)call["function"]?["arguments"] ?? "";
                            var result = results.GetValueOrDefault((string)call["id"]!);
                            try { arguments = CallText(JsonNode.Parse(arguments)); } catch (JsonException) { }
                            var words = Kit.Text($"调用参数\n{arguments}\n\n调用结果\n{(result is null ? "正在等待结果…" : CallText(result))}", Role.Caption, "muted", wrap: true);
                            words.IsTextSelectionEnabled = true; column.Children.Add(words);
                            App.Window?.Sheet(column, 620);
                        };
                        list.Children.Add(inspect);
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
                tools.Children.Add(Icon("重新回答", Icons.Again, () => { if (!busy) App.Watch(Run(thread, question.Id, fork: true)); }, enabled: !busy));
                tools.Children.Add(Branches(replies[0].Id));
                turn.Children.Add(tools);
            }
            turns.Children.Add(turn);
        }
    }

    /** Parsed tool messages are JSON DOM values. Write them directly so this works with NativeAOT's reflection off. */
    private static string CallText(JsonNode? value)
    {
        using var stream = new MemoryStream();
        using var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Indented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
        if (value is null) writer.WriteNullValue(); else value.WriteTo(writer);
        writer.Flush();
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private void DrawLive()
    {
        if (stream is null) { live.Child = null; return; }
        if (lastUpdate is null)
        {
            live.Child = runtimeStage is { } stage ? Kit.Text(stage, Role.Caption, "muted", wrap: true) : null;
            return;
        }
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
        App.OpenLink(href);
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
                Card((string?)result["scope"] == "within-building" ? $"同在{(string)result["building"]!}" : $"导航到{(string?)result["arrival"] ?? (string)result["to"]!}", result["distance_m"] is null ? string.Join(" → ", result["steps"]!.AsArray().Select(s => (string)s!)) : $"{(long)result["distance_m"]!} 米 · {((long)result["duration_s"]! < 60 ? "不到1分钟" : $"约 {(int)Math.Ceiling((long)result["duration_s"]! / 60.0)} 分钟")}", () => Link((string)result["url"]!));
                break;
            case "read" when result["url"] is not null:
                Card((string)result["title"]!, string.Join(" · ", new[] { (string?)result["source"], (string?)result["date"] }.Where(s => !string.IsNullOrEmpty(s))), () => App.OpenLink((string)result["url"]!));
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
        var h = Kit.Text(open.Count > 0 ? $"起草了 {drafts.Count} 个任务" : $"任务已添加 · {drafts.Count} 个任务", Role.Label, "muted", bold: true); h.Margin = new Thickness(0, 0, 0, 6);
        column.Children.Add(h);
        Tap? add = null;
        void Count() { if (add is not null) { ((TextBlock)add.Content).Text = picked.Count == open.Count ? "添加全部任务" : $"添加 {picked.Count} 个任务"; add.IsEnabled = picked.Count > 0; add.Opacity = picked.Count > 0 ? 1 : .5; } }
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
            add = Kit.Action("添加全部任务", () => Confirm(picked), go: true); add.HorizontalAlignment = HorizontalAlignment.Stretch; add.Margin = new Thickness(0, 10, 0, 0);
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
        column.Children.Add(Kit.Text("未登录时保存在本机；登录后记忆随账号同步。开启记忆后，提问时会发送给所选模型。", Role.Caption, "muted"));
        var buttons = new Grid { ColumnSpacing = 8 };
        buttons.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); buttons.ColumnDefinitions.Add(new ColumnDefinition()); buttons.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); buttons.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var clear = new Tap { Content = Kit.Text("全部清空", Role.Label, "muted"), VerticalAlignment = VerticalAlignment.Center }; clear.Click += (_, _) => text.Text = "";
        buttons.Children.Add(clear);
        var cancel = Pill("取消", () => App.Window?.Close()); Grid.SetColumn(cancel, 2); buttons.Children.Add(cancel);
        var save = Pill("保存", () =>
        {
            var kept = string.Join("\n", text.Text.Split('\n').Select(l => l.Trim()).Where(l => l.Length > 0).Select(l => $"- {l}"));
            memory = (on, on ? kept : memory.Text); App.Window?.Close(); DrawSide();
        }, true);
        Grid.SetColumn(save, 3); buttons.Children.Add(save);
        column.Children.Add(buttons);
        App.Window?.Sheet(column, 460);
    }

    /** Signing in for the free quota; the question waits and is asked once signed in. */
    private void SignIn(string question) => Me.SignIn.Show(() => Send(question));
}
