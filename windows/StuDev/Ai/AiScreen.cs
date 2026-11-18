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
    private static readonly HttpClient Http = new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = Timeout.InfiniteTimeSpan };
    private readonly Campus campus = Campus.Shared;
    private readonly ModelProviders providers = ModelProviders.Shared;
    private readonly Assistant assistant = Assistant.Shared;
    private readonly ToolAccess toolAccess = ToolAccess.Shared;
    private readonly ExternalMcp externalMcp = ExternalMcp.Shared;
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
    private ToolMenuItem? draftTool;
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
        providers.Changed += () => DispatcherQueue.TryEnqueue(() =>
        {
            if (choice.ProviderId == ModelProviders.RuntimeId && !providers.RuntimeEnabled) stop?.Cancel();
            if (providers.RuntimeEnabled && error == ModelProviders.RuntimeDisabled) error = "";
            Draw();
        });
        toolAccess.Changed += () => DispatcherQueue.TryEnqueue(Draw);
        externalMcp.Changed += () => DispatcherQueue.TryEnqueue(Draw);
        Draw();
    }
    public override void Shown(object? argument)
    {
        Draw();
        App.Watch(toolAccess.Refresh());
        App.Watch(externalMcp.Refresh());
    }

    // ——— what is kept on this device ———
    private void ReadKept()
    {
        if (Storage.Read("ai/chats.json") is { } text)
        {
            var kept = JsonNode.Parse(text)!;
            activeProject = projects.Find((string?)kept["project"])?.Id;
            foreach (var item in kept["chats"]!.AsArray())
            {
                var chat = SavedChat.Of(item!.AsObject());
                chats.Add(chat with { Choice = chat.Choice ?? providers.PreviousChoice ?? ModelChoice.Free });
                keptProposals[chat.Id] = ReadProposals(item.AsObject());
            }
            ReadProject();
            current = (string?)kept["current"];
            if (chats.FirstOrDefault(c => c.Id == current && c.ProjectId == activeProject) is { } open)
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
        ["chats"] = new JsonArray([.. chats.Where(c => !Bound(c.ProjectId)).Select(c =>
        {
            var o = c.ToJson();
            o["proposals"] = JsonSerializer.SerializeToNode(keptProposals.GetValueOrDefault(c.Id) ?? [], StorageJson.Default.ListTaskProposal);
            return (JsonNode)o;
        })]),
        ["current"] = current,
        ["project"] = activeProject,
    }.ToJsonString());
    private void Choose(ModelChoice next)
    {
        if (busy || choice == next) return;
        var resetRuntime = next.ProviderId == ModelProviders.RuntimeId && thread.Nodes.Count > 0;
        if (chats.FirstOrDefault(chat => chat.Id == current) is { } open)
        {
            var updated = open with { Choice = next, StartsRuntime = resetRuntime };
            if (!PersistProjectChat(updated)) { Draw(); return; }
            chats = chats.Select(chat => chat.Id == open.Id ? updated : chat).ToList();
            if (!Bound(updated.ProjectId)) WriteChats();
        }
        startsRuntime = resetRuntime;
        choice = next;
        runtimeRequest = null; runtimeFirstAssistant = null;
        error = "";
        Draw();
    }
    /** What is said in a conversation moves it to the top of the list and keeps it. */
    private bool Keep()
    {
        if (thread.Nodes.Count == 0) return true;
        var first = current is null;
        var id = current ?? Guid.NewGuid().ToString();
        var before = chats.FirstOrDefault(c => c.Id == id);
        keptProposals[id] = proposals; current = id;
        var updated = new SavedChat(id, before?.Title ?? "", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), thread,
            before?.Forks, before?.RuntimeModels, choice, startsRuntime, activeProject, before?.Pinned == true, before?.Archived == true);
        if (!PersistProjectChat(updated)) return false;
        chats = [updated, .. chats.Where(c => c.Id != id)];
        if (first || !Bound(updated.ProjectId)) WriteChats();
        return true;
    }
    private void Open(string? id)
    {
        if (busy) return;
        var found = chats.FirstOrDefault(c => c.Id == id && c.ProjectId == activeProject);
        thread = found?.Thread ?? ChatThread.Empty; proposals = found is null ? [] : keptProposals.GetValueOrDefault(found.Id) ?? [];
        choice = found?.Choice ?? ModelChoice.Free; startsRuntime = found?.StartsRuntime == true;
        current = found?.Id ?? Guid.NewGuid().ToString(); error = ""; editing = null; openSteps.Clear();
        draftTool = null;
        draftSkill = null;
        runtimeRequest = null; runtimeFirstAssistant = null;
        conversationsOpen = false;
        WriteChats(); Draw();
    }

    private Situation SituationNow(bool instructions = false, string? skill = null)
    {
        int? week = campus.Term is { } term ? CampusLine.WeekOf(term, CampusDay.Today()) ?? 0 : null;
        if (instructions && memory.On) ReloadProjectMemory();
        return new(week, campus.Preferences.Class, campus.Preferences.Campus, memory.On ? BoundText(ActiveMemory, Memory.Limit) : null,
            instructions ? CombinedInstructions(skill) : null);
    }

    // ——— asking ———
    /** At most 24 messages go to the model, whole turns kept: a tool result never stays without its call. */
    private static List<JsonObject> Recent(List<JsonObject> history)
    {
        var all = history;
        while (all.Count > 24) { var next = all.FindIndex(1, m => (string?)m["role"] == "user"); if (next < 0) break; all = all[next..]; }
        return all;
    }

    private void Send(string question, string? parent = null, bool clearDraft = false, string? preferredTool = null, string? skill = null)
    {
        var asked = question.Trim();
        if (asked.Length == 0 || busy) return;
        if (Bound(activeProject) && projectFolder is null) { error = "请重新打开这个项目文件夹。"; Draw(); return; }
        if (providers.Resolve(choice, out var provider) is { } unavailable) { error = unavailable; Draw(); return; }
        if (preferredTool is not null && !ToolsFor(SituationNow(), provider).Any(tool => Assistant.ToolName(tool) == preferredTool))
        { error = "所选工具当前不可用，请重新选择。"; Draw(); return; }
        if (provider is null && Account.Shared.User is null) { Me.SignIn.Show(() => Send(asked, parent, clearDraft, preferredTool, skill)); return; }
        if (clearDraft) { draft = ""; draftTool = null; draftSkill = null; }
        parent ??= thread.Tip();
        var fork = parent != thread.Tip();
        var id = Guid.NewGuid().ToString();
        App.Watch(Run(thread.Append(parent, id, new JsonObject { ["role"] = "user", ["content"] = asked }, preferredTool), id, fork, skill: skill));
    }

    private List<JsonObject> ToolsFor(Situation situation, Own? provider) =>
        [.. assistant.ToolsFor(situation).Where(tool => toolAccess.CampusAllowed(Assistant.ToolName(tool))),
         .. provider is null ? [] : toolAccess.BrowserAvailable.Select(tool => tool.Definition()),
         .. externalMcp.Available.Select(tool => tool.Definition())];

    private static bool IsExternal(string name) => name.StartsWith("mcp_", StringComparison.Ordinal);

    private static List<JsonObject> HostedHistory(IEnumerable<JsonObject> history, HashSet<string> available)
    {
        var omitted = new HashSet<string>(StringComparer.Ordinal);
        var messages = new List<JsonObject>();
        foreach (var message in history)
        {
            if ((string?)message["role"] == "tool" && omitted.Contains((string)message["tool_call_id"]!)) continue;
            if (message["tool_calls"] is not JsonArray calls) { messages.Add(message); continue; }
            var campus = new JsonArray();
            foreach (var call in calls)
            {
                var name = (string)call!["function"]!["name"]!;
                if (name.StartsWith("web_", StringComparison.Ordinal) || IsExternal(name) && !available.Contains(name))
                    omitted.Add((string)call["id"]!);
                else campus.Add(call.DeepClone());
            }
            if (campus.Count == calls.Count) { messages.Add(message); continue; }
            if (campus.Count == 0 && message["content"] is null) continue;
            var copy = message.DeepClone().AsObject();
            if (campus.Count > 0) copy["tool_calls"] = campus;
            else copy.Remove("tool_calls");
            messages.Add(copy);
        }
        return messages;
    }

    private async Task<bool> ConfirmTool(string label, string detail, CancellationToken cancel)
    {
        if (App.Window is not { } window) return false;
        var approved = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var buttons = Kit.Line(8, Pill("跳过", () => window.Close()), Pill("允许这一次", () =>
        {
            approved.TrySetResult(true);
            window.Close();
        }, true));
        buttons.HorizontalAlignment = HorizontalAlignment.Right;
        var sheet = Kit.Column(12, Pages.SheetHead(Pages.SheetTitle(label), () => window.Close()), Kit.Text(detail, Role.Body, "muted", wrap: true), buttons);
        sheet.Padding = new Thickness(22, 20, 22, 18);
        window.Sheet(sheet, 460, () => approved.TrySetResult(false));
        using var registration = cancel.Register(() => DispatcherQueue.TryEnqueue(() =>
        {
            if (approved.TrySetCanceled(cancel)) window.Close();
        }));
        return await approved.Task;
    }

    private async Task Run(ChatThread start, string at, bool fork = false, JsonObject? retryRequest = null, string? firstAssistant = null, string? skill = null)
    {
        if (providers.Resolve(choice, out var provider) is { } unavailable) { error = unavailable; Draw(); return; }
        Situation situation;
        try { situation = SituationNow(instructions: true, skill); }
        catch (Exception failure) when (ProjectFolder.IsProblem(failure))
        { error = ProjectMessage(failure, "未能读取本轮指令。"); Draw(); return; }
        var available = ToolsFor(situation, provider);
        var names = available.Select(Assistant.ToolName).ToHashSet(StringComparer.Ordinal);
        var browser = toolAccess.BrowserAvailable.Where(tool => names.Contains(tool.Alias)).ToDictionary(tool => tool.Alias, StringComparer.Ordinal);
        var external = externalMcp.Available.Where(tool => names.Contains(tool.Alias)).ToDictionary(tool => tool.Alias, StringComparer.Ordinal);
        var externalTools = available.Where(tool => IsExternal(Assistant.ToolName(tool))).ToList();
        var lineage = start.Lineage(at);
        var preferredTool = lineage.LastOrDefault(node => (string?)node.Message["role"] == "user")?.PreferredTool;
        if (preferredTool is not null && !names.Contains(preferredTool))
        { error = "所选工具当前不可用，请重新选择。"; Draw(); return; }
        if (retryRequest?["tools"] is JsonArray previous && previous.OfType<JsonObject>().Any(tool => !names.Contains(Assistant.ToolName(tool))))
        { error = "可用工具已更新，请重新发送本轮。"; Draw(); return; }
        var priorThread = thread;
        thread = start; var tip = at;
        fresh = []; from = at;
        busy = true; error = ""; editing = null;
        if (!Keep()) { thread = priorThread; from = null; busy = false; Draw(); return; }
        Draw();
        var runtime = provider?.Runtime == true;
        var chat = chats.First(c => c.Id == current);
        if (runtime && chat.RuntimeModels?.Contains(provider!.Model) != true)
        {
            chat = chat with { RuntimeModels = [.. chat.RuntimeModels ?? [], provider!.Model] };
            if (!PersistProjectChat(chat)) { busy = false; from = null; Draw(); return; }
            chats = chats.Select(saved => saved.Id == chat.Id ? chat : saved).ToList();
            if (!Bound(chat.ProjectId)) WriteChats();
        }
        firstAssistant ??= runtime && (fork || startsRuntime) ? Guid.NewGuid().ToString() : null;
        if (firstAssistant is not null && chat.Forks?.Contains(firstAssistant) != true)
        {
            chat = chat with { Forks = [.. chat.Forks ?? [], firstAssistant] };
            if (!PersistProjectChat(chat)) { busy = false; from = null; Draw(); return; }
            chats = chats.Select(saved => saved.Id == chat.Id ? chat : saved).ToList();
            if (!Bound(chat.ProjectId)) WriteChats();
        }
        var conversationId = retryRequest?["conversation_id"]?.GetValue<string>() ?? firstAssistant ?? chat.ConversationId(at, start);
        runtimeFirstAssistant = firstAssistant;
        void Grow(JsonObject message)
        {
            var id = (string?)message["role"] == "assistant" && firstAssistant is not null ? firstAssistant : Guid.NewGuid().ToString();
            if (id == firstAssistant) { firstAssistant = null; runtimeFirstAssistant = null; startsRuntime = false; }
            fresh.Add(id); thread = thread.Append(tip, id, message); tip = id;
            if (!Keep()) throw new InvalidOperationException(projectStatus ?? "未能保存项目对话。");
            Draw();
        }
        var history = lineage.Select(n => n.Message).ToList();
        if (!runtime) history = Recent(history);
        if (provider is null) history = HostedHistory(history, names);
        stop = new CancellationTokenSource(); var cancel = stop.Token;
        using var tools = new CampusTools(campus, available, Remember, proposal => { proposals = [.. proposals, proposal]; });
        var declined = new HashSet<string>(StringComparer.Ordinal);
        frame.Start();
        try
        {
            for (var round = 0; round < Assistant.Rounds; round++)
            {
                var last = round == Assistant.Rounds - 1;
                said = ""; lastUpdate = null; runtimeStage = null; stream = new DocStream(); liveDirty = true;
                JsonObject answer;
                var preferred = round == 0 ? preferredTool : null;
                var offered = declined.Count == 0 ? available : available.Where(tool => !declined.Contains(Assistant.ToolName(tool))).ToList();
                try
                {
                    answer = provider is not null
                        ? await AskOwn(provider, history, situation, offered, preferred, last, cancel, conversationId, round == 0 ? retryRequest : null)
                        : await AskFree(history, situation, offered, externalTools, preferred, last, cancel);
                }
                finally { stream.Dispose(); stream = null; live.Child = null; }
                history = [.. history, answer]; Grow(answer);
                if (answer["tool_calls"] is not JsonArray calls || calls.Count == 0) { runtimeRequest = null; runtimeFirstAssistant = null; return; }
                foreach (var item in calls)
                {
                    var call = item!; var function = call["function"]!;
                    var name = (string)function["name"]!;
                    JsonNode? result;
                    try
                    {
                        var args = JsonNode.Parse((string)function["arguments"]!) as JsonObject ?? throw new ArgumentException("工具参数无效。");
                        var webpage = browser.GetValueOrDefault(name);
                        var remote = external.GetValueOrDefault(name);
                        if (!names.Contains(name) || (webpage is not null ? !toolAccess.BrowserAllowed(webpage.Name) : remote is null && !toolAccess.CampusAllowed(name)))
                            throw new ArgumentException("这个工具未启用。");
                        var confirm =
                            (webpage is not null || remote is not null) && toolAccess.AskForBrowser ||
                            name == "remember" && toolAccess.AskForMemory(campus.Preferences.Part("memory")?["on"]?.GetValue<bool>() == true);
                        var label = remote?.Title ?? webpage?.Title;
                        var detail = remote is null
                            ? webpage?.Description ?? (string?)args["fact"] ?? ""
                            : $"{remote.Server.Name} · {remote.Server.Endpoint.Host}\n{remote.Description}\n\n{CallText(args)}";
                        if (declined.Contains(name) || (confirm && !await ConfirmTool(label is null ? "是否写入记忆？" : $"是否使用「{label}」？", detail, cancel)))
                        {
                            declined.Add(name);
                            result = new JsonObject { ["error"] = "本轮未批准使用这个工具。", ["code"] = "tool_declined" };
                        }
                        else if (remote is not null) result = await externalMcp.Invoke(remote, args, cancel);
                        else if (webpage is not null) result = await toolAccess.Invoke(webpage, args, cancel);
                        else result = await tools.Execute(name, args, (string)call["id"]!);
                    }
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
        finally { frame.Stop(); busy = false; from = null; stop = null; Draw(); }
    }

    private void OnDelta(string piece)
    {
        if (piece.Length == 0 || stream is null) return;
        said += piece;
        lastUpdate = stream.Push(piece);
        liveDirty = true;
    }
    private string? lastUpdate;

    private async Task<JsonObject> AskOwn(Own mine, List<JsonObject> history, Situation situation, List<JsonObject> available,
        string? preferredTool, bool last, CancellationToken cancel, string conversationId, JsonObject? retryRequest = null)
    {
        if (Models.AddressError(mine.Base, mine.Runtime) is { } wrong) throw new InvalidOperationException(wrong);
        var payload = retryRequest?.DeepClone().AsObject() ?? assistant.Request(mine.Model, history, situation, DateTimeOffset.UtcNow,
            last, mine.Runtime, conversationId, offered: available, preferredTool: preferredTool);
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
            var completion = assistant.Read(mine.Runtime, last ? [] : available.Select(Assistant.ToolName));
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

    private async Task<JsonObject> AskFree(List<JsonObject> history, Situation situation, List<JsonObject> available,
        List<JsonObject> external, string? preferredTool, bool last, CancellationToken cancel)
    {
        JsonObject? answer = null; string? failed = null;
        var body = new JsonObject { ["messages"] = new JsonArray([.. history.Select(m => m.DeepClone())]), ["last"] = last, ["situation"] = situation.ToJson() };
        if (external.Count > 0) body["externalTools"] = new JsonArray([.. external.Select(tool => tool.DeepClone())]);
        if (!last) body["toolNames"] = new JsonArray([.. available.Select(tool => (JsonNode)JsonValue.Create(Assistant.ToolName(tool))!)]);
        if (!last && preferredTool is not null) body["preferredTool"] = preferredTool;
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
        var next = Memory.Remembered(ActiveMemory, fact);
        if (activeProject is null) memory = (true, next);
        else
        {
            try { WriteProjectMemory(next, projectMemory); }
            catch (Exception failure) when (ProjectFolder.IsProblem(failure))
            { throw new InvalidOperationException(ProjectMessage(failure, "未能保存项目记忆。")); }
        }
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
        var top = new Tap(Paint.Faded("brand", .1), Paint.Faded("brand", .16))
        {
            Content = Kit.Line(8, Kit.Icon(Icons.Compose, 18, "brand", 20), Kit.Text("新对话", Role.Label, "brand", bold: true)),
            Height = 38, Padding = new Thickness(10, 0, 10, 0), CornerRadius = new CornerRadius(10), IsEnabled = !busy,
            HorizontalAlignment = compact ? HorizontalAlignment.Left : HorizontalAlignment.Stretch,
            MinWidth = compact ? 116 : 0,
        };
        ((StackPanel)top.Content).VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(top, "新对话");
        top.Click += (_, _) =>
        {
            draft = ""; showArchived = false; organizing = false; selectedChats.Clear();
            if (activeProject is null) projectsOpen = false;
            Open(null);
        };
        var newRow = new Grid { Margin = new Thickness(12, 12, 12, 6), ColumnSpacing = compact ? 8 : 0 };
        newRow.ColumnDefinitions.Add(new ColumnDefinition());
        newRow.Children.Add(top);
        if (compact)
        {
            newRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var close = Icon("收起侧栏", Icons.Cross, () => { conversationsOpen = false; Draw(); }, 16);
            close.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetColumn(close, 1); newRow.Children.Add(close);
        }
        var sideHeading = new StackPanel();
        sideHeading.Children.Add(newRow);
        SideNavigation(sideHeading);
        side.Children.Add(sideHeading);
        var list = new StackPanel { Padding = new Thickness(12, 4, 12, 8), Spacing = 2 };
        if (projectsOpen && activeProject is null) ProjectList(list);
        else ChatList(list);
        var scroll = new ScrollViewer { Content = list, HorizontalScrollMode = ScrollMode.Disabled, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        Grid.SetRow(scroll, 1); side.Children.Add(scroll);
        var footer = new Grid { Padding = new Thickness(14, 4, 14, 6), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 1, 0, 0) };
        footer.ColumnDefinitions.Add(new ColumnDefinition());
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        footer.Children.Add(Kit.Line(14, Kit.TextAction("MCP", () => App.Open("me", "tools"), colour: "muted"),
            Kit.TextAction("个人指令", () => App.Open("me", "instructions"), colour: "muted")));
        if (activeProject is null)
        {
            var mind = Kit.TextAction("记忆", MemorySheet, colour: "muted");
            Grid.SetColumn(mind, 1); footer.Children.Add(mind);
        }
        Grid.SetRow(footer, 2); side.Children.Add(footer);
    }

    private void ChatList(StackPanel list)
    {
        var visible = chats.Where(chat => chat.ProjectId == activeProject && chat.Archived == showArchived).ToList();
        var pinned = visible.Where(chat => chat.Pinned).OrderByDescending(chat => chat.Updated).ToList();
        var groups = Chats.Groups(visible.Where(chat => !chat.Pinned).ToList(), DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        if (pinned.Count > 0) groups.Insert(0, ("置顶", pinned));
        foreach (var (name, group) in groups)
        {
            var h = Kit.Text(name, Role.Caption, "muted"); h.Margin = new Thickness(10, 12, 0, 4); list.Children.Add(h);
            foreach (var chat in group)
            {
                var on = chat.Id == current;
                var title = Kit.Text(Chats.TitleOf(chat.Title, chat.Thread), Role.Label);
                title.FontSize = 14; title.VerticalAlignment = VerticalAlignment.Center; title.TextTrimming = TextTrimming.CharacterEllipsis;
                var row = new Tap(on ? Paint.Faded("ink", .08) : Paint.Clear, on ? null : Paint.Brush("surfaceSunken")) { Content = title, Height = 36, Padding = new Thickness(10, 0, 10, 0), CornerRadius = new CornerRadius(10) };
                AutomationProperties.SetName(row, Chats.TitleOf(chat.Title, chat.Thread));
                var id = chat.Id;
                if (organizing)
                {
                    var marked = selectedChats.Contains(id);
                    if (marked) { title.Text = "✓  " + title.Text; row.Ground(Paint.Brush("surfaceSunken")); }
                    AutomationProperties.SetItemStatus(row, marked ? "已选择" : "未选择");
                    row.Click += (_, _) => { if (!selectedChats.Add(id)) selectedChats.Remove(id); DrawSide(); };
                    list.Children.Add(row);
                    continue;
                }
                row.Click += (_, _) => Open(id);
                var menu = new MenuFlyout();
                var rename = new MenuFlyoutItem { Text = "重命名" }; rename.Click += (_, _) => Rename(id); menu.Items.Add(rename);
                var pin = new MenuFlyoutItem { Text = chat.Pinned ? "取消置顶" : "置顶" };
                pin.Click += (_, _) => UpdateChat(chat with { Pinned = !chat.Pinned }); menu.Items.Add(pin);
                var archive = new MenuFlyoutItem { Text = chat.Archived ? "取消归档" : "归档" };
                archive.Click += (_, _) => UpdateChat(chat with { Archived = !chat.Archived }); menu.Items.Add(archive);
                if (!Bound(chat.ProjectId))
                {
                    var move = new MenuFlyoutItem { Text = "移动到项目" }; move.Click += (_, _) => MoveChats([id]); menu.Items.Add(move);
                    var remove = new MenuFlyoutItem { Text = "删除", Foreground = Paint.Brush("danger") }; remove.Click += (_, _) => Remove(id); menu.Items.Add(remove);
                }
                row.ContextFlyout = menu;
                list.Children.Add(row);
            }
        }
        if (visible.Count == 0)
        {
            var empty = showArchived ? "暂无归档对话" : "暂无对话";
            var none = Kit.Text(empty, Role.Label, "muted", wrap: true);
            none.Margin = new Thickness(10, 14, 10, 0); list.Children.Add(none);
        }
    }

    private void Rename(string id)
    {
        if (busy) return;
        var chat = chats.First(c => c.Id == id);
        var box = Kit.Field(Chats.TitleOf(chat.Title, chat.Thread), "对话名称", "对话名称");
        void Save() { App.Window?.Close(); UpdateChat(chat with { Title = BoundText(box.Text, 60) }); }
        box.KeyDown += (_, e) => { if (e.Key == Windows.System.VirtualKey.Enter) Save(); };
        var column = Kit.Column(14, Pages.SheetHead(Pages.SheetTitle("重命名"), () => App.Window?.Close()), box, Kit.Line(8, Pill("取消", () => App.Window?.Close()), Pill("保存", Save, true)));
        ((StackPanel)column.Children[2]).HorizontalAlignment = HorizontalAlignment.Right;
        column.Padding = new Thickness(22, 20, 22, 18);
        App.Window?.Sheet(column, 420);
    }
    private void Remove(string id)
    {
        if (busy) return;
        var removed = chats.FirstOrDefault(chat => chat.Id == id);
        if (removed is null || Bound(removed.ProjectId)) return;
        var provider = providers.Find(ModelProviders.RuntimeId);
        chats = chats.Where(c => c.Id != id).ToList(); keptProposals.Remove(id);
        if (current == id) Open(null);
        else { WriteChats(); Draw(); }
        if (providers.RuntimeEnabled && removed?.RuntimeModels is { Count: > 0 } && provider is { Key.Length: > 0 })
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
        if (compact) bar.Children.Add(Icon("打开侧栏", Icons.Note, () => { conversationsOpen = true; Draw(); }, 16));
        if (!blank) { var title = Kit.Text(Chats.TitleOf(chats.FirstOrDefault(c => c.Id == current)?.Title ?? "", thread), Role.Body, "ink"); title.FontWeight = FontWeights.Medium; title.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(title, 1); bar.Children.Add(title); }
        main.Children.Add(bar);

        var column = new StackPanel { Padding = new Thickness(18, 12, 18, 28) };
        var composer = Composer();
        if (blank)
        {
            var hello = new StackPanel { Spacing = 18, Padding = new Thickness(18, 0, 18, 60) };
            var name = projectFolder?.Name ?? projects.Find(activeProject)?.Name ?? "有什么可以帮你？";
            var h = Kit.Text(name, Role.Title, wrap: true);
            h.FontSize = 28; h.HorizontalAlignment = HorizontalAlignment.Center; h.TextAlignment = TextAlignment.Center;
            hello.Children.Add(h); hello.Children.Add(composer);
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


    private Tap ModelPicker()
    {
        var selected = providers.Find(choice.ProviderId);
        var picked = selected?.ModelName(choice.ModelId) ?? choice.ModelId;
        var runtimeOff = choice.ProviderId == ModelProviders.RuntimeId && !providers.RuntimeEnabled;
        var selection = runtimeOff ? "本机浏览器模型已关闭" : $"{selected?.Name ?? "服务商已移除"} · {picked}";
        var label = Kit.Text(runtimeOff ? selection : picked, Role.Label);
        label.MaxWidth = compact ? 168 : 285;
        label.TextTrimming = TextTrimming.CharacterEllipsis;
        var content = Kit.Line(6, label, Kit.Icon(Icons.Chevron, 13, "muted"));
        if (selected?.IsFree == true)
            content.Children.Insert(0, ModelSettings.FreeAvatar(16));
        content.VerticalAlignment = VerticalAlignment.Center;
        var button = new Tap(Paint.Clear, Paint.Brush("surfaceSunken"))
        { Content = content, MinHeight = 36, HorizontalAlignment = HorizontalAlignment.Left, Padding = new Thickness(10, 0, 10, 0), CornerRadius = new CornerRadius(10), IsEnabled = !busy };
        AutomationProperties.SetName(button, $"选择模型，当前 {selection}");
        AutomationProperties.SetAutomationId(button, "ai-provider");
        var description = assistant.FreeService.Description;
        var query = Kit.Field("", "搜索模型或服务商", "搜索模型或服务商");
        var rows = new StackPanel { Spacing = 2 };
        var list = new ScrollViewer { Content = rows, MaxHeight = 310, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        var menu = new Flyout { Placement = FlyoutPlacementMode.TopEdgeAlignedRight };
        var settings = Kit.TextAction("管理模型服务", () => { menu.Hide(); App.Open("me", "models"); }, colour: "ink");
        var panel = Kit.Column(6, Kit.SearchField(query), list, settings);
        panel.Width = compact ? 228 : 292;
        menu.Content = panel;

        void Update()
        {
            rows.Children.Clear();
            var text = query.Text.Trim();
            foreach (var provider in providers.Available)
            {
                var matches = provider.Models.Where(model => model.Enabled &&
                    (provider.Name.Contains(text, StringComparison.OrdinalIgnoreCase) ||
                        provider.ModelName(model.Id).Contains(text, StringComparison.OrdinalIgnoreCase))).ToList();
                if (matches.Count == 0) continue;
                var providerName = Kit.Text(provider.Name, Role.Caption, "muted");
                var header = provider.IsFree ? Kit.Line(6, ModelSettings.FreeAvatar(16), providerName) : Kit.Line(0, providerName);
                providerName.VerticalAlignment = VerticalAlignment.Center;
                header.Margin = new Thickness(8, 8, 8, 4);
                rows.Children.Add(header);
                foreach (var model in matches)
                {
                    var next = new ModelChoice(provider.Id, model.Id);
                    var modelName = provider.ModelName(model.Id);
                    var words = Kit.Column(1, Kit.Text(modelName, Role.Label));
                    if (provider.IsFree) words.Children.Add(Kit.Text(description, Role.Caption, "muted", wrap: true));
                    var values = new Grid { ColumnSpacing = 8 };
                    values.ColumnDefinitions.Add(new ColumnDefinition());
                    values.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                    values.Children.Add(provider.IsFree ? Kit.Line(8, ModelSettings.FreeAvatar(16), words) : words);
                    if (next == choice)
                    {
                        var tick = Kit.Text("✓", Role.Label); tick.VerticalAlignment = VerticalAlignment.Center;
                        Grid.SetColumn(tick, 1); values.Children.Add(tick);
                    }
                    var item = new Tap(next == choice ? Paint.Brush("surfaceSunken") : Paint.Clear, Paint.Brush("surfaceSunken"))
                    { Content = values, Padding = new Thickness(8, 5, 8, 5), MinHeight = 36, CornerRadius = new CornerRadius(8) };
                    AutomationProperties.SetName(item, modelName);
                    AutomationProperties.SetHelpText(item, provider.IsFree ? description : provider.Name);
                    if (next == choice) AutomationProperties.SetItemStatus(item, "已选择");
                    item.Click += (_, _) => { menu.Hide(); Choose(next); };
                    rows.Children.Add(item);
                }
            }
            if (rows.Children.Count == 0) rows.Children.Add(Kit.Text("没有匹配的模型", Role.Caption, "muted"));
        }
        query.TextChanged += (_, _) => Update();
        menu.Opened += (_, _) => query.Focus(FocusState.Programmatic);
        button.Click += (_, _) => { Update(); menu.ShowAt(button); };
        return button;
    }

    private Tap PermissionPicker()
    {
        var currentMode = ToolMenu.Modes.First(mode => mode.Id == toolAccess.Mode);
        var words = Kit.Text(currentMode.Label, Role.Label);
        words.VerticalAlignment = VerticalAlignment.Center;
        var caption = Kit.Line(6, words, Kit.Icon(Icons.Chevron, 13, "muted"));
        var button = new Tap(Paint.Clear, Paint.Brush("surfaceSunken"))
        { Content = caption, MinHeight = 36, Padding = new Thickness(8, 0, 8, 0), CornerRadius = new CornerRadius(10), HorizontalAlignment = HorizontalAlignment.Left, IsEnabled = !busy };
        AutomationProperties.SetName(button, $"工具权限，当前 {currentMode.Label}");
        AutomationProperties.SetHelpText(button, currentMode.Description);
        var menu = new MenuFlyout { Placement = FlyoutPlacementMode.TopEdgeAlignedLeft };
        foreach (var mode in ToolMenu.Modes)
        {
            var item = new ToggleMenuFlyoutItem { Text = mode.Label, IsChecked = mode.Id == currentMode.Id };
            AutomationProperties.SetHelpText(item, mode.Description);
            item.Click += (_, _) => toolAccess.SetMode(mode.Id);
            menu.Items.Add(item);
        }
        button.Click += (_, _) => menu.ShowAt(button);
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
        var rows = new StackPanel { Padding = new Thickness(8, 3, 8, 6) };
        var scroll = new ScrollViewer { Content = rows, MaxHeight = 230, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        var menu = new Border { Child = scroll, CornerRadius = new CornerRadius(12), Background = Paint.Brush("surfaceSunken"), Visibility = Visibility.Collapsed };
        var preferred = new ContentControl { HorizontalAlignment = HorizontalAlignment.Left, Visibility = Visibility.Collapsed };
        var suggestions = new List<ToolMenuItem>();
        bool dismissed = false;
        string? Query()
        {
            var text = box.Text.TrimStart();
            return !busy && !dismissed && text.StartsWith('/') && !text.Any(char.IsWhiteSpace) ? text[1..] : null;
        }
        void Go()
        {
            if (busy) { stop?.Cancel(); return; }
            if (menu.Visibility == Visibility.Visible) return;
            var question = box.Text.Trim().Length == 0 && draftTool is { AllowsEmpty: true } item ? item.Label : box.Text;
            Send(question, clearDraft: true, preferredTool: draftTool?.Name, skill: draftSkill?.Text);
        }
        send.Click += (_, _) => Go();
        void ChooseTool(ToolMenuItem item)
        {
            draftTool = item;
            box.Text = "";
            RefreshTools();
            box.Focus(FocusState.Programmatic);
        }
        void RefreshTools()
        {
            rows.Children.Clear();
            suggestions.Clear();
            var query = Query();
            menu.Visibility = query is null ? Visibility.Collapsed : Visibility.Visible;
            if (query is not null)
            {
                if (providers.Resolve(choice, out var provider) is null)
                {
                    foreach (var (group, items) in ToolMenu.For(ToolsFor(SituationNow(), provider), toolAccess.BrowserAvailable, externalMcp.Available))
                    {
                        var matches = items.Where(item => item.Label.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                            item.Name.Contains(query, StringComparison.OrdinalIgnoreCase)).ToList();
                        if (matches.Count == 0) continue;
                        var heading = Kit.Text(group, Role.Caption, "muted"); heading.Margin = new Thickness(6, 6, 6, 0);
                        rows.Children.Add(heading);
                        foreach (var item in matches)
                        {
                            suggestions.Add(item);
                            var action = Kit.TextAction(item.Label, () => ChooseTool(item), colour: "ink");
                            action.HorizontalAlignment = HorizontalAlignment.Stretch;
                            action.Padding = new Thickness(6, 2, 6, 2);
                            rows.Children.Add(action);
                        }
                    }
                }
                if (suggestions.Count == 0) rows.Children.Add(Kit.Text("没有可用的工具", Role.Caption, "muted"));
            }
            var selections = new WrapRow { Gap = 6 };
            if (draftTool is { } chosen)
            {
                var clear = Pill($"{chosen.Label}  ×", () => { draftTool = null; RefreshTools(); box.Focus(FocusState.Programmatic); });
                AutomationProperties.SetName(clear, $"移除已选工具 {chosen.Label}");
                selections.Children.Add(clear);
            }
            if (draftSkill is { } skill)
            {
                var clear = Pill($"{skill.Label}  ×", () => { draftSkill = null; RefreshTools(); box.Focus(FocusState.Programmatic); });
                AutomationProperties.SetName(clear, $"移除已选技能 {skill.Label}");
                selections.Children.Add(clear);
            }
            preferred.Visibility = selections.Children.Count == 0 ? Visibility.Collapsed : Visibility.Visible;
            preferred.Content = selections;
            send.Opacity = busy || query is null && (box.Text.Trim().Length > 0 || draftTool is { AllowsEmpty: true }) ? 1 : .18;
        }
        box.TextChanged += (_, _) => { draft = box.Text; dismissed = false; RefreshTools(); };
        RefreshTools();
        box.PreviewKeyDown += (_, e) =>
        {
            var shift = Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(Windows.System.VirtualKey.Shift).HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down);
            if (menu.Visibility == Visibility.Visible && e.Key == Windows.System.VirtualKey.Escape)
            { e.Handled = true; dismissed = true; RefreshTools(); return; }
            if (e.Key != Windows.System.VirtualKey.Enter || shift) return;
            e.Handled = true;
            if (menu.Visibility == Visibility.Visible && suggestions.Count > 0) ChooseTool(suggestions[0]);
            else Go();
        };
        var grid = new Grid { ColumnSpacing = 8, RowSpacing = 4 };
        grid.ColumnDefinitions.Add(new ColumnDefinition()); grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        Grid.SetColumnSpan(menu, 2); grid.Children.Add(menu);
        Grid.SetRow(box, 1); Grid.SetColumnSpan(box, 2); grid.Children.Add(box);
        Grid.SetRow(preferred, 2); Grid.SetColumnSpan(preferred, 2); grid.Children.Add(preferred);
        var toolbar = new Grid { ColumnSpacing = 6 };
        toolbar.ColumnDefinitions.Add(new ColumnDefinition());
        toolbar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        toolbar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        toolbar.Children.Add(PermissionPicker());
        var model = ModelPicker(); Grid.SetColumn(model, 1); toolbar.Children.Add(model);
        Grid.SetColumn(send, 2); toolbar.Children.Add(send);
        Grid.SetRow(toolbar, 3); Grid.SetColumnSpan(toolbar, 2); grid.Children.Add(toolbar);
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
            var steps = Steps.Of(calls.Select(c => new Call((string)c["id"]!, (string)c["function"]!["name"]!, (string)c["function"]!["arguments"]!)).ToList(), results,
                name => toolAccess.Catalogue.FirstOrDefault(tool => tool.Alias == name)?.Title ??
                    externalMcp.Servers.SelectMany(externalMcp.Catalogue).FirstOrDefault(tool => tool.Alias == name)?.Title);
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
        if (busy) return;
        try { ReloadProjectMemory(); }
        catch (Exception failure) when (ProjectFolder.IsProblem(failure))
        { App.Window?.Close(); projectStatus = ProjectMessage(failure, "未能读取项目记忆。"); Draw(); return; }
        var project = activeProject is not null;
        var observed = projectMemory;
        var label = project ? "项目记忆" : "记忆";
        var on = memory.On;
        var text = new TextBox { Text = System.Text.RegularExpressions.Regex.Replace(ActiveMemory, "^- ", "", System.Text.RegularExpressions.RegexOptions.Multiline), AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 140, MaxLength = Memory.Limit,
            FontSize = 14.5, PlaceholderText = "一行一件，比如：\n通信工程专业，在准备考研\n喜欢早上学习", BorderThickness = new Thickness(0), Background = Paint.Clear, Padding = new Thickness(14, 12, 14, 4) };
        text.Resources["TextControlBackgroundFocused"] = Paint.Clear; text.Resources["TextControlBorderBrushFocused"] = Paint.Clear; text.Resources["TextControlBackgroundPointerOver"] = Paint.Clear;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(text, label);
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
                var count = ActiveMemory.Split('\n').Count(l => l.Trim().Length > 0);
                body.Children.Add(new Border { CornerRadius = new CornerRadius(12), Background = Paint.Brush("surfaceSunken"), Padding = new Thickness(16), Child = Kit.Text($"记忆已关闭，AI 看不到这些内容，也不再记新的。{(count > 0 ? $"记着的 {count} 件事还在，打开就接着用。" : "")}", Role.Label, "muted", wrap: true) });
            }
        }
        var head = new Grid { ColumnSpacing = 16 };
        head.ColumnDefinitions.Add(new ColumnDefinition()); head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var summary = project ? "AI 在这个项目里用这里的记忆。" : "AI 记下你的专业、习惯和偏好，回答会越来越贴合你。";
        head.Children.Add(Kit.Column(4, Pages.SheetTitle(label), Kit.Text(summary, Role.Label, "muted", wrap: true)));
        var switchHost = new Border(); Grid.SetColumn(switchHost, 1); head.Children.Add(switchHost);
        void Switch() { switchHost.Child = Kit.Switch(on, next => { on = next; Switch(); Fill(); }, "使用记忆"); }
        Switch();
        column.Children.Add(head); column.Children.Add(body); Fill();
        text.TextChanged += (_, _) => { if (body.Children.FirstOrDefault() is Border b && b.Child is StackPanel s && s.Children[1] is TextBlock foot) { var n = text.Text.Split('\n').Count(l => l.Trim().Length > 0); foot.Text = n > 0 ? $"记着 {n} 件事" : "聊天时说“记住……”，AI 也会写进来"; } };
        column.Children.Add(Kit.Text(project
            ? "项目记忆从本机编辑，绑定文件夹后随项目文件保存。开启记忆后，提问时会发送给所选模型。"
            : "未登录时保存在本机；登录后记忆随账号同步。开启记忆后，提问时会发送给所选模型。", Role.Caption, "muted", wrap: true));
        var status = Kit.Text("", Role.Caption, "danger", wrap: true);
        column.Children.Add(status);
        var buttons = new Grid { ColumnSpacing = 8 };
        buttons.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); buttons.ColumnDefinitions.Add(new ColumnDefinition()); buttons.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); buttons.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var clear = new Tap { Content = Kit.Text("全部清空", Role.Label, "muted"), VerticalAlignment = VerticalAlignment.Center }; clear.Click += (_, _) => text.Text = "";
        buttons.Children.Add(clear);
        var cancel = Pill("取消", () => App.Window?.Close()); Grid.SetColumn(cancel, 2); buttons.Children.Add(cancel);
        var save = Pill("保存", () =>
        {
            var kept = string.Join("\n", text.Text.Split('\n').Select(l => l.Trim()).Where(l => l.Length > 0).Select(l => $"- {l}"));
            if (kept.Length > Memory.Limit) { status.Text = "记忆太长，请先删减。"; return; }
            try
            {
                if (project && on && kept != ActiveMemory) WriteProjectMemory(kept, observed);
                if (!project || on != memory.On) memory = (on, on && !project ? kept : memory.Text);
                App.Window?.Close(); DrawSide();
            }
            catch (Exception failure) when (ProjectFolder.IsProblem(failure)) { status.Text = ProjectMessage(failure, "未能保存记忆。"); }
        }, true);
        Grid.SetColumn(save, 3); buttons.Children.Add(save);
        column.Children.Add(buttons);
        App.Window?.Sheet(column, 460);
    }

    /** Signing in for the free quota; the question waits and is asked once signed in. */
}
