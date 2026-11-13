// How names are shortened and rooms are said; the same table and results as src/campus/world/names.ts.
using System.Text.RegularExpressions;

namespace StuDev.World;

public static partial class Names
{
    private static readonly Dictionary<string, string> Short = new()
    {
        ["习近平新时代中国特色社会主义思想概论"] = "习概", ["毛泽东思想和中国特色社会主义理论体系概论"] = "毛概",
        ["马克思主义基本原理"] = "马原", ["思想道德与法治"] = "思修", ["中国近现代史纲要"] = "近代史", ["形势与政策"] = "形策",
        ["计算机通信与网络"] = "计网", ["计算机组成原理"] = "组成原理", ["操作系统基础"] = "操作系统", ["计算机图形学"] = "图形学",
        ["信息安全技术"] = "信息安全", ["单片机原理及系统设计"] = "单片机", ["嵌入式手机终端开发技术"] = "嵌入式开发",
    };
    [GeneratedRegex("[（(].*?[)）]")] private static partial Regex Brackets();
    [GeneratedRegex("^[^/:]*[/:]")] private static partial Regex Campus();
    public static string Course(string name) { var plain = Brackets().Replace(name, "").Trim(); return plain.Length > 0 ? plain : name.Trim(); }
    public static string CourseShort(string name) => Short.TryGetValue(Course(name), out var said) ? said : Course(name);
    public static string Room(string? room) => Campus().Replace(room ?? "", "", 1).Replace('/', ' ');
    /** A room said short on a tight tile: 教4 101 becomes 4 101. */
    public static string RoomShort(string? room) { var label = Room(room); return label.StartsWith('教') ? label[1..] : label; }
    public static string CompactPlace(string place) => Regex.Replace(Regex.Replace(place, @"^(?:计算机学科楼|计算机楼|计科楼)[-\s]*", "CS-"), @"\d+(?:/\d+){2,}", rooms => $"{rooms.Value.Split('/')[0]}等{rooms.Value.Split('/').Length}间");
    /** A slash means the map has it. */
    public static bool Placed(string? room) => !string.IsNullOrEmpty(room) && room.Contains('/');
}
