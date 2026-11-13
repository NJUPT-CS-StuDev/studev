// Drives one wasm-search engine through the bundle protocol, fetching only the blocks it names: the same steps as
// Android's NativeSearch.kt and the web's worker, over the same Rust kernel.
using System.Text.Json.Nodes;
using StuDev.Data;
using StuDev.Kernels.Search;

namespace StuDev.Search;

public sealed record SearchPage(List<JsonObject> Results, int Total, JsonObject Filters);

public sealed class NativeSearch(Repository repository) : IDisposable
{
    private const long Budget = 64L * 1024 * 1024;
    private readonly SemaphoreSlim gate = new(1, 1);
    private JsonObject? manifest;
    private SearchEngine? engine;
    private long loaded;
    private bool closed;

    private Task<byte[]> Ref(JsonNode value)
    {
        var number = (int)value["pack"]!;
        var pack = (string)manifest!["packs"]![number]!;
        var mirror = manifest["mirrors"]?.AsArray().ElementAtOrDefault(number)?.GetValue<string>();
        return repository.Block($"search/{pack}", mirror, (long)value["offset"]!, (int)value["bytes"]!);
    }

    /** Blocks accumulate between queries; past the budget, start from the index again. */
    private async Task<SearchEngine> Ready()
    {
        if (engine is not null && loaded < Budget) return engine;
        engine?.Dispose();
        manifest ??= JsonNode.Parse(await repository.Bytes("search/manifest.json"))!.AsObject();
        var index = manifest["index"]!;
        loaded = 0;
        return engine = new SearchEngine(await Ref(index), (uint)(int)index["decoded_bytes"]!, manifest["profile"]!.ToJsonString());
    }

    private async Task Load(string json, Action<uint, byte[], uint> consume, CancellationToken cancel)
    {
        var blocks = JsonNode.Parse(json)!.AsArray().Select(b => b!).ToList();
        using var slots = new SemaphoreSlim(8);
        var fetched = await Task.WhenAll(blocks.Select(async block => { await slots.WaitAsync(cancel); try { return await Ref(block); } finally { slots.Release(); } }));
        for (var i = 0; i < blocks.Count; i++)
        {
            cancel.ThrowIfCancellationRequested();
            var decoded = (int)blocks[i]["decoded_bytes"]!;
            consume((uint)(int)blocks[i]["id"]!, fetched[i], (uint)decoded);
            loaded += decoded;
        }
    }

    public async Task<SearchPage> Page(string query, int limit, string sort, JsonObject filters, int offset, Action<SearchPage> ranked, CancellationToken cancel)
    {
        await gate.WaitAsync(cancel);
        try
        {
            ObjectDisposedException.ThrowIf(closed, this);
            if (query.Trim().Length == 1) return new([], 0, []);
            var search = await Ready();
            var request = new JsonObject { ["query"] = query.Trim(), ["offset"] = offset, ["limit"] = limit, ["sort"] = sort, ["filters"] = filters.DeepClone() };
            var options = JsonNode.Parse(search.FilterOptions())!.AsObject();
            SearchPage Read(string response) { var value = JsonNode.Parse(response)!; return new(value["results"]!.AsArray().Select(r => r!.AsObject()).ToList(), (int)value["totalCandidates"]!, options); }
            await Load(search.BeginSearch(request.ToJsonString()), search.LoadLexiconBlock, cancel);
            await Load(search.RequiredPostingChunks(), search.LoadPostingsChunk, cancel);
            await Load(search.PlanSearch(), search.LoadDocumentBlock, cancel);
            cancel.ThrowIfCancellationRequested();
            ranked(Read(search.RankedResults()));
            search.ClearContent();
            var before = loaded;
            await Load(search.RequiredContentChunks(), search.LoadContentChunk, cancel);
            loaded = before;
            cancel.ThrowIfCancellationRequested();
            return Read(search.HydrateSearch());
        }
        finally { gate.Release(); }
    }

    public async Task<JsonObject> Options()
    {
        await gate.WaitAsync();
        try { return JsonNode.Parse((await Ready()).FilterOptions())!.AsObject(); }
        finally { gate.Release(); }
    }

    public void Dispose() { closed = true; engine?.Dispose(); engine = null; }
}
