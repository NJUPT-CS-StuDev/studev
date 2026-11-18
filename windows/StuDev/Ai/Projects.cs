using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using StuDev.Data;

namespace StuDev.Ai;

internal sealed record AiProject(string Id, string Name, string? Course, string? Folder, List<string> Attachments);

/** The device keeps only local project data and folder grants. A bound folder owns its shared project and chats. */
internal sealed class Projects
{
    private const string Index = "ai/projects.json";
    public static readonly Projects Shared = new();
    public List<AiProject> All { get; private set; } = [];

    private Projects()
    {
        if (Storage.Read(Index) is not { } text) return;
        foreach (var value in JsonNode.Parse(text)!.AsArray().OfType<JsonObject>())
        {
            var id = (string)value["id"]!;
            if (!ProjectFolder.IsId(id)) continue;
            var folder = (string?)value["folder"];
            var name = (string?)value["name"] ?? "";
            var course = (string?)value["course"];
            if (folder is not null)
            {
                try
                {
                    var bound = ProjectFolder.Open(folder);
                    if (bound.Id == id) { name = bound.Name; course = bound.Course; }
                }
                catch (Exception error) when (ProjectFolder.IsProblem(error)) { }
                if (name.Length == 0) name = Path.GetFileName(folder);
            }
            All.Add(new(id, name, course, folder, value["attachments"] is JsonArray items
                ? items.Select(item => (string)item!).ToList() : []));
        }
    }

    public AiProject? Find(string? id) => All.FirstOrDefault(project => project.Id == id);

    public void Put(AiProject project)
    {
        var next = All.Where(old => old.Id != project.Id).Append(project).ToList();
        Storage.Write(Storage.PathFor(Index), new JsonArray([.. next.Select(Record)]).ToJsonString());
        All = next;
    }

    private static JsonNode Record(AiProject project)
    {
        var value = new JsonObject { ["id"] = project.Id };
        if (project.Folder is not null) value["folder"] = project.Folder;
        else
        {
            value["name"] = project.Name;
            if (project.Course is { Length: > 0 } course) value["course"] = course;
        }
        if (project.Attachments.Count > 0) value["attachments"] = new JsonArray([.. project.Attachments.Select(a => (JsonNode)JsonValue.Create(a)!)]);
        return value;
    }
}

internal sealed record ProjectChat(string BaseName, string Raw, JsonObject Document)
{
    public string Id => (string)Document["id"]!;
}

/** Shared Windows/desktop-browser files. New immutable chat heads preserve concurrent edits. */
internal sealed class ProjectFolder
{
    private const int TextLimit = 262_144;
    private const int ChatLimit = 32 * 1024 * 1024;
    private readonly string root;
    private readonly string workspace;
    private readonly string manifest;
    private readonly string chatFolder;
    private string rawManifest = "";
    public string Id { get; private set; } = "";
    public string Name { get; private set; } = "";
    public string? Course { get; private set; }
    public string Root => root;
    public static bool IsId(string id) => Guid.TryParseExact(id, "D", out var uuid) && uuid.ToString() == id;
    public static bool IsProblem(Exception error) => error is IOException or UnauthorizedAccessException or JsonException or InvalidOperationException or ArgumentException;
    private static bool IsRevision(string value, string id) => value == id ||
        value.StartsWith(id + ".", StringComparison.Ordinal) && IsId(value[(id.Length + 1)..]);

    private ProjectFolder(string path)
    {
        root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(path));
        if (!Directory.Exists(root)) throw new IOException("项目文件夹无法访问。");
        Guard(root);
        workspace = Path.Combine(root, ".studev");
        manifest = Path.Combine(workspace, "project.json");
        chatFolder = Path.Combine(workspace, "chats");
    }

    public static ProjectFolder Open(string path, AiProject? initialize = null)
    {
        var folder = new ProjectFolder(path);
        var raw = folder.Read(folder.manifest, 16_384);
        if (raw is null)
        {
            if (initialize is null) throw new IOException("这个文件夹没有 StuDev 项目。");
            var created = Manifest(initialize.Id, initialize.Name, initialize.Course);
            folder.Replace(folder.manifest, created, null);
            raw = created;
        }
        folder.LoadManifest(raw);
        if (initialize is not null && folder.Id != initialize.Id) throw new IOException("该文件夹属于另一个项目，请从「打开项目」进入。");
        return folder;
    }

    private static string Manifest(string id, string name, string? course)
    {
        var value = new JsonObject { ["version"] = 1, ["id"] = id, ["name"] = name };
        if (course is { Length: > 0 }) value["course"] = course;
        return value.ToJsonString();
    }

    private void LoadManifest(string raw)
    {
        var value = JsonNode.Parse(raw) as JsonObject;
        if (value is null || (int?)value["version"] != 1 || (string?)value["id"] is not { } id || !IsId(id) ||
            (string?)value["name"] is not { Length: > 0 } name) throw new IOException("项目文件格式有误，原文件已保留。");
        rawManifest = raw; Id = id; Name = name; Course = (string?)value["course"];
    }

    public void Rename(string name, string? course)
    {
        var updated = Manifest(Id, name, course);
        Replace(manifest, updated, rawManifest);
        LoadManifest(updated);
    }

    public string? Instructions() => Read(Path.Combine(root, "AGENTS.md"), TextLimit);
    public void SaveInstructions(string text, string? observed) => Replace(Path.Combine(root, "AGENTS.md"), text, observed);
    public string? Memory() => Read(Path.Combine(workspace, "memory.md"), 16_384);
    public void SaveMemory(string text, string? observed) => Replace(Path.Combine(workspace, "memory.md"), text, observed);

    public List<ProjectChat> Heads(string? id = null)
    {
        Guard(workspace); Guard(chatFolder);
        if (!Directory.Exists(chatFolder)) return [];
        var candidates = new List<ProjectChat>();
        foreach (var path in Directory.EnumerateFiles(chatFolder, id is null ? "*.json" : $"{id}*.json", SearchOption.TopDirectoryOnly))
        {
            var name = Path.GetFileNameWithoutExtension(path);
            var chat = name.Split('.')[0];
            if (!IsId(chat) || !IsRevision(name, chat) || id is not null && chat != id) continue;
            var raw = Read(path);
            if (string.IsNullOrEmpty(raw)) continue;
            if (JsonNode.Parse(raw) is not JsonObject document || (int?)document["version"] != 1 || (string?)document["id"] != chat ||
                ((string?)document["previous"] is { } before && (!IsRevision(before, chat) || before == name)))
                throw new IOException("有一份项目对话文件无法读取，原文件已保留。");
            candidates.Add(new(name, raw, document));
        }
        var superseded = candidates.Select(chat => (string?)chat.Document["previous"]).OfType<string>().ToHashSet(StringComparer.Ordinal);
        return candidates.Where(chat => !superseded.Contains(chat.BaseName)).ToList();
    }

    public ProjectChat SaveChat(JsonObject content, ProjectChat? expected)
    {
        var id = (string)content["id"]!;
        if (!IsId(id)) throw new ArgumentException("对话标识无效。");
        var found = Heads(id);
        if (expected is null ? found.Count != 0 : found.Count != 1 || found[0].BaseName != expected.BaseName || found[0].Raw != expected.Raw)
            throw new IOException("项目对话已在另一端改动。请先重新打开项目；两端的改动会保留。");
        var document = content.DeepClone().AsObject();
        document["version"] = 1;
        var name = expected is null ? id : $"{id}.{Guid.NewGuid()}";
        if (expected is not null) document["previous"] = expected.BaseName;
        var raw = document.ToJsonString();
        if (Encoding.UTF8.GetByteCount(raw) > ChatLimit) throw new IOException("这个对话已超过本地项目的单个会话大小。");
        var target = Path.Combine(chatFolder, name + ".json");
        Replace(target, raw, null);
        if (Read(target) != raw) throw new IOException("未能确认对话已写入。");
        if (expected is not null)
        {
            var prior = Path.Combine(chatFolder, expected.BaseName + ".json");
            try { if (Read(prior) == expected.Raw) File.Delete(prior); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
        return new(name, raw, document);
    }

    public IEnumerable<(string Label, string Path)> Skills()
    {
        var directory = Path.Combine(root, "skills");
        Guard(directory);
        if (!Directory.Exists(directory)) yield break;
        foreach (var file in Directory.EnumerateFiles(directory, "*.md").Take(40))
        {
            Guard(file);
            yield return (Path.GetFileNameWithoutExtension(file), file);
        }
        foreach (var subdirectory in Directory.EnumerateDirectories(directory).Take(40))
        {
            Guard(subdirectory);
            var file = Path.Combine(subdirectory, "SKILL.md");
            Guard(file);
            if (File.Exists(file)) yield return (Path.GetFileName(subdirectory), file);
        }
    }

    public string? ReadSkill(string path) => Read(path, 32_768);
    public static ProjectFolder OpenReference(string path) => new(path);
    public static IEnumerable<(string Label, Func<string?> Read)> AttachedSkills(string instance)
    {
        var folder = new ProjectFolder(instance);
        return folder.Skills().Select(skill => ($"{skill.Label} · {Path.GetFileName(folder.Root)}", (Func<string?>)(() => folder.ReadSkill(skill.Path))));
    }

    public IEnumerable<(string Name, string Path, bool Directory)> Entries(string directory)
    {
        Guard(directory);
        var entries = new List<(string Name, string Path, bool Directory)>();
        foreach (var path in System.IO.Directory.EnumerateFileSystemEntries(directory))
        {
            var name = Path.GetFileName(path);
            if (name.StartsWith('.') || (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) continue;
            entries.Add((name, path, System.IO.Directory.Exists(path)));
        }
        return entries.OrderByDescending(entry => entry.Directory).ThenBy(entry => entry.Name, StringComparer.CurrentCultureIgnoreCase);
    }

    public string TextFile(string path)
    {
        var text = Read(path, TextLimit) ?? throw new IOException("文件已移走，请重新打开。");
        if (text.Contains('\0')) throw new IOException("这个文件不是可编辑的文本。");
        return text;
    }

    public void SaveTextFile(string path, string text, string observed)
    {
        if (Encoding.UTF8.GetByteCount(text) > TextLimit) throw new IOException("文件超过可保存的大小。");
        Replace(path, text, observed);
    }

    private string? Read(string path, int limit = ChatLimit)
    {
        Guard(path);
        try
        {
            var file = new FileInfo(path);
            if (file.Length > limit) throw new IOException("文件太大，StuDev 未读取或修改它。");
            return File.ReadAllText(path, new UTF8Encoding(false, true));
        }
        catch (FileNotFoundException) { return null; }
        catch (DirectoryNotFoundException) { return null; }
    }

    private void Replace(string path, string text, string? observed)
    {
        Guard(path);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".pending";
        try
        {
            File.WriteAllText(temporary, text, new UTF8Encoding(false));
            if (Read(path) != observed) throw new IOException("该文件已在另一端改动，原文件没有被覆盖。");
            File.Move(temporary, path, observed is not null);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    private void Guard(string path)
    {
        var at = Path.GetFullPath(path);
        var prefix = Path.EndsInDirectorySeparator(root) ? root : root + Path.DirectorySeparatorChar;
        if (!at.Equals(root, StringComparison.OrdinalIgnoreCase) && !at.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            throw new IOException("该文件不在已授权的项目文件夹中。");
        for (;; at = Path.GetDirectoryName(at)!)
        {
            try
            {
                if ((File.GetAttributes(at) & FileAttributes.ReparsePoint) != 0) throw new IOException("项目文件路径包含链接，未读取或修改。");
            }
            catch (FileNotFoundException) { }
            catch (DirectoryNotFoundException) { }
            if (at.Equals(root, StringComparison.OrdinalIgnoreCase)) return;
        }
    }
}
