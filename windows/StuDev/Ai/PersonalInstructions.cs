using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using StuDev.Data;
using StuDev.Ui;

namespace StuDev.Ai;

internal static class PersonalInstructions
{
    private const string File = "ai/instructions.txt";
    public static string? Read() => Storage.Read(File);

    public static void Fill(StackPanel page)
    {
        page.Children.Add(Kit.Text("这些指令适用于这台设备上的 StuDev AI。项目指令只在该项目里生效。", Role.Label, "muted", wrap: true));
        var current = Read();
        var input = Kit.Field(current ?? Assistant.Shared.DefaultStyle, "例如：优先给出结论，再解释依据。", "个人指令");
        input.AcceptsReturn = true; input.TextWrapping = TextWrapping.Wrap; input.MaxLength = 4000; input.MinHeight = 168;
        input.Margin = new Thickness(0, 12, 0, 8);
        page.Children.Add(input);
        var result = Kit.Text("", Role.Caption, "muted");
        var save = Kit.Action("保存", () =>
        {
            try { Storage.Write(Storage.PathFor(File), input.Text.Trim()); result.Text = "已保存"; }
            catch (IOException) { result.Text = "未能保存个人指令。"; }
            catch (UnauthorizedAccessException) { result.Text = "未能保存个人指令。"; }
        }, true);
        save.HorizontalAlignment = HorizontalAlignment.Right;
        page.Children.Add(save);
        page.Children.Add(result);
    }
}
