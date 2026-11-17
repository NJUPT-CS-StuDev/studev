using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using StuDev.Ai;

internal static class RuntimeTest
{
    private sealed class Endpoint : HttpMessageHandler
    {
        public readonly ConcurrentBag<string> Calls = [];
        public bool Fail;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.Method != HttpMethod.Delete || request.Headers.Authorization?.ToString() != "Bearer test-model-key") throw new InvalidOperationException("invalid close request");
            var path = request.RequestUri!.PathAndQuery;
            Calls.Add(path);
            return Task.FromResult(new HttpResponseMessage(Fail && path == "/v1/conversations/root?model=model-a" ? HttpStatusCode.ServiceUnavailable : HttpStatusCode.NotFound));
        }
    }
    public static async Task Check(Action<string, object?, JsonNode?> equal)
    {
        void Same(string name, object? value, object expected) => equal(name, value, JsonSerializer.SerializeToNode(expected));
        using var endpoint = new Endpoint { Fail = true };
        using var http = new HttpClient(endpoint);
        var own = new Own("http://127.0.0.1:9316/v1", "model-a", "test-model-key", true);
        var failed = false;
        try { await Models.CloseConversationsAsync(http, own, ["model-a", "model-b", "model-a"], ["root", "fork", "root"]); }
        catch (InvalidOperationException) { failed = true; }
        Same("runtime cleanup reports a failed close once", failed, true);
        Same("a close failure never skips another model or branch", endpoint.Calls.Order().ToArray(), new[] { "/v1/conversations/fork?model=model-a", "/v1/conversations/fork?model=model-b", "/v1/conversations/root?model=model-a", "/v1/conversations/root?model=model-b" });
        endpoint.Fail = false; endpoint.Calls.Clear();
        await Models.CloseConversationsAsync(http, own, ["model-a"], ["unknown"]);
        Same("closing an absent runtime conversation is idempotent", endpoint.Calls.Count, 1);
    }
}
