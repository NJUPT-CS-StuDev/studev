// One immutable data release, fetched as needed from the site and kept on disk for offline use, as Android's
// AcademicRepository does: the same files, the same release manifest the website's offline worker reads.
using System.Net.Http;
using System.Text.Json;

namespace StuDev.Data;

public sealed class Repository
{
    public static string Site => Product.Origin;
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(30) };
    private static readonly string Root = Storage.CacheFor("campus");
    private static string ActiveRelease => Path.Combine(Root, "release.json");
    public DataRelease Release { get; }
    public static event Action<DataRelease>? Retired;
    private int checkedRetirement;
    private void Missing() { if (Interlocked.Exchange(ref checkedRetirement, 1) == 0) Retired?.Invoke(Release); }
    private readonly Dictionary<string, Task<byte[]>> loading = new();

    private Repository(DataRelease release) { Release = release; }

    /** Discovery does not activate a release: the files needed by the selected timetable must be readable first. */
    public static Task<Repository> Open()
    {
        var kept = ActiveRelease;
        if (File.Exists(kept))
        {
            try {
                var release = JsonSerializer.Deserialize(File.ReadAllText(kept), FactsJson.Default.DataRelease) ?? throw new InvalidDataException("release manifest");
                Valid(release); return Task.FromResult(new Repository(release));
            } catch (Exception error) when (error is IOException or JsonException) {
                // This cache contains public release routing, never preferences,
                // tasks or credentials. An obsolete shape is discarded outright.
                try { File.Delete(kept); } catch (IOException) { }
            }
        }
        return Discover();
    }
    public static async Task<Repository> Discover()
    {
        var runtimeFile = Path.Combine(Root, "app.json");
        static string Entry(string text) {
            using var json = JsonDocument.Parse(text);
            var value = json.RootElement.GetProperty("campus_entry").GetString()!;
            if (!Uri.TryCreate(value, UriKind.Absolute, out var entry) || entry.Scheme != "https" || entry.UserInfo.Length != 0 || entry.Fragment.Length != 0) throw new InvalidDataException("校园数据地址无效。");
            return entry.AbsoluteUri;
        }
        var entry = $"{Product.CampusOrigin}/campus-release.json";
        try { if (File.Exists(runtimeFile)) entry = Entry(await File.ReadAllTextAsync(runtimeFile)); } catch (Exception error) when (error is IOException or JsonException or KeyNotFoundException or InvalidOperationException) { }
        try {
            using var runtimeCancel = new CancellationTokenSource(TimeSpan.FromMilliseconds(2500));
            using var runtimeRequest = new HttpRequestMessage(HttpMethod.Get, $"{Site}/app-release.json");
            runtimeRequest.Headers.CacheControl = new System.Net.Http.Headers.CacheControlHeaderValue { NoCache = true };
            using var runtimeResponse = await Http.SendAsync(runtimeRequest, runtimeCancel.Token);
            runtimeResponse.EnsureSuccessStatusCode();
            var runtimeText = await runtimeResponse.Content.ReadAsStringAsync(runtimeCancel.Token);
            entry = Entry(runtimeText); Storage.Write(runtimeFile, runtimeText);
        } catch (Exception error) when (error is HttpRequestException or IOException or OperationCanceledException or JsonException or KeyNotFoundException or InvalidOperationException) { }
        using var request = new HttpRequestMessage(HttpMethod.Get, entry);
        request.Headers.CacheControl = new System.Net.Http.Headers.CacheControlHeaderValue { NoCache = true };
        using var response = await Http.SendAsync(request);
        response.EnsureSuccessStatusCode();
        var text = await response.Content.ReadAsStringAsync();
        var release = JsonSerializer.Deserialize(text, FactsJson.Default.DataRelease) ?? throw new InvalidDataException("release manifest");
        var origin = new Uri(entry);
        release = release with { Base = new Uri(origin, release.Base).AbsoluteUri,
            MapBase = new Uri(origin, release.MapBase).AbsoluteUri, KnowledgeBase = new Uri(origin, release.KnowledgeBase).AbsoluteUri,
            SearchBase = new Uri(origin, release.SearchBase).AbsoluteUri, TextsBase = new Uri(origin, release.TextsBase).AbsoluteUri };
        Valid(release); return new Repository(release);
    }

    public void Activate() {
        Storage.Write(ActiveRelease, JsonSerializer.Serialize(Release, FactsJson.Default.DataRelease));
        try {
            foreach (var file in Directory.EnumerateFiles(Root, "release-*.json")) File.Delete(file);
            foreach (var directory in Directory.EnumerateDirectories(Root).Where(path => Path.GetFileName(path).Contains("__app", StringComparison.Ordinal)))
                if (Path.GetFullPath(directory).StartsWith(Path.GetFullPath(Root) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) Directory.Delete(directory, true);
        } catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
    }

    private static void Valid(DataRelease release)
    {
        if (release.Version is null || !System.Text.RegularExpressions.Regex.IsMatch(release.Version, "^[A-Za-z0-9._-]+$") || !Uri.TryCreate(new Uri(Product.CampusOrigin), release.Base, out var factBase) || factBase.Scheme != "https" || factBase.UserInfo.Length != 0 || factBase.Query.Length != 0 || factBase.Fragment.Length != 0 || factBase.AbsolutePath != $"/data/{release.Version}")
            throw new InvalidDataException($"unexpected release {release.Version}");
        foreach (var (value, prefix) in new[] { (release.MapBase, "space"), (release.KnowledgeBase, "knowledge"), (release.SearchBase, "search"), (release.TextsBase, "texts") })
            if (value is null || !Uri.TryCreate(new Uri(Product.CampusOrigin), value, out var component) || component.Scheme != "https" || component.UserInfo.Length != 0 || component.Query.Length != 0 || component.Fragment.Length != 0 || !System.Text.RegularExpressions.Regex.IsMatch(component.AbsolutePath, $"^/{prefix}/[A-Za-z0-9._-]+$"))
                throw new InvalidDataException("校园数据入口不完整。");
    }

    private static readonly string MediaRoot = Storage.CacheFor("knowledge-media");

    /** A knowledge picture, named by its full address on one of the hosts the knowledge release lists; kept on disk. */
    public static async Task<byte[]?> Media(string address, IReadOnlyList<string>? hosts)
    {
        if (hosts is null || !hosts.Any(host => address.StartsWith(host + "/", StringComparison.Ordinal))) return null;
        var file = Path.Combine(MediaRoot, Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(address))));
        if (File.Exists(file)) return await File.ReadAllBytesAsync(file);
        try
        {
            var bytes = await Http.GetByteArrayAsync(address);
            Directory.CreateDirectory(MediaRoot);
            await File.WriteAllBytesAsync(file, bytes);
            return bytes;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or IOException) { return null; }
    }

    /** One file of the release, from disk if it was fetched before. */
    public Task<byte[]> Bytes(string path)
    {
        _ = LocalPath(path);
        lock (loading)
        {
            if (!loading.TryGetValue(path, out var task) || task.IsFaulted || task.IsCanceled) loading[path] = task = Fetch(path);
            return task;
        }
    }

    private string LocalPath(string path)
    {
        if (path.Length == 0 || Path.IsPathRooted(path) || path.Contains('\\') || path.Split('/').Any(part => part is "" or "." or ".."))
            throw new ArgumentException($"bad release path {path}");
        var (component, relative) = Component(path);
        return Path.Combine(Root, new Uri(new Uri(Product.CampusOrigin), component).AbsolutePath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar), relative.Replace('/', Path.DirectorySeparatorChar));
    }

    private (string Base, string Relative) Component(string path) => path.Split('/', 2) is [var head, var tail] ? head switch
    {
        "space" => (Release.MapBase, tail), "knowledge" => (Release.KnowledgeBase, tail),
        "search" => (Release.SearchBase, tail), "texts" => (Release.TextsBase, tail),
        _ => (Release.Base, path),
    } : (Release.Base, path);
    private string Address(string path) { var (component, relative) = Component(path); return new Uri(new Uri(Product.CampusOrigin), component).AbsoluteUri.TrimEnd('/') + "/" + string.Join('/', relative.Split('/').Select(Uri.EscapeDataString)); }

    /** Native readers of archives use the same downloaded file as other release reads. */
    public async Task<string> LocalFile(string path)
    {
        var file = LocalPath(path);
        if (!File.Exists(file)) await Bytes(path);
        return file;
    }

    private async Task<byte[]> Fetch(string path)
    {
        var file = LocalPath(path);
        if (File.Exists(file)) return await File.ReadAllBytesAsync(file);
        var url = Address(path);
        byte[] bytes;
        try { bytes = await Http.GetByteArrayAsync(url); }
        catch (HttpRequestException error) when (error.StatusCode == System.Net.HttpStatusCode.NotFound) { Missing(); throw; }
        if (path.EndsWith(".json", StringComparison.Ordinal)) using (JsonDocument.Parse(bytes)) { }
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        var pending = file + "." + Guid.NewGuid().ToString("N") + ".pending";
        try { await File.WriteAllBytesAsync(pending, bytes); File.Move(pending, file, true); }
        finally { if (File.Exists(pending)) File.Delete(pending); }
        return bytes;
    }

    /** A stretch of a public search pack, fetched from the same data entry and kept on disk. */
    public async Task<byte[]> Block(string path, long offset, int length)
    {
        if (path.Split('/').Any(part => part is "" or "." or "..")) throw new ArgumentException($"bad release path {path}");
        if (offset < 0 || length <= 0 || offset > long.MaxValue - length) throw new ArgumentOutOfRangeException(nameof(offset));
        var file = LocalPath(path) + "." + offset;
        if (File.Exists(file))
        {
            var kept = await File.ReadAllBytesAsync(file);
            if (kept.Length != length) throw new InvalidDataException("离线搜索数据不完整");
            return kept;
        }
        var whole = LocalPath(path);
        if (File.Exists(whole)) {
            await using var stream = File.OpenRead(whole);
            if (offset > stream.Length || length > stream.Length - offset) throw new InvalidDataException("离线搜索数据不完整");
            stream.Position = offset; var bytes = new byte[length]; await stream.ReadExactlyAsync(bytes); return bytes;
        }
        byte[] got;
        try { got = await ReadRange(Address(path), offset, length); }
        catch (HttpRequestException error) when (error.StatusCode == System.Net.HttpStatusCode.NotFound) { Missing(); throw; }
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        var pending = file + "." + Guid.NewGuid().ToString("N") + ".pending";
        try { await File.WriteAllBytesAsync(pending, got); File.Move(pending, file, true); }
        finally { if (File.Exists(pending)) File.Delete(pending); }
        return got;
    }

    internal static async Task<byte[]> ReadRange(string url, long offset, int length, CancellationToken cancel = default)
    {
            if (offset < 0 || length <= 0 || offset > long.MaxValue - length) throw new ArgumentOutOfRangeException(nameof(offset));
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(offset, offset + length - 1);
            using var response = await Http.SendAsync(request, cancel);
            response.EnsureSuccessStatusCode();
            var bytes = await response.Content.ReadAsByteArrayAsync(cancel);
            if (response.StatusCode == System.Net.HttpStatusCode.PartialContent)
            {
                var range = response.Content.Headers.ContentRange;
                if (bytes.Length != length || range?.Unit != "bytes" || range.From != offset || range.To != offset + length - 1)
                    throw new InvalidDataException("服务器返回的搜索数据范围不完整");
                return bytes;
            }
            // HTTP permits a server to ignore Range and return the whole file.
            if (offset > bytes.Length || length > bytes.Length - offset) throw new InvalidDataException("服务器返回的搜索数据不完整");
            return bytes.AsSpan((int)offset, length).ToArray();
    }

    public async Task<T> Read<T>(string path, System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> shape) => JsonSerializer.Deserialize(await Bytes(path), shape) ?? throw new InvalidDataException(path);

    private string Teaching => $"teaching/{Release.Teaching}";
    public Task<TeachingTerm> Term() => Read($"{Teaching}/term.json", FactsJson.Default.TeachingTerm);
    public Task<List<TeachingPeriod>> Periods() => Read($"{Teaching}/periods.json", FactsJson.Default.ListTeachingPeriod);
    public Task<List<TeachingClass>> Classes() => Read($"{Teaching}/classes.json", FactsJson.Default.ListTeachingClass);
    public Task<ClassSchedule> Schedule(string klass) => Read($"{Teaching}/classes/{klass}.json", FactsJson.Default.ClassSchedule);
    public Task<List<TeachingMeeting>> Meetings() => Read($"{Teaching}/meetings.json", FactsJson.Default.ListTeachingMeeting);
    public Task<RoomIndex> Rooms() => Read("rooms/index.json", FactsJson.Default.RoomIndex);
    public async Task<RoomDay?> RoomDay(string term, string date)
    {
        try { return await Read($"rooms/{term}/{date}.json", FactsJson.Default.RoomDay); }
        catch (HttpRequestException error) when (error.StatusCode == System.Net.HttpStatusCode.NotFound) { return null; }
    }
    public Task<List<World.CourseMaterials>> Materials() => Read("materials.json", FactsJson.Default.ListCourseMaterials);
    public Task<Dictionary<string, MorningRun>> Runs() => Read("morning-run.json", FactsJson.Default.DictionaryStringMorningRun);
    public Task<List<Lab>> AllLabs() => Release.Labs is null ? Task.FromResult(new List<Lab>()) : Read($"labs/{Release.Labs}/labs.json", FactsJson.Default.ListLab);
    public async Task<List<CalendarTerm>> Calendar() => (await Read("calendar.json", FactsJson.Default.CalendarFile)).Terms;
    public Task<List<Exam>> AllExams() => Release.Exams is null ? Task.FromResult(new List<Exam>()) : Read($"exams/{Release.Exams}/exams.json", FactsJson.Default.ListExam);
    public async Task<List<Exam>> Exams(string klass)
    {
        if (Release.Exams is null) return [];
        var index = await Read($"exams/{Release.Exams}/index.json", FactsJson.Default.ExamIndex);
        return index.Classes.Contains(klass) ? (await Read($"exams/{Release.Exams}/classes/{klass}.json", FactsJson.Default.ClassExams)).Exams : [];
    }
    public async Task<ExamRecord> ExamRecord(string? klass)
    {
        if (Release.Exams is null) return new([], [], null, []);
        var index = await Read($"exams/{Release.Exams}/index.json", FactsJson.Default.ExamIndex);
        var changes = klass is not null && index.Classes.Contains(klass)
            ? (await Read($"exams/{Release.Exams}/classes/{klass}.json", FactsJson.Default.ClassExams)).Changes : [];
        return new(changes, index.Sources, index.Checked, index.History);
    }
    public async Task<List<Lab>> Labs(string klass)
    {
        if (Release.Labs is null) return [];
        var index = await Read($"labs/{Release.Labs}/index.json", FactsJson.Default.LabIndex);
        return index.Classes.Contains(klass) ? (await Read($"labs/{Release.Labs}/classes/{klass}.json", FactsJson.Default.ClassLabs)).Labs : [];
    }
}
