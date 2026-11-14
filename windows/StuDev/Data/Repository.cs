// One immutable data release, fetched as needed from the site and kept on disk for offline use, as Android's
// AcademicRepository does: the same files, the same release manifest the website's offline worker reads.
using System.Net.Http;
using System.Text.Json;

namespace StuDev.Data;

public sealed class Repository
{
    public const string Site = "https://studev.hicancan.top";
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(30) };
    private static readonly string Root = Storage.CacheFor("campus");
    public DataRelease Release { get; }
    private readonly string folder;
    private readonly Dictionary<string, Task<byte[]>> loading = new();

    private Repository(DataRelease release) { Release = release; folder = Path.Combine(Root, release.Version); }

    /** Discovery does not activate a release: the files needed by the selected timetable must be readable first. */
    public static Task<Repository> Open()
    {
        var kept = Path.Combine(Root, "release.json");
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

    public void Activate() => Storage.Write(Path.Combine(Root, "release.json"), JsonSerializer.Serialize(Release, FactsJson.Default.DataRelease));

    private static void Valid(DataRelease release)
    {
        if (release.Version is null || !System.Text.RegularExpressions.Regex.IsMatch(release.Version, "^[A-Za-z0-9._-]+$") || release.Base != $"/data/{release.Version}")
            throw new InvalidDataException($"unexpected release {release.Version}");
    }

    /** One file of the release, from disk if it was fetched before. */
    public Task<byte[]> Bytes(string path)
    {
        if (path.Length == 0 || path.StartsWith('/') || path.Split('/').Any(part => part is "" or "." or ".."))
            throw new ArgumentException($"bad release path {path}");
        lock (loading)
        {
            if (!loading.TryGetValue(path, out var task) || task.IsFaulted || task.IsCanceled) loading[path] = task = Fetch(path);
            return task;
        }
    }

    private async Task<byte[]> Fetch(string path)
    {
        var file = Path.Combine(folder, path.Replace('/', Path.DirectorySeparatorChar));
        if (File.Exists(file)) return await File.ReadAllBytesAsync(file);
        var url = $"{Site}{Release.Base}/" + string.Join('/', path.Split('/').Select(Uri.EscapeDataString));
        var bytes = await Http.GetByteArrayAsync(url);
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
        var file = Path.Combine(folder, path.Replace('/', Path.DirectorySeparatorChar) + "." + offset);
        if (File.Exists(file)) return await File.ReadAllBytesAsync(file);
        async Task<byte[]> Range(string url)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(offset, offset + length - 1);
            using var response = await Http.SendAsync(request);
            response.EnsureSuccessStatusCode();
            var bytes = await response.Content.ReadAsByteArrayAsync();
            if (response.StatusCode != System.Net.HttpStatusCode.PartialContent || bytes.Length != length) throw new HttpRequestException($"range of {url} not served");
            return bytes;
        }
        byte[] got;
        var own = $"{Site}{Release.Base}/" + string.Join('/', path.Split('/').Select(Uri.EscapeDataString));
        if (mirror is null) got = await Range(own);
        else try { got = await Range(mirror); } catch (HttpRequestException) { got = await Range(own); }
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
