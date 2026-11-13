// What only this Windows user may read: the account's tokens and one's own API key, kept on disk encrypted with DPAPI
// for the current user, as Android keeps them under its Keystore.
using System.Security.Cryptography;
using System.Text;

namespace StuDev.Data;

public static class Secure
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("studev-windows-v1");
    public static string? Read(string name)
    {
        var path = Storage.PathFor(name);
        if (!File.Exists(path)) return null;
        return Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(path), Entropy, DataProtectionScope.CurrentUser));
    }
    public static void Write(string name, string? value)
    {
        var path = Storage.PathFor(name);
        if (value is null) { File.Delete(path); return; }
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var pending = path + "." + Guid.NewGuid().ToString("N") + ".pending";
        try { File.WriteAllBytes(pending, ProtectedData.Protect(Encoding.UTF8.GetBytes(value), Entropy, DataProtectionScope.CurrentUser)); File.Move(pending, path, true); }
        finally { if (File.Exists(pending)) File.Delete(pending); }
    }
}
