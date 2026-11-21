using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using StuDev.Data;
using StuDev.Search;

internal static class SearchTest
{
    internal static async Task Check(string root, Action<string, object?, JsonNode?> equal)
    {
        var temp = Path.GetFullPath(@"D:\Temp\codex\studev-native-tests");
        var previous = Environment.GetEnvironmentVariable("STUDEV_DATA_DIR");
        var home = Path.Combine(temp, Guid.NewGuid().ToString("N"));
        Environment.SetEnvironmentVariable("STUDEV_DATA_DIR", home);
        try { await Run(root, home, equal); }
        finally
        {
            Environment.SetEnvironmentVariable("STUDEV_DATA_DIR", previous);
            var resolved = Path.GetFullPath(home);
            if (!resolved.StartsWith(temp + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("Unexpected test data directory");
            if (Directory.Exists(resolved)) Directory.Delete(resolved, true);
        }
    }

    // Keep all types that capture the process data directory beyond the environment change above.
    [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
    private static async Task Run(string root, string home, Action<string, object?, JsonNode?> equal)
    {
        if (!string.Equals(Storage.Root, home, StringComparison.OrdinalIgnoreCase) || !string.Equals(Storage.Cache, Path.Combine(home, "cache"), StringComparison.OrdinalIgnoreCase))
            throw new IOException("Windows verification did not isolate its data directory");
        var releaseText = await File.ReadAllTextAsync(Path.Combine(root, "src/data/campus-release.json"));
        var release = JsonSerializer.Deserialize(releaseText, FactsJson.Default.DataRelease)!;
        var searchFolder = Path.Combine(root, "public", release.SearchBase.TrimStart('/'));
        var activeRelease = Path.Combine(Storage.CacheFor("campus"), "release.json");
        Storage.Write(activeRelease, releaseText);
        var repository = await Repository.Open();
        var oldPointer = Path.Combine(Storage.CacheFor("campus"), "release-3.4.1.json");
        var oldPublic = Path.Combine(Storage.CacheFor("campus"), "old__app3.4.1", "calendar.json");
        Storage.Write(oldPointer, "retired public pointer"); Storage.Write(oldPublic, "retired public data");
        foreach (var name in new[] { "preferences.json", "tasks.json", "account.json" }) Storage.Write(Storage.PathFor(name), "personal state");
        repository.Activate();
        equal("retired public release pointer removed", File.Exists(oldPointer), JsonValue.Create(false));
        equal("retired app-bound public directory removed", File.Exists(oldPublic), JsonValue.Create(false));
        foreach (var name in new[] { "preferences.json", "tasks.json", "account.json" }) equal($"migration preserves {name}", Storage.Read(name), JsonValue.Create("personal state"));
        var manifest = JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(searchFolder, "manifest.json")))!;
        var index = manifest["index"]!;
        var pack = manifest["packs"]![(int)index["pack"]!]!.GetValue<string>();
        var packFile = Path.GetFullPath(Path.Combine(searchFolder, pack));
        await using var server = new Packs(Path.GetDirectoryName(packFile)!);
        server.WrongRange = true;
        var rejected = false;
        try { await Repository.ReadRange(server.Address + Path.GetFileName(packFile), (long)index["offset"]!, (int)index["bytes"]!); }
        catch (InvalidDataException) { rejected = true; }
        equal("malformed search range is a data error", rejected, JsonValue.Create(true));
        // The index and complete packs are the actual immutable data snapshot.
        foreach (var component in new[] { release.SearchBase, release.SearchStableBase }.OfType<string>())
        {
            var path = component.TrimStart('/');
            var cachedSearch = Path.Combine(Storage.CacheFor("campus"), path);
            Directory.CreateDirectory(cachedSearch);
            foreach (var file in Directory.EnumerateFiles(Path.Combine(root, "public", path)))
                File.Copy(file, Path.Combine(cachedSearch, Path.GetFileName(file)), true);
        }
        using var search = new NativeSearch(repository);
        var running = search.Page("101", 10, "relevance", new JsonObject(), 0, CancellationToken.None);
        search.Dispose();
        var answer = await running;
        equal("disposing during a query finishes the active query", answer.Results.Any(r => r["title"]?.GetValue<string>() == "教1-101"), JsonValue.Create(true));
        var closed = false;
        try { await search.Options(); } catch (ObjectDisposedException) { closed = true; }
        equal("a closed search rejects a new query", closed, JsonValue.Create(true));
        using var reopened = new NativeSearch(repository);
        var again = await reopened.Page("101", 10, "relevance", new JsonObject(), 0, CancellationToken.None);
        equal("a new engine reads the cached release", again.Results.Select(r => r["url"]!.GetValue<string>()), new JsonArray(answer.Results.Select(r => (JsonNode?)r["url"]!.DeepClone()).ToArray()));
    }

    private sealed class Packs : IAsyncDisposable
    {
        private readonly TcpListener listener = new(IPAddress.Loopback, 0);
        private readonly CancellationTokenSource stop = new();
        private readonly List<Task> requests = [];
        private readonly Task accepting;
        private readonly string folder;
        public string Address { get; }
        public volatile bool WrongRange;

        public Packs(string folder)
        {
            this.folder = folder;
            listener.Start();
            Address = $"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}/";
            accepting = Accept();
        }

        private async Task Accept()
        {
            try { while (!stop.IsCancellationRequested) requests.Add(Serve(await listener.AcceptTcpClientAsync(stop.Token))); }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
        }

        private async Task Serve(TcpClient client)
        {
            using (client)
            {
                var stream = client.GetStream();
                using var reader = new StreamReader(stream, Encoding.ASCII, false, 1024, true);
                var request = (await reader.ReadLineAsync())!.Split(' ');
                string? line; string? range = null;
                while (!string.IsNullOrEmpty(line = await reader.ReadLineAsync()))
                    if (line.StartsWith("Range:", StringComparison.OrdinalIgnoreCase)) range = line[6..].Trim();
                var bounds = range![6..].Split('-').Select(long.Parse).ToArray();
                await using var file = File.OpenRead(Path.Combine(folder, Path.GetFileName(request[1])));
                var length = checked((int)(bounds[1] - bounds[0] + 1));
                var bytes = new byte[length];
                file.Position = bounds[0];
                await file.ReadExactlyAsync(bytes);
                var shift = WrongRange ? 1 : 0; WrongRange = false;
                var headers = $"HTTP/1.1 206 Partial Content\r\nContent-Length: {length}\r\nContent-Range: bytes {bounds[0] + shift}-{bounds[1] + shift}/{file.Length}\r\nConnection: close\r\n\r\n";
                await stream.WriteAsync(Encoding.ASCII.GetBytes(headers));
                await stream.WriteAsync(bytes);
            }
        }

        public async ValueTask DisposeAsync()
        {
            stop.Cancel();
            await accepting;
            listener.Stop();
            await Task.WhenAll(requests);
            stop.Dispose();
        }
    }
}
