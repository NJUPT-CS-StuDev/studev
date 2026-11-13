// One's tasks and timetable settings kept in step with one's other devices while signed in, as startSync in
// src/campus/world/sync.ts and Android's Sync.kt: on opening, on signing in, and shortly after any change here,
// merged by the same rules (the later change of each task and of each part of the settings wins). Signed out, they
// stay on this device; AI conversations never leave it.
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.UI.Dispatching;
using StuDev.Data;
using StuDev.World;

namespace StuDev.Me;

public sealed class Sync
{
    private readonly Campus campus;
    private readonly DispatcherQueueTimer later;
    private bool running;

    public Sync(Campus campus, DispatcherQueue queue)
    {
        this.campus = campus;
        later = queue.CreateTimer(); later.Interval = TimeSpan.FromMilliseconds(1500); later.IsRepeating = false;
        later.Tick += async (_, _) => await Run();
        // A change taken from a sync is not one made here, and is not sent back.
        campus.Tasks.Saved += adopted => { if (!adopted) Soon(); };
        campus.Preferences.Saved += adopted => { if (!adopted) Soon(); };
        Account.Shared.Changed += Soon;
        Soon();
    }
    public void Soon() { later.Stop(); later.Start(); }

    private async Task Run()
    {
        if (running || Account.Shared.User is not { } user) return;
        running = true;
        try
        {
            var sent = campus.Tasks.All.ToList();
            var mine = campus.Preferences.Snapshot();
            var result = await Account.Shared.Request("/sync", new JsonObject { ["tasks"] = JsonSerializer.SerializeToNode(sent, Storage.Json), ["settings"] = SettingsSync.PartsOf(mine) });
            if (Account.Shared.User?.Id != user.Id) return;
            campus.Tasks.Adopt(result["tasks"].Deserialize<List<PersonalTask>>(Storage.Json) ?? []);
            if (SettingsSync.Taken(campus.Preferences.Snapshot(), result["settings"] as JsonObject ?? []) is { } taken) campus.Preferences.Adopt(taken);
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or PlatformFailure or JsonException or IOException) { /* Offline or signed out: they stay here and go next time. */ }
        finally { running = false; }
    }
}
