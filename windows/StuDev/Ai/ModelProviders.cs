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
    public const string RuntimeExperiment = "本机浏览器模型（实验）";
    public const string RuntimeDisabled = "本机浏览器模型已关闭。可在「我 → 模型服务」重新开启，也可以选择其他模型。";
    private const string FileName = "ai/providers.bin";
    private const string OldChoice = "ai/model.json";
    private const string OldKey = "ai/key.bin";
    private static readonly ModelProvider Free = new(ModelChoice.Free.ProviderId, Assistant.Shared.FreeService.ProviderName, "", "", true, [new(ModelChoice.Free.ModelId)]);
    public static readonly ModelProviders Shared = Read();
    private List<ModelProvider> configured;
    public ModelChoice? PreviousChoice { get; private set; }
    public bool RuntimeEnabled { get; private set; }
    public IEnumerable<ModelProvider> Visible => configured.Where(provider => !provider.Runtime || RuntimeEnabled);
    public IEnumerable<ModelProvider> Available => Visible.Where(provider => provider.Enabled && provider.Key.Length > 0 && provider.Models.Any(model => model.Enabled)).Prepend(Free);
    public event Action? Changed;

    private ModelProviders(List<ModelProvider> configured, ModelChoice? previousChoice, bool runtimeEnabled = false)
    {
        this.configured = configured;
        PreviousChoice = previousChoice;
        RuntimeEnabled = runtimeEnabled;
    }

    public ModelProvider? Find(string id) => id == Free.Id ? Free : configured.FirstOrDefault(provider => provider.Id == id);

    public string? Resolve(ModelChoice selection, out Own? connection)
    {
        connection = null;
        if (selection == ModelChoice.Free) return null;
        if (selection.ProviderId == RuntimeId && !RuntimeEnabled) return RuntimeDisabled;
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
        Save(next, RuntimeEnabled);
    }

    public void Remove(string id) => Save([.. configured.Where(provider => provider.Id != id)], RuntimeEnabled);
    public void SetRuntimeEnabled(bool enabled)
    {
        if (enabled != RuntimeEnabled) Save(configured, enabled);
    }

    public void CompleteImport()
    {
        if (PreviousChoice is null) return;
        var before = PreviousChoice;
        PreviousChoice = null;
        try { Save(configured, RuntimeEnabled); }
        catch { PreviousChoice = before; throw; }
    }

    private void Save(List<ModelProvider> providers, bool runtimeEnabled)
    {
        var record = new JsonObject
        {
            ["providers"] = new JsonArray([.. providers.Select(provider => (JsonNode)provider.ToJson())]),
            ["runtimeEnabled"] = runtimeEnabled,
        };
        if (PreviousChoice is not null) record["previousChoice"] = PreviousChoice.ToJson();
        Secure.Write(FileName, record.ToJsonString());
        configured = providers;
        RuntimeEnabled = runtimeEnabled;
        Changed?.Invoke();
    }

    private static ModelProviders Read()
    {
        if (Secure.Read(FileName) is { } protectedText)
        {
            var kept = JsonNode.Parse(protectedText)!.AsObject();
            RemoveOld();
            return new([.. kept["providers"]!.AsArray().Select(provider => ModelProvider.Of(provider!.AsObject()))],
                ModelChoice.Of(kept["previousChoice"]), (bool?)kept["runtimeEnabled"] == true);
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
            oldState.Save([new(id, name, address, key, Models.AddressError(address, runtime) is null, model.Length > 0 ? [new(model)] : [])], false);
        }
        else oldState.Save([], false);
        RemoveOld();
        return oldState;
    }

    private static void RemoveOld()
    {
        File.Delete(Storage.PathFor(OldChoice));
        Secure.Write(OldKey, null);
    }
}
