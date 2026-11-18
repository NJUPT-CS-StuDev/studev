using System.Text.Json.Nodes;
using StuDev.Data;

namespace StuDev.Ai;

internal sealed record ProviderModel(string Id, bool Enabled = true);

internal sealed record ModelProvider(string Id, string Name, string Address, string Key, bool Enabled, List<ProviderModel> Models)
{
    public bool Runtime => Id == ModelProviders.RuntimeId;
    public bool IsFree => Id == ModelChoice.Free.ProviderId;
    public string ModelName(string id) => IsFree && id == ModelChoice.Free.ModelId ? Assistant.Shared.FreeService.ModelName : id;

    public JsonObject ToJson() => new()
    {
        ["id"] = Id,
        ["name"] = Name,
        ["address"] = Address,
        ["key"] = Key,
        ["enabled"] = Enabled,
        ["models"] = new JsonArray([.. Models.Select(model => (JsonNode)new JsonObject { ["id"] = model.Id, ["enabled"] = model.Enabled })]),
    };
    public static ModelProvider Of(JsonObject value) => new(
        (string)value["id"]!, (string)value["name"]!, (string)value["address"]!, (string)value["key"]!,
        (bool)value["enabled"]!, [.. value["models"]!.AsArray().Select(model => new ProviderModel((string)model!["id"]!, (bool)model["enabled"]!))]);
}

/** This device's model catalogue. The address, models and key are saved together under the user's DPAPI protection. */
internal sealed class ModelProviders
{
    public const string RuntimeId = "runtime";
    public const string RuntimeName = "Local Runtime MCP";
    private const string FileName = "ai/providers.bin";
    private const string OldChoice = "ai/model.json";
    private const string OldKey = "ai/key.bin";
    private static readonly ModelProvider Free = new(ModelChoice.Free.ProviderId, Assistant.Shared.FreeService.ProviderName, "", "", true, [new(ModelChoice.Free.ModelId)]);
    public static readonly ModelProviders Shared = Read();
    private List<ModelProvider> configured;
    public ModelChoice? PreviousChoice { get; private set; }
    public IReadOnlyList<ModelProvider> Configured => configured;
    public IEnumerable<ModelProvider> Available => configured.Where(provider => provider.Enabled && provider.Key.Length > 0 && provider.Models.Any(model => model.Enabled)).Prepend(Free);
    public event Action? Changed;

    private ModelProviders(List<ModelProvider> configured, ModelChoice? previousChoice)
    {
        this.configured = configured;
        PreviousChoice = previousChoice;
    }

    public ModelProvider? Find(string id) => id == Free.Id ? Free : configured.FirstOrDefault(provider => provider.Id == id);

    public string? Resolve(ModelChoice selection, out Own? connection)
    {
        connection = null;
        if (selection == ModelChoice.Free) return null;
        var provider = Find(selection.ProviderId);
        if (provider is null || !provider.Enabled || provider.IsFree) return "原服务商已停用或移除。请先选择服务商和模型。";
        if (!provider.Models.Any(model => model.Id == selection.ModelId && model.Enabled)) return "所选模型已停用或移除。请先选择一个模型。";
        if (provider.Key.Length == 0) return "请先在「模型服务」里填写服务商的密钥。";
        if (Models.AddressError(provider.Address, provider.Runtime) is { } wrong) return wrong;
        connection = new(provider.Address, selection.ModelId, provider.Key, provider.Runtime);
        return null;
    }

    public void Put(ModelProvider provider)
    {
        var index = configured.FindIndex(value => value.Id == provider.Id);
        var next = configured.ToList();
        if (index < 0) next.Add(provider);
        else next[index] = provider;
        Save(next);
    }

    public void Remove(string id) => Save([.. configured.Where(provider => provider.Id != id)]);

    public void CompleteImport()
    {
        if (PreviousChoice is null) return;
        var before = PreviousChoice;
        PreviousChoice = null;
        try { Save(configured); }
        catch { PreviousChoice = before; throw; }
    }

    private void Save(List<ModelProvider> providers)
    {
        var record = new JsonObject
        {
            ["providers"] = new JsonArray([.. providers.Select(provider => (JsonNode)provider.ToJson())]),
        };
        if (PreviousChoice is not null) record["previousChoice"] = PreviousChoice.ToJson();
        Secure.Write(FileName, record.ToJsonString());
        configured = providers;
        Changed?.Invoke();
    }

    private static ModelProviders Read()
    {
        if (Secure.Read(FileName) is { } protectedText)
        {
            var kept = JsonNode.Parse(protectedText)!.AsObject();
            RemoveOld();
            return new([.. kept["providers"]!.AsArray().Select(provider => ModelProvider.Of(provider!.AsObject()))],
                ModelChoice.Of(kept["previousChoice"]));
        }
        if (Storage.Read(OldChoice) is not { } old) return new([], null);
        var settings = JsonNode.Parse(old)!.AsObject();
        var key = Secure.Read(OldKey) ?? "";
        var address = (string?)settings["base"] ?? "";
        var model = (string?)settings["model"] ?? "";
        var runtime = (bool?)settings["runtime"] == true;
        var id = runtime ? RuntimeId : Guid.NewGuid().ToString("N");
        var usesOwn = (string?)settings["use"] == "own" && key.Length > 0 && model.Length > 0;
        var oldState = new ModelProviders([], usesOwn ? new(id, model) : ModelChoice.Free);
        if (key.Length > 0 || address != Models.Starting.Base || model != Models.Starting.Model)
        {
            var name = runtime ? RuntimeName : address == Models.Starting.Base ? "DeepSeek" : "我的 API";
            oldState.Save([new(id, name, address, key, Models.AddressError(address, runtime) is null, model.Length > 0 ? [new(model)] : [])]);
        }
        else oldState.Save([]);
        RemoveOld();
        return oldState;
    }

    private static void RemoveOld()
    {
        File.Delete(Storage.PathFor(OldChoice));
        Secure.Write(OldKey, null);
    }
}
