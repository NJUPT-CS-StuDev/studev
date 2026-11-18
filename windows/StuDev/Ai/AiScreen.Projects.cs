using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Windows.Storage.Pickers;
using StuDev.Data;
using StuDev.Ui;

namespace StuDev.Ai;

public sealed partial class AiScreen
{
    private readonly Projects projects = Projects.Shared;
    private ProjectFolder? projectFolder;
    private readonly Dictionary<string, ProjectChat> projectHeads = new(StringComparer.Ordinal);
    private string? activeProject;
    private string? projectMemory;
    private string? projectStatus;
    private bool showArchived;
    private bool organizing;
    private bool projectsOpen;
    private readonly HashSet<string> selectedChats = new(StringComparer.Ordinal);
    private (string Label, string Text)? draftSkill;

    private bool Bound(string? id) => projects.Find(id)?.Folder is not null;

    private void ReadProject()
    {
        chats.RemoveAll(chat => Bound(chat.ProjectId));
        projectHeads.Clear(); projectFolder = null; projectStatus = null; projectMemory = null;
        if (projects.Find(activeProject) is not { } project) return;
        try
        {
            if (project.Folder is not { } path)
            {
                projectMemory = Storage.Read(LocalMemory(project.Id));
                return;
            }
            var folder = ProjectFolder.Open(path);
            if (folder.Id != project.Id) throw new IOException("项目文件夹已对应其他项目，请重新选择。");
            var loaded = new List<SavedChat>();
            var heads = new Dictionary<string, ProjectChat>(StringComparer.Ordinal);
            foreach (var group in folder.Heads().GroupBy(chat => chat.Id))
            {
                if (group.Skip(1).Any()) projectStatus = "有对话在另一端同时修改，原版本均已保留。";
                var newest = group.OrderByDescending(chat => (long)chat.Document["updated"]!).ThenBy(chat => chat.BaseName, StringComparer.Ordinal).First();
                var chat = SavedChat.OfProject(newest.Document, project.Id);
                if (chats.Any(local => local.Id == chat.Id))
                {
                    projectStatus = "本机和项目文件夹有同一对话，请先整理其原始位置。";
                    continue;
                }
                keptProposals[chat.Id] = ReadProposals(newest.Document);
                loaded.Add(chat); heads.Add(chat.Id, newest);
            }
            projectMemory = folder.Memory();
            projectFolder = folder;
            chats.AddRange(loaded);
            foreach (var entry in heads) projectHeads.Add(entry.Key, entry.Value);
        }
        catch (Exception failure) when (ProjectFolder.IsProblem(failure)) { projectStatus = ProjectMessage(failure, "项目文件夹暂时无法读取。"); }
    }

    private static string ProjectMessage(Exception failure, string otherwise) =>
        failure is IOException && failure.Message.Any(ch => ch is >= '\u4e00' and <= '\u9fff') ? failure.Message : otherwise;

    private void EnterProject(string? id)
    {
        if (busy) return;
        if (activeProject != id) draft = "";
        activeProject = id; showArchived = false; organizing = false; selectedChats.Clear();
        ReadProject(); Open(null);
    }

    private static List<TaskProposal> ReadProposals(JsonObject doc) =>
        doc["proposals"] is JsonArray list ? list.Deserialize(StorageJson.Default.ListTaskProposal) ?? [] : [];

    private JsonObject SharedChat(SavedChat chat)
    {
        var draftRecords = JsonSerializer.SerializeToNode(keptProposals.GetValueOrDefault(chat.Id) ?? [], StorageJson.Default.ListTaskProposal)!.AsArray();
        foreach (var draft in draftRecords.OfType<JsonObject>())
        {
            if (draft["task"] is not JsonObject task) continue;
            task.Remove("id"); task.Remove("modified");
        }
        return chat.ToProjectJson(draftRecords);
    }

    private bool PersistProjectChat(SavedChat chat)
    {
        if (!Bound(chat.ProjectId)) return true;
        try
        {
            if (projectFolder is not { } folder || folder.Id != chat.ProjectId) throw new IOException("请重新打开这个项目文件夹。");
            var document = SharedChat(chat);
            var previous = projectHeads.GetValueOrDefault(chat.Id);
            if (previous is not null && SameSnapshot(previous.Document, document)) return true;
            projectHeads[chat.Id] = folder.SaveChat(document, previous);
            return true;
        }
        catch (Exception failure) when (ProjectFolder.IsProblem(failure))
        {
            projectStatus = ProjectMessage(failure, "未能保存项目对话，文件夹里的原版本已保留。");
            return false;
        }
    }

    private static bool SameSnapshot(JsonObject onDisk, JsonObject asked)
    {
        var content = onDisk.DeepClone().AsObject();
        content.Remove("previous"); content.Remove("version");
        return JsonNode.DeepEquals(content, asked);
    }

    private void UpdateChat(SavedChat changed)
    {
        if (busy || !PersistProjectChat(changed)) { Draw(); return; }
        chats = chats.Select(chat => chat.Id == changed.Id && chat.ProjectId == changed.ProjectId ? changed : chat).ToList();
        if (!Bound(changed.ProjectId)) WriteChats();
        Draw();
    }

    private string? CombinedInstructions(string? skill)
    {
        var blocks = new List<string>();
        if (!string.IsNullOrWhiteSpace(skill)) blocks.Add("本轮指定的项目技能\n" + BoundText(skill, 4000));
        if (activeProject is { } id)
        {
            var available = 8000 - blocks.Sum(block => block.Length + 2) - "项目指令\n".Length;
            var project = BoundText(Bound(id)
                ? (projectFolder ?? throw new IOException("请重新打开这个项目文件夹。")).Instructions()
                : Storage.Read(LocalInstructions(id)), available);
            if (project.Length > 0) blocks.Insert(0, "项目指令\n" + project);
        }
        var personalBudget = Math.Min(4000, 12000 - blocks.Sum(block => block.Length + 2) - "个人指令\n".Length);
        var personal = BoundText(PersonalInstructions.Read(), personalBudget);
        if (personal.Length > 0) blocks.Insert(0, "个人指令\n" + personal);
        return blocks.Count == 0 ? null : string.Join("\n\n", blocks);
    }

    private static string BoundText(string? value, int limit)
    {
        var text = value?.Trim() ?? "";
        if (text.Length <= limit) return text;
        return text[..(char.IsHighSurrogate(text[limit - 1]) ? limit - 1 : limit)];
    }
    private static string LocalInstructions(string id) => $"ai/projects/{id}/AGENTS.md";
    private static string LocalMemory(string id) => $"ai/projects/{id}/memory.md";
    private string ActiveMemory => activeProject is null ? memory.Text : projectMemory ?? "";

    private void ReloadProjectMemory()
    {
        if (activeProject is not { } id) return;
        projectMemory = Bound(id)
            ? (projectFolder ?? throw new IOException("请重新打开这个项目文件夹。")).Memory()
            : Storage.Read(LocalMemory(id));
    }

    private void WriteProjectMemory(string text, string? observed)
    {
        if (activeProject is not { } id) return;
        if (Bound(id)) (projectFolder ?? throw new IOException("请重新打开这个项目文件夹。")).SaveMemory(text, observed);
        else
        {
            var file = LocalMemory(id);
            if (Storage.Read(file) != observed) throw new IOException("项目记忆刚刚更新，请重新打开。");
            Storage.Write(Storage.PathFor(file), text);
        }
        projectMemory = text;
    }

    private static async Task<string?> PickFolder(string title)
    {
        if (App.Window is not { } window) return null;
        var picker = new FolderPicker(window.AppWindow.Id) { Title = title };
        return (await picker.PickSingleFolderAsync())?.Path;
    }

    private void SideNavigation(StackPanel heading)
    {
        var currentProject = projects.Find(activeProject);
        var row = new Grid { ColumnSpacing = 5, Margin = new Thickness(12, 0, 12, 0) };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition());
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        if (currentProject is null)
        {
            var tabs = Kit.Tabs([("chats", "对话"), ("projects", "项目")], projectsOpen ? "projects" : "chats", selected =>
            {
                projectsOpen = selected == "projects";
                organizing = false; selectedChats.Clear(); showArchived = false;
                DrawSide();
            }, gap: 24);
            Grid.SetColumnSpan(tabs, 2); row.Children.Add(tabs);
        }
        else
        {
            var back = Icon("返回项目列表", Icons.Back, () => { projectsOpen = true; EnterProject(null); }, 16, !busy);
            row.Children.Add(back);
            var title = Kit.Text(projectFolder?.Name ?? currentProject.Name, Role.Body, bold: true);
            title.TextTrimming = TextTrimming.CharacterEllipsis;
            title.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetColumn(title, 1); row.Children.Add(title);
        }

        var menu = new MenuFlyout();
        void Option(string label, Action pick)
        {
            var item = new MenuFlyoutItem { Text = label };
            item.Click += (_, _) => pick();
            menu.Items.Add(item);
        }
        if (currentProject is null && projectsOpen)
            Option("打开项目文件夹", () => App.Watch(OpenProjectFolder()));
        if (currentProject is not null)
            Option("项目设置", () => EditProject(currentProject));
        if (projectFolder is not null || currentProject?.Attachments.Count > 0)
            Option("选择技能", PickSkill);
        if (currentProject is not null || !projectsOpen)
        {
            if (!Bound(activeProject) && !showArchived && chats.Any(chat => chat.ProjectId == activeProject && !chat.Archived))
                Option("批量移动", () => { organizing = true; selectedChats.Clear(); DrawSide(); });
            Option(showArchived ? "查看对话" : "已归档", () =>
            {
                showArchived = !showArchived; organizing = false; selectedChats.Clear(); DrawSide();
            });
        }
        Tap? more = null;
        more = Icon(currentProject is null ? projectsOpen ? "更多项目操作" : "更多对话操作" : "更多项目操作",
            Icons.More, () => menu.ShowAt(more!), 16, !busy);
        more.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(more, 2); row.Children.Add(more);
        heading.Children.Add(row);

        if (organizing || showArchived)
        {
            var tools = Kit.Line(12, Kit.TextAction(organizing ? "取消选择" : "返回对话",
                () => { showArchived = false; organizing = false; selectedChats.Clear(); DrawSide(); }, colour: "muted"));
            tools.Margin = new Thickness(16, 0, 12, 0);
            if (organizing && selectedChats.Count > 0)
                tools.Children.Add(Kit.TextAction($"移动 {selectedChats.Count} 项", () => MoveChats([.. selectedChats]), colour: "brand"));
            heading.Children.Add(tools);
        }
        if (projectStatus is { } status)
        {
            var feedback = Kit.Text(status, Role.Caption, "muted", wrap: true);
            feedback.Margin = new Thickness(16, 4, 12, 8);
            heading.Children.Add(feedback);
        }
    }

    private void ProjectList(StackPanel list)
    {
        foreach (var project in projects.All)
        {
            var label = Kit.Text(project.Name, Role.Label);
            label.VerticalAlignment = VerticalAlignment.Center; label.TextTrimming = TextTrimming.CharacterEllipsis;
            var body = new Grid { ColumnSpacing = 9 };
            body.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            body.ColumnDefinitions.Add(new ColumnDefinition());
            body.Children.Add(Kit.Icon(Icons.Folder, 16, project.Folder is null ? "muted" : "brand", 20));
            Grid.SetColumn(label, 1); body.Children.Add(label);
            var row = new Tap(Paint.Clear, Paint.Brush("surfaceSunken"))
            { Content = body, Height = 36, Padding = new Thickness(10, 0, 10, 0), CornerRadius = new CornerRadius(9), IsEnabled = !busy };
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(row, project.Name);
            row.Click += (_, _) => EnterProject(project.Id);
            list.Children.Add(row);
        }
        var add = Kit.TextAction("新建项目", () => EditProject(null), Icons.Plus);
        add.Margin = new Thickness(8, 2, 0, 4);
        add.IsEnabled = !busy;
        list.Children.Add(add);
    }

    private async Task OpenProjectFolder()
    {
        if (busy) return;
        try
        {
            if (await PickFolder("打开 StuDev 项目文件夹") is not { } path || busy) return;
            var folder = ProjectFolder.Open(path);
            var known = projects.Find(folder.Id);
            if (known is not null && known.Folder is null && chats.Any(chat => chat.ProjectId == folder.Id))
                throw new IOException("已有同一项目的本机对话。请从项目设置绑定文件夹以保留对话。");
            projects.Put(new(folder.Id, folder.Name, folder.Course, folder.Root, known?.Attachments ?? []));
            EnterProject(folder.Id);
        }
        catch (Exception failure) when (ProjectFolder.IsProblem(failure))
        { projectStatus = ProjectMessage(failure, "未能打开项目文件夹。"); Draw(); }
    }

    private void EditProject(AiProject? project)
    {
        if (busy) return;
        var existing = project is null ? null : projects.Find(project.Id);
        if (project is not null && existing is null) return;
        var resolved = existing is not null && existing.Id == projectFolder?.Id ? projectFolder : null;
        var name = Kit.Field(resolved?.Name ?? existing?.Name ?? "", "填写项目名称", "项目名称");
        name.MaxLength = 100;
        var course = Kit.Field(resolved?.Course ?? existing?.Course ?? "", "选填，课程名称或代码", "关联课程");
        course.MaxLength = 120;
        var status = Kit.Text("", Role.Caption, "danger", wrap: true);
        var body = Kit.Column(10, Pages.SheetHead(Pages.SheetTitle(existing is null ? "新建项目" : "项目设置"), () => App.Window?.Close()),
            Kit.Column(4, Kit.Text("项目名称", Role.Caption, "muted"), name),
            Kit.Column(4, Kit.Text("关联课程", Role.Caption, "muted"), course));
        body.Padding = new Thickness(22, 20, 22, 18);
        if (existing is not null)
        {
            body.Children.Add(Kit.Hairline());
            var folders = Kit.Column(4, Kit.Text("文件夹", Role.Label, bold: true));
            var folderActions = new WrapRow { Gap = 14 };
            if (existing.Folder is { } path)
            {
                folders.Children.Add(Kit.Text("主目录 · " + path, Role.Caption, "muted", wrap: true));
                if (resolved is not null) folderActions.Children.Add(Kit.TextAction("项目文件",
                    () => new ProjectFiles(resolved, true, () => EditProject(existing)).Show(), colour: "ink"));
                folderActions.Children.Add(Kit.TextAction("重读项目文件", () =>
                {
                    App.Window?.Close();
                    var openChat = current;
                    ReadProject(); Open(openChat);
                }, colour: "muted"));
            }
            else
            {
                folders.Children.Add(Kit.Text("尚未绑定主目录", Role.Caption, "muted"));
                folderActions.Children.Add(Kit.TextAction("绑定文件夹", () => App.Watch(BindProject(existing)), colour: "ink"));
            }
            folderActions.Children.Add(Kit.TextAction("附加文件夹", () => App.Watch(AttachFolder(existing)), colour: "ink"));
            folders.Children.Add(folderActions);
            if (existing.Attachments.Count > 0) folders.Children.Add(Kit.Text("参考目录", Role.Caption, "muted"));
            foreach (var attachment in existing.Attachments)
            {
                var referenceActions = new WrapRow { Gap = 14 };
                referenceActions.Children.Add(
                    Kit.TextAction("查看参考文件", () =>
                    {
                        try { new ProjectFiles(ProjectFolder.OpenReference(attachment), false, () => EditProject(existing)).Show(); }
                        catch (Exception failure) when (ProjectFolder.IsProblem(failure)) { status.Text = "暂时无法读取参考文件夹。"; }
                    }, colour: "ink"));
                referenceActions.Children.Add(
                    Kit.TextAction("取消授权", () =>
                    {
                        var updated = existing with { Attachments = existing.Attachments.Where(item => item != attachment).ToList() };
                        projects.Put(updated); EditProject(updated);
                    }, colour: "muted"));
                folders.Children.Add(Kit.Column(1, Kit.Text(attachment, Role.Caption, wrap: true), referenceActions));
            }
            body.Children.Add(folders);
            body.Children.Add(Kit.Hairline());
            body.Children.Add(Kit.Column(2, Kit.Text("指令与记忆", Role.Label, bold: true),
                Kit.Line(14, Kit.TextAction("编辑项目指令", () => EditProjectInstructions(existing), colour: "ink"),
                    Kit.TextAction("项目记忆", MemorySheet, colour: "ink"))));
        }
        body.Children.Add(status);
        var save = Kit.Action("保存", () =>
        {
            if (name.Text.Trim().Length == 0) { status.Text = "请输入项目名称。"; return; }
            try
            {
                var updated = new AiProject(existing?.Id ?? Guid.NewGuid().ToString(), name.Text.Trim(), course.Text.Trim(), existing?.Folder, existing?.Attachments ?? []);
                if (updated.Folder is not null)
                {
                    if (resolved is null) throw new IOException("请重新打开项目文件夹后再修改。");
                    resolved.Rename(updated.Name, updated.Course);
                }
                projects.Put(updated);
                App.Window?.Close();
                if (existing is null) EnterProject(updated.Id); else Draw();
            }
            catch (Exception failure) when (ProjectFolder.IsProblem(failure)) { status.Text = ProjectMessage(failure, "未能保存项目。"); }
        }, true);
        save.HorizontalAlignment = HorizontalAlignment.Right;
        body.Children.Add(save);
        App.Window?.Sheet(body, 480);
    }

    private async Task BindProject(AiProject project)
    {
        try
        {
            if (await PickFolder("选择存放项目和对话的文件夹") is not { } path || busy) return;
            var folder = ProjectFolder.Open(path, project);
            var localInstructions = Storage.Read(LocalInstructions(project.Id));
            if (localInstructions is not null)
            {
                var observed = folder.Instructions();
                if (observed is null) folder.SaveInstructions(localInstructions, null);
                else if (observed != localInstructions) throw new IOException("项目文件夹已有不同的 AGENTS.md。请保留并核对后再绑定。");
            }
            var localMemory = Storage.Read(LocalMemory(project.Id));
            if (!string.IsNullOrWhiteSpace(localMemory))
            {
                var observed = folder.Memory();
                if (observed is null) folder.SaveMemory(localMemory, null);
                else if (observed != localMemory) throw new IOException("项目文件夹已有不同的项目记忆，请核对后再绑定。");
            }
            foreach (var chat in chats.Where(chat => chat.ProjectId == project.Id)) ImportChat(folder, chat);
            projects.Put(project with { Folder = folder.Root });
            App.Window?.Close(); EnterProject(project.Id);
            if (localInstructions is not null && Storage.Read(LocalInstructions(project.Id)) == localInstructions)
            {
                try { File.Delete(Storage.PathFor(LocalInstructions(project.Id))); }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
            if (!string.IsNullOrWhiteSpace(localMemory) && Storage.Read(LocalMemory(project.Id)) == localMemory)
            {
                try { File.Delete(Storage.PathFor(LocalMemory(project.Id))); }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
        }
        catch (Exception failure) when (ProjectFolder.IsProblem(failure))
        { App.Window?.Close(); projectStatus = ProjectMessage(failure, "未能绑定文件夹。"); Draw(); }
    }

    private async Task AttachFolder(AiProject project)
    {
        try
        {
            if (await PickFolder("授权项目访问另一个文件夹") is not { } path || busy) return;
            var folder = Path.TrimEndingDirectorySeparator(Path.GetFullPath(path));
            var updated = project with { Attachments = [.. project.Attachments.Where(item => !item.Equals(folder, StringComparison.OrdinalIgnoreCase)), folder] };
            projects.Put(updated); EditProject(updated);
        }
        catch (Exception failure) when (ProjectFolder.IsProblem(failure)) { App.Window?.Close(); projectStatus = "未能附加文件夹。"; Draw(); }
    }

    private void EditProjectInstructions(AiProject project)
    {
        try
        {
            var folder = project.Folder is null ? null : projectFolder ?? throw new IOException("请重新打开项目文件夹。");
            var observed = folder is null ? Storage.Read(LocalInstructions(project.Id)) : folder.Instructions();
            if (observed is { Length: > 8000 }) throw new IOException("项目指令超过 8000 字，请先在文件中整理。");
            var box = Kit.Field(observed ?? "", "写下这个项目里的要求", "项目指令");
            box.MaxLength = 8000; box.AcceptsReturn = true; box.TextWrapping = TextWrapping.Wrap; box.MinHeight = 180;
            var status = Kit.Text("", Role.Caption, "danger", wrap: true);
            var save = Kit.Action("保存", () =>
            {
                try
                {
                    if (folder is not null) folder.SaveInstructions(box.Text, observed);
                    else Storage.Write(Storage.PathFor(LocalInstructions(project.Id)), box.Text);
                    EditProject(project);
                }
                catch (Exception failure) when (ProjectFolder.IsProblem(failure)) { status.Text = ProjectMessage(failure, "未能保存项目指令。"); }
            }, true);
            save.HorizontalAlignment = HorizontalAlignment.Right;
            var body = Kit.Column(10, Pages.SheetHead(Pages.SheetTitle("项目指令"), () => EditProject(project)), box, status, save);
            body.Padding = new Thickness(22, 20, 22, 18);
            App.Window?.Sheet(body, 510);
        }
        catch (Exception failure) when (ProjectFolder.IsProblem(failure))
        { App.Window?.Close(); projectStatus = ProjectMessage(failure, "未能打开项目指令。"); Draw(); }
    }

    private void PickSkill()
    {
        if (busy || projects.Find(activeProject) is not { } project) return;
        var body = Kit.Column(6, Pages.SheetHead(Pages.SheetTitle("选择项目技能"), () => App.Window?.Close()));
        body.Padding = new Thickness(22, 20, 22, 18);
        void Add(string label, Func<string?> read)
        {
            body.Children.Add(Kit.TextAction(label, () =>
            {
                try
                {
                    var text = BoundText(read(), 4000);
                    if (text.Length == 0) throw new IOException("技能文件没有可用内容。");
                    draftSkill = (label, text); App.Window?.Close(); DrawMain();
                }
                catch (Exception failure) when (ProjectFolder.IsProblem(failure))
                { App.Window?.Close(); projectStatus = ProjectMessage(failure, "未能读取技能。"); Draw(); }
            }, colour: "ink"));
        }
        try
        {
            if (projectFolder is { } folder)
                foreach (var skill in folder.Skills()) Add(skill.Label, () => folder.ReadSkill(skill.Path));
            foreach (var attachment in project.Attachments)
                foreach (var skill in ProjectFolder.AttachedSkills(attachment)) Add(skill.Label, skill.Read);
            if (body.Children.Count == 1) body.Children.Add(Kit.Text("这个项目暂无技能。", Role.Label, "muted"));
        }
        catch (Exception failure) when (ProjectFolder.IsProblem(failure)) { body.Children.Add(Kit.Text("未能读取项目技能目录。", Role.Label, "muted")); }
        App.Window?.Sheet(body, 420);
    }

    private void MoveChats(List<string> ids)
    {
        if (busy || Bound(activeProject)) return;
        var sources = chats.Where(chat => ids.Contains(chat.Id) && chat.ProjectId == activeProject).ToList();
        if (sources.Count == 0) return;
        var body = Kit.Column(8, Pages.SheetHead(Pages.SheetTitle("移动到项目"), () => App.Window?.Close()));
        body.Padding = new Thickness(22, 20, 22, 18);
        var failure = Kit.Text("", Role.Caption, "danger", wrap: true);
        foreach (var target in projects.All.Where(project => project.Id != activeProject))
            body.Children.Add(Kit.TextAction(target.Name, () =>
            {
                try
                {
                    if (target.Folder is { } path)
                    {
                        var folder = ProjectFolder.Open(path);
                        if (folder.Id != target.Id) throw new IOException("目标文件夹已对应其他项目。");
                        foreach (var chat in sources) ImportChat(folder, chat);
                    }
                    var before = chats;
                    chats = chats.Select(chat => sources.Contains(chat) ? chat with { ProjectId = target.Id } : chat).ToList();
                    try { WriteChats(); } catch { chats = before; throw; }
                    if (sources.Any(chat => chat.Id == current)) Open(null);
                    if (target.Folder is not null) chats.RemoveAll(chat => chat.ProjectId == target.Id);
                    organizing = false; selectedChats.Clear(); App.Window?.Close(); Draw();
                }
                catch (Exception error) when (ProjectFolder.IsProblem(error)) { failure.Text = ProjectMessage(error, "未能移动对话，原对话仍在。"); }
            }, colour: "ink"));
        if (body.Children.Count == 1) body.Children.Add(Kit.Text("暂无其他项目。", Role.Label, "muted"));
        body.Children.Add(failure);
        App.Window?.Sheet(body, 440);
    }

    private void ImportChat(ProjectFolder target, SavedChat chat)
    {
        var document = SharedChat(chat);
        var existing = target.Heads(chat.Id);
        if (existing.Count == 1 && SameSnapshot(existing[0].Document, document)) return;
        target.SaveChat(document, null);
    }
}
