using StuDev.Data;

namespace StuDev.Ai;

/** Personal instructions used to live on this device apart from memory. Whatever one wrote there becomes lines of
 * memory once, so it follows the account like the rest, as on the web (src/campus/ai/instructions.ts). */
internal static class PersonalInstructions
{
    private const string File = "ai/instructions.txt";

    public static string? Fold(string memory)
    {
        var text = Storage.Read(File);
        if (text is null) return null;
        var next = memory;
        if (text.Trim() != Assistant.Shared.DefaultStyle.Trim())
            foreach (var line in text.Split('\n').Select(l => l.TrimStart('-', '*', '#', ' ', '\t').Trim()).Where(l => l.Length > 0))
            {
                try { next = Memory.Remembered(next, line); } catch (InvalidOperationException) { break; } catch (ArgumentException) { break; }
            }
        try { System.IO.File.Delete(Storage.PathFor(File)); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        return next;
    }
}
