using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using StuDev.Ui;

namespace StuDev.Ai;

/** Browse only a user-chosen project or reference folder. The file editor never creates arbitrary files. */
internal sealed class ProjectFiles(ProjectFolder folder, bool writable, Action back)
{
    public void Show() => Directory(folder.Root);

    private void Directory(string path)
    {
        var body = Body(Path.GetFileName(path), back);
        if (!path.Equals(folder.Root, StringComparison.OrdinalIgnoreCase))
            body.Children.Add(Kit.TextAction("上一级", () => Directory(Path.GetDirectoryName(path)!), Icons.Back, "ink"));
        var status = Kit.Text("", Role.Caption, "muted", wrap: true);
        try
        {
            var entries = folder.Entries(path).ToList();
            foreach (var entry in entries)
            {
                var words = Kit.Line(8, Kit.Text(entry.Name, Role.Label), Kit.Text(entry.Directory ? "目录" : "", Role.Caption, "muted"));
                body.Children.Add(Kit.Row("", words, entry.Directory ? () => Directory(entry.Path) : () => Text(entry.Path, path, status)));
            }
            if (entries.Count == 0) status.Text = "这里没有文件。";
        }
        catch (Exception failure) when (ProjectFolder.IsProblem(failure)) { status.Text = "未能读取这个文件夹。"; }
        body.Children.Add(status);
        App.Window?.Sheet(body, 540);
    }

    private void Text(string path, string directory, TextBlock note)
    {
        string original;
        try { original = folder.TextFile(path); }
        catch (Exception failure) when (ProjectFolder.IsProblem(failure))
        { note.Text = "暂时无法预览此文件，请使用本机编辑器。"; return; }
        var body = Body(Path.GetFileName(path), () => Directory(directory));
        var field = Kit.Field(original, "", writable ? "文件内容" : "只读文件内容");
        field.IsReadOnly = !writable; field.AcceptsReturn = true; field.TextWrapping = TextWrapping.Wrap;
        field.MinHeight = 210; field.MaxHeight = 420;
        body.Children.Add(field);
        var status = Kit.Text(writable ? "" : "参考文件为只读。", Role.Caption, "muted", wrap: true);
        body.Children.Add(status);
        if (writable)
        {
            var save = Kit.Action("保存文件", () =>
            {
                try { folder.SaveTextFile(path, field.Text, original); original = field.Text; status.Text = "已保存"; }
                catch (Exception failure) when (ProjectFolder.IsProblem(failure)) { status.Text = "未能保存。文件可能已在另一端修改，请重新打开。"; }
            }, true);
            save.HorizontalAlignment = HorizontalAlignment.Right;
            body.Children.Add(save);
        }
        App.Window?.Sheet(body, 560);
    }

    private static StackPanel Body(string name, Action back)
    {
        var body = Kit.Column(8, Pages.SheetHead(Pages.SheetTitle(name.Length == 0 ? "项目文件" : name), back));
        body.Padding = new Thickness(22, 20, 22, 18);
        return body;
    }
}
