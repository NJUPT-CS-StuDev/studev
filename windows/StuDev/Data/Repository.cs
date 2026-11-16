// One immutable data release, fetched as needed from the site and kept on disk for offline use, as Android's
// AcademicRepository does: the same files, the same release manifest the website's offline worker reads.
using System.Net.Http;
using System.Text.Json;

namespace StuDev.Data;

public sealed class Repository
{
    public const string Site = "https://studev.hicancan.top";
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(30) };
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, byte> UnreachableMirrors = new();
    private static readonly string Root = Storage.CacheFor("campus");
    private static string ActiveRelease => Path.Combine(Root, $"release-{Product.Version}.json");
    public DataRelease Release { get; }
    private readonly string folder;
    private readonly Dictionary<string, Task<byte[]>> loading = new();

    private Repository(DataRelease release) { Release = release; folder = Path.Combine(Root, release.Version); }

    /** Discovery does not activate a release: the files needed by the selected timetable must be readable first. */
    public static Task<Repository> Open()
    {
        var kept = ActiveRelease;
        if (File.Exists(kept))
        {
            var release = JsonSerializer.Deserialize(File.ReadAllText(kept), FactsJson.Default.DataRelease) ?? throw new InvalidDataException("release manifest");
            Valid(release); return Task.FromResult(new Repository(release));
        }
        return Discover();
    }
    public static async Task<Repository> Discover()
    {
        var text = await Http.GetStringAsync($"{Site}/pwa-release.json");
        var release = JsonSerializer.Deserialize(text, FactsJson.Default.DataRelease) ?? throw new InvalidDataException("release manifest");
        Valid(release); return new Repository(release);
    }

    public void Activate() => Storage.Write(ActiveRelease, JsonSerializer.Serialize(Release, FactsJson.Default.DataRelease));

    private static void Valid(DataRelease release)
    {
        if (release.Version is null || !System.Text.RegularExpressions.Regex.IsMatch(release.Version, "^[A-Za-z0-9._-]+$") || release.Base != $"/data/{release.Version}")
            throw new InvalidDataException($"unexpected release {release.Version}");
        if (!release.Version.EndsWith($"__app{Product.Version}", StringComparison.Ordinal))
            throw new NotSupportedException("校园数据已经更新，请更新 StuDev 后再试。");
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
        return Path.Combine(folder, path.Replace('/', Path.DirectorySeparatorChar));
    }

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
        var url = $"{Site}{Release.Base}/" + string.Join('/', path.Split('/').Select(Uri.EscapeDataString));
        var bytes = await Http.GetByteArrayAsync(url);
        if (path.EndsWith(".json", StringComparison.Ordinal)) using (JsonDocument.Parse(bytes)) { }
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        var pending = file + "." + Guid.NewGuid().ToString("N") + ".pending";
        try { await File.WriteAllBytesAsync(pending, bytes); File.Move(pending, file, true); }
        finally { if (File.Exists(pending)) File.Delete(pending); }
        return bytes;
    }

    /** A stretch of a large file (a search pack), fetched by range from its mirror or the site and kept on disk. */
    public async Task<byte[]> Block(string path, string? mirror, long offset, int length)
    {
        if (path.Split('/').Any(part => part is "" or "." or "..")) throw new ArgumentException($"bad release path {path}");
        if (offset < 0 || length <= 0 || offset > long.MaxValue - length) throw new ArgumentOutOfRangeException(nameof(offset));
        var file = Path.Combine(folder, path.Replace('/', Path.DirectorySeparatorChar) + "." + offset);
        if (File.Exists(file))
        {
            var kept = await File.ReadAllBytesAsync(file);
            if (kept.Length != length) throw new InvalidDataException("离线搜索数据不完整");
            return kept;
        }
        async Task<byte[]> Range(string url, CancellationToken cancel = default)
        {
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
        byte[] got;
        var own = $"{Site}{Release.Base}/" + string.Join('/', path.Split('/').Select(Uri.EscapeDataString));
        if (mirror is not null && Uri.TryCreate(mirror, UriKind.Absolute, out var mirrorUri) && !UnreachableMirrors.ContainsKey(mirrorUri.Host))
        {
            using var mirrorTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(4));
            try { got = await Range(mirror, mirrorTimeout.Token); }
            catch (Exception error) when (error is not InvalidDataException && (error is HttpRequestException or IOException or OperationCanceledException))
            {
                UnreachableMirrors.TryAdd(mirrorUri.Host, 0);
                got = await Range(own);
            }
        }
        else got = await Range(own);
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        var pending = file + "." + Guid.NewGuid().ToString("N") + ".pending";
        try { await File.WriteAllBytesAsync(pending, got); File.Move(pending, file, true); }
        finally { if (File.Exists(pending)) File.Delete(pending); }
        return got;
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
    public async Task<List<Lab>> Labs(string klass)
    {
        if (Release.Labs is null) return [];
        var index = await Read($"labs/{Release.Labs}/index.json", FactsJson.Default.LabIndex);
        return index.Classes.Contains(klass) ? (await Read($"labs/{Release.Labs}/classes/{klass}.json", FactsJson.Default.ClassLabs)).Labs : [];
    }
}
