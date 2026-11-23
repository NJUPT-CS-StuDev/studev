using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using StuDev.Data;

namespace StuDev.Me;

/** The small, public picture of the locally restored account. Session tokens never enter this cache. */
internal static class AvatarCache
{
    private const int MaxBytes = 256 * 1024;
    private static readonly HttpClient Http = new() { Timeout = Timeout.InfiniteTimeSpan };
    private static readonly TimeSpan FreshFor = TimeSpan.FromDays(1);
    private static readonly object Gate = new();
    private static readonly Dictionary<string, Task<byte[]?>> Pending = new();

    internal static string? Address(AccountUser user)
    {
        var qq = user.Qq.Trim();
        return qq.Length is >= 5 and <= 12 && qq[0] is >= '1' and <= '9' && qq.All(c => c is >= '0' and <= '9')
            ? $"https://q1.qlogo.cn/g?b=qq&nk={qq}&s=100" : null;
    }

    internal static string FileFor(string userId, string address) =>
        Storage.CacheFor("avatar-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(userId + "\n" + address))) + ".img");

    internal static async Task<(byte[]? Bytes, bool Fresh)> Read(string file)
    {
        try
        {
            var entry = new FileInfo(file);
            if (!entry.Exists || entry.Length is <= 0 or > MaxBytes) return (null, false);
            var fresh = DateTime.UtcNow - entry.LastWriteTimeUtc < FreshFor;
            var bytes = await File.ReadAllBytesAsync(file);
            return bytes.Length is > 0 and <= MaxBytes ? (bytes, fresh) : (null, false);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return (null, false); }
    }

    internal static Task<byte[]?> Fetch(string address)
    {
        lock (Gate)
        {
            if (Pending.TryGetValue(address, out var active)) return active;
            var request = Download(address);
            Pending[address] = request;
            _ = request.ContinueWith(_ => { lock (Gate) Pending.Remove(address); }, TaskScheduler.Default);
            return request;
        }
    }

    private static async Task<byte[]?> Download(string address)
    {
        try
        {
            using var cancel = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            using var response = await Http.GetAsync(address, HttpCompletionOption.ResponseHeadersRead, cancel.Token).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode || response.Content.Headers.ContentLength is > MaxBytes ||
                response.Content.Headers.ContentType?.MediaType is not ("image/jpeg" or "image/png" or "image/webp" or "image/gif")) return null;
            await using var stream = await response.Content.ReadAsStreamAsync(cancel.Token).ConfigureAwait(false);
            using var kept = new MemoryStream();
            var buffer = new byte[8192];
            for (int read; (read = await stream.ReadAsync(buffer, cancel.Token).ConfigureAwait(false)) > 0;)
            {
                if (kept.Length + read > MaxBytes) return null;
                kept.Write(buffer, 0, read);
            }
            return kept.Length > 0 ? kept.ToArray() : null;
        }
        catch (Exception error) when (error is HttpRequestException or OperationCanceledException or IOException) { return null; }
    }

    internal static async Task Write(string file, byte[] bytes)
    {
        var pending = file + "." + Guid.NewGuid().ToString("N") + ".pending";
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            await File.WriteAllBytesAsync(pending, bytes).ConfigureAwait(false);
            File.Move(pending, file, true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
        finally
        {
            try { File.Delete(pending); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
        }
    }
}
