// Drives one wasm-search engine through the bundle protocol, fetching only the blocks it names, a query's postings
// and then the pages of the results it shows: the same steps as Android's NativeSearch.kt and the web's worker, over
// the same Rust kernel.
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
    private volatile bool closed;

    private string Pack(JsonNode value)
    {
        var number = (int)value["pack"]!;
        var pack = (string)manifest!["packs"]![number]!;
        return repository.SearchPackPath(pack);
    }

    private async Task<byte[][]> ReadBlocks(List<JsonNode> blocks, CancellationToken cancel)
    {
        var output = new byte[blocks.Count][];
        await Task.WhenAll(blocks.Select((block, index) => (block, index)).GroupBy(item => Pack(item.block)).Select(async group =>
        {
            var refs = group.ToArray();
            var spans = refs.Select(item => ((long)item.block["offset"]!, (int)item.block["bytes"]!)).ToArray();
            var bytes = await repository.Blocks(group.Key, spans, cancel);
            for (var i = 0; i < refs.Length; i++) output[refs[i].index] = bytes[i];
        }));
        return output;
    }

    /** Blocks accumulate between queries; past the budget, start from the index again. */
    private async Task<SearchEngine> Ready(CancellationToken cancel = default)
    {
        if (engine is not null && loaded < Budget) return engine;
        Close();
        manifest ??= JsonNode.Parse(await repository.Bytes("search/manifest.json"))!.AsObject();
        var indexes = new List<JsonNode> { manifest["index"]! };
        if (manifest["segments"] is JsonArray segments) indexes.AddRange(segments.Select(part => part!));
        var bytes = await ReadBlocks(indexes, cancel);
        static uint Decoded(JsonNode node) => (uint)(int)node["decoded_bytes"]!;
        var ready = new SearchEngine(bytes[0], Decoded(indexes[0]), manifest["profile"]!.ToJsonString());
        try
        {
            for (var i = 1; i < indexes.Count; i++)
                ready.AddSegment(bytes[i], Decoded(indexes[i]), (uint)(int)indexes[i]["pack"]!);
        }
        catch { ready.Dispose(); throw; }
        loaded = indexes.Sum(part => (long)Decoded(part));
        return engine = ready;
    }

    private async Task Load(string json, Action<uint, byte[], uint> consume, CancellationToken cancel)
    {
        var blocks = JsonNode.Parse(json)!.AsArray().Select(b => b!).ToList();
        var fetched = await ReadBlocks(blocks, cancel);
        for (var i = 0; i < blocks.Count; i++)
        {
            cancel.ThrowIfCancellationRequested();
            var decoded = (int)blocks[i]["decoded_bytes"]!;
            consume((uint)(int)blocks[i]["id"]!, fetched[i], (uint)decoded);
            loaded += decoded;
        }
    }

    public async Task<SearchPage> Page(string query, int limit, string sort, JsonObject filters, int offset, CancellationToken cancel)
    {
        await gate.WaitAsync(cancel);
        try
        {
            ObjectDisposedException.ThrowIf(closed, this);
            if (query.Trim().Length == 1) return new([], 0, []);
            var search = await Ready(cancel);
            var request = new JsonObject { ["query"] = query.Trim(), ["offset"] = offset, ["limit"] = limit, ["sort"] = sort, ["filters"] = filters.DeepClone() };
            var options = JsonNode.Parse(search.FilterOptions())!.AsObject();
            await Load(search.BeginSearch(request.ToJsonString()), search.LoadPostingsChunk, cancel);
            await Load(search.PlanSearch(), search.LoadPage, cancel);
            cancel.ThrowIfCancellationRequested();
            var value = JsonNode.Parse(search.HydrateSearch())!;
            return new(value["results"]!.AsArray().Select(r => r!.AsObject()).ToList(), (int)value["totalCandidates"]!, options);
        }
        finally { gate.Release(); if (closed) Dispose(); }
    }

    public async Task<JsonObject> Options()
    {
        await gate.WaitAsync();
        try { ObjectDisposedException.ThrowIf(closed, this); return JsonNode.Parse((await Ready()).FilterOptions())!.AsObject(); }
        finally { gate.Release(); if (closed) Dispose(); }
    }

    private void Close() { engine?.Dispose(); engine = null; }
    public void Dispose()
    {
        closed = true;
        if (!gate.Wait(0)) return;
        try { Close(); } finally { gate.Release(); }
    }
}
