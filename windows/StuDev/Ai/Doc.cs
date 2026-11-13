// A document as docstream reads it, drawn natively: the same reading of Markdown as the web's doc.tsx and Android's
// Doc.kt, over the same Rust kernel. Formulas and diagrams the kernel laid out are drawn from its outlines and paths,
// so they look alike everywhere. A diagram still being written shows as its source until it is whole.
using System.Text.Json.Nodes;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Markup;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using StuDev.Kernels.Docstream;
using StuDev.Ui;
using TextDecorations = Windows.UI.Text.TextDecorations;

namespace StuDev.Ai;

public static class Doc
{
    private static readonly Dictionary<string, string> Alerts = new() { ["note"] = "说明", ["tip"] = "提示", ["important"] = "重要", ["warning"] = "注意", ["caution"] = "小心" };
    private static readonly Dictionary<string, JsonObject> Formulas = new();
    private static readonly Dictionary<string, JsonObject?> Diagrams = new();
    private const double TextMiddle = 0.32;
    /** The smallest a diagram is drawn, as a share of its size: its 14px words stay about 10px. */
    private const double Smallest = 0.72;

    public static List<JsonObject> BlocksOf(string update) => JsonNode.Parse(update)!["blocks"]!.AsArray().Select(b => b!.AsObject()).ToList();
    public static List<JsonObject> Read(string text) { using var stream = new DocStream(); stream.Push(text); return BlocksOf(stream.Finish()); }

    private static string Type(JsonNode n) => (string)n["type"]!;
    private static string Str(JsonNode n, string key) => n[key]?.GetValue<string>() ?? "";
    private static List<JsonNode> List(JsonNode n, string key) => n[key]?.AsArray().Select(x => x!).ToList() ?? [];

    public static FrameworkElement Make(List<JsonObject> blocks, bool live = false, Action<string>? link = null)
    {
        var column = new StackPanel { Spacing = 10 };
        for (var i = 0; i < blocks.Count; i++) column.Children.Add(Block(blocks[i]["block"]!, link, live && i == blocks.Count - 1));
        return column;
    }

    private static FrameworkElement Block(JsonNode block, Action<string>? link, bool writing)
    {
        switch (Type(block))
        {
            case "paragraph":
            {
                var inlines = List(block, "inlines");
                if (!inlines.Any(i => Type(i) == "math" && i["display"]?.GetValue<bool>() == true)) return Text(inlines, 16, link: link, caret: writing);
                // Display math amid the text is set on a line of its own.
                var column = new StackPanel { Spacing = 4 }; var run = new List<JsonNode>();
                void Flush() { if (run.Any(r => Type(r) != "text" || Str(r, "text").Trim().Length > 0)) column.Children.Add(Text(run, 16, link: link)); run = []; }
                foreach (var inline in inlines) { if (Type(inline) == "math" && inline["display"]?.GetValue<bool>() == true) { Flush(); column.Children.Add(MathBlock(Str(inline, "tex"))); } else run.Add(inline); }
                Flush();
                return column;
            }
            case "heading": return Text(List(block, "inlines"), (int)block["level"]! switch { 1 => 20, 2 => 18, _ => 16.5 }, true, link, writing);
            case "quote":
            {
                var inner = new StackPanel { Spacing = 8 };
                foreach (var b in List(block, "blocks")) inner.Children.Add(Block(b, link, false));
                return new Border { BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(3, 0, 0, 0), Padding = new Thickness(12, 0, 0, 0), Child = inner };
            }
            case "alert":
            {
                var danger = Str(block, "kind") is "warning" or "caution";
                var tone = danger ? "danger" : "brand";
                var inner = new StackPanel { Spacing = 6 };
                inner.Children.Add(Kit.Text(Alerts.GetValueOrDefault(Str(block, "kind")) ?? "", Role.Label, tone, bold: true));
                foreach (var b in List(block, "blocks")) inner.Children.Add(Block(b, link, false));
                return new Border { CornerRadius = new CornerRadius(10), Background = Paint.Faded(tone, .07), Padding = new Thickness(14, 10, 14, 10), Child = inner };
            }
            case "list":
            {
                var ordered = (bool)block["ordered"]!; var start = (long)block["start"]!;
                var column = new StackPanel { Spacing = 4 };
                var items = List(block, "items");
                for (var at = 0; at < items.Count; at++)
                {
                    var item = items[at];
                    var row = new Grid { ColumnSpacing = 8 };
                    row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(22) }); row.ColumnDefinitions.Add(new ColumnDefinition());
                    FrameworkElement mark = item["checked"] is JsonValue c && c.TryGetValue<bool>(out var on)
                        ? new Border { Width = 14, Height = 14, CornerRadius = new CornerRadius(4), Margin = new Thickness(0, 6, 0, 0), Background = on ? Paint.Brush("brand") : Paint.Clear, BorderBrush = on ? Paint.Brush("brand") : Paint.Brush("faint"), BorderThickness = new Thickness(1.5) }
                        : Kit.Text(ordered ? $"{start + at}." : "•", Role.Body, "muted");
                    mark.HorizontalAlignment = HorizontalAlignment.Right; mark.VerticalAlignment = VerticalAlignment.Top;
                    row.Children.Add(mark);
                    var inner = new StackPanel { Spacing = 4 };
                    foreach (var b in List(item, "blocks")) inner.Children.Add(Block(b, link, false));
                    Grid.SetColumn(inner, 1); row.Children.Add(inner);
                    column.Children.Add(row);
                }
                return column;
            }
            case "code":
            {
                var source = Str(block, "text");
                if (Str(block, "language") == "mermaid" && !writing && Diagram(source) is { } drawn) return DiagramView(drawn, source);
                var head = new Grid { Background = Paint.Brush("surfaceSunken"), Padding = new Thickness(12, 4, 8, 4) };
                head.ColumnDefinitions.Add(new ColumnDefinition()); head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                head.Children.Add(Kit.Text(Str(block, "language") is { Length: > 0 } language ? language : "代码", Role.Caption, "muted"));
                var copy = new Tap { Content = Kit.Text("复制", Role.Caption, "muted") };
                copy.Click += (_, _) =>
                {
                    var data = new Windows.ApplicationModel.DataTransfer.DataPackage(); data.SetText(source);
                    Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(data); ((TextBlock)copy.Content).Text = "已复制";
                };
                Grid.SetColumn(copy, 1); head.Children.Add(copy);
                var code = new TextBlock { Text = source, FontFamily = Kit.Mono, FontSize = 13, LineHeight = 20, Foreground = Paint.Brush("ink"), IsTextSelectionEnabled = true, Margin = new Thickness(12) };
                var body = new ScrollViewer { Content = code, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollMode = ScrollMode.Auto, VerticalScrollMode = ScrollMode.Disabled, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled };
                return new Border { CornerRadius = new CornerRadius(10), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(1), Child = Kit.Column(0, head, body) };
            }
            case "math": return MathBlock(Str(block, "tex"));
            case "table":
            {
                var head = block["head"]!.AsArray().Select(c => c!.AsArray().Select(x => x!).ToList()).ToList();
                var rows = block["rows"]!.AsArray().Select(r => r!.AsArray().Select(c => c!.AsArray().Select(x => x!).ToList()).ToList()).ToList();
                var align = block["align"]!.AsArray().Select(a => (string)a! switch { "center" => TextAlignment.Center, "right" => TextAlignment.Right, _ => TextAlignment.Left }).ToList();
                string Plain(List<JsonNode> cell) => string.Concat(cell.Select(i => Type(i) switch { "text" or "code" => Str(i, "text"), "math" => Str(i, "tex"), _ => Plain(List(i, "children")) }));
                var all = new List<List<List<JsonNode>>> { head }; all.AddRange(rows);
                var grid = new Grid();
                for (var c = 0; c < head.Count; c++) grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Clamp(all.Max(r => c < r.Count ? Plain(r[c]).Length : 0) * 15 + 28, 72, 240)) });
                for (var r = 0; r < all.Count; r++)
                {
                    grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                    var ground = new Border { Background = r == 0 ? Paint.Brush("surfaceSunken") : Paint.Clear, BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 0, 0, r < rows.Count ? 1 : 0) };
                    Grid.SetRow(ground, r); Grid.SetColumnSpan(ground, Math.Max(1, head.Count)); grid.Children.Add(ground);
                    for (var c = 0; c < head.Count; c++)
                    {
                        var text = Text(c < all[r].Count ? all[r][c] : [], 14, r == 0, link);
                        text.TextAlignment = c < align.Count ? align[c] : TextAlignment.Left; text.Margin = new Thickness(12, 8, 12, 8);
                        Grid.SetRow(text, r); Grid.SetColumn(text, c); grid.Children.Add(text);
                    }
                }
                var scroll = new ScrollViewer { Content = grid, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollMode = ScrollMode.Auto, VerticalScrollMode = ScrollMode.Disabled, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled };
                return new Border { CornerRadius = new CornerRadius(10), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(1), Child = scroll, HorizontalAlignment = HorizontalAlignment.Left };
            }
            case "rule": return Kit.Hairline();
            default: return Kit.Text(Str(block, "text"), Role.Label, "muted", wrap: true);
        }
    }

    /** Inline text: strong, emphasis, struck, marked, code, formulas set in the line, links. */
    private static RichTextBlock Text(List<JsonNode> inlines, double size, bool bold = false, Action<string>? link = null, bool caret = false)
    {
        var block = new RichTextBlock { FontSize = size, LineHeight = size * 1.625, Foreground = Paint.Brush("ink"), IsTextSelectionEnabled = true, TextWrapping = TextWrapping.Wrap, FontWeight = bold ? FontWeights.SemiBold : FontWeights.Normal };
        var paragraph = new Paragraph();
        void Walk(List<JsonNode> items, InlineCollection into)
        {
            foreach (var inline in items)
                switch (Type(inline))
                {
                    case "text": into.Add(new Run { Text = Str(inline, "text") }); break;
                    case "strong": { var s = new Span { FontWeight = FontWeights.SemiBold }; Walk(List(inline, "children"), s.Inlines); into.Add(s); break; }
                    case "emphasis": { var s = new Span { FontStyle = Windows.UI.Text.FontStyle.Italic }; Walk(List(inline, "children"), s.Inlines); into.Add(s); break; }
                    case "strike": { var s = new Span { TextDecorations = TextDecorations.Strikethrough }; Walk(List(inline, "children"), s.Inlines); into.Add(s); break; }
                    case "highlight": { var s = new Span { Foreground = Paint.Brush("ink"), FontWeight = FontWeights.SemiBold }; Walk(List(inline, "children"), s.Inlines); into.Add(s); break; }
                    case "superscript": case "subscript":
                    {
                        var s = new Span { FontSize = size * .72 }; Typography.SetVariants(s, Type(inline) == "superscript" ? FontVariants.Superscript : FontVariants.Subscript);
                        Walk(List(inline, "children"), s.Inlines); into.Add(s); break;
                    }
                    case "code": into.Add(new InlineUIContainer { Child = new Border { Background = Paint.Brush("surfaceSunken"), CornerRadius = new CornerRadius(5), Padding = new Thickness(4, 0, 4, 1), Margin = new Thickness(1, 0, 1, -4),
                        Child = new TextBlock { Text = Str(inline, "text"), FontFamily = Kit.Mono, FontSize = size * .88, Foreground = Paint.Brush("ink") } } }); break;
                    case "math": into.Add(new InlineUIContainer { Child = Formula(Str(inline, "tex"), inline["display"]?.GetValue<bool>() == true, size) }); break;
                    case "link":
                    {
                        var href = Str(inline, "href");
                        var h = new Hyperlink { Foreground = Paint.Brush("brand"), UnderlineStyle = UnderlineStyle.Single };
                        h.Click += async (_, _) => { if (href.StartsWith('/')) link?.Invoke(href); else if (Uri.TryCreate(href, UriKind.Absolute, out var uri)) await Windows.System.Launcher.LaunchUriAsync(uri); };
                        Walk(List(inline, "children"), h.Inlines); into.Add(h); break;
                    }
                    case "image": into.Add(new Run { Text = $"［图片：{Str(inline, "alt")}］", Foreground = Paint.Brush("muted") }); break;
                    case "break": into.Add(new LineBreak()); break;
                }
        }
        Walk(inlines, paragraph.Inlines);
        if (caret) paragraph.Inlines.Add(new Run { Text = " ●", Foreground = Paint.Brush("ink") });
        block.Blocks.Add(paragraph);
        return block;
    }

    private static Geometry Path(string data) => (Geometry)XamlBindingHelper.ConvertValue(typeof(Geometry), data);

    private static JsonObject FormulaOf(string tex, bool display)
    {
        var key = (display ? "D" : "T") + tex;
        if (!Formulas.TryGetValue(key, out var formula)) Formulas[key] = formula = JsonNode.Parse(DocstreamNativeMethods.Math(tex, display))!.AsObject();
        return formula;
    }

    /** A formula drawn at `em` pixels to the em, its baseline `baseline` from the top, from the kernel's outlines. */
    private static Canvas Draw(JsonObject f, double em, double baseline, double width, double height, string tex)
    {
        var canvas = new Canvas { Width = Math.Max(1, width), Height = Math.Max(1, height) };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(canvas, tex);
        var glyphs = f["glyphs"]!.AsObject();
        foreach (var item in f["items"]!.AsArray())
        {
            double N(string k) => (double)item![k]!;
            switch ((string)item!["type"]!)
            {
                case "glyph":
                {
                    var scale = N("scale") * em;
                    var path = new Microsoft.UI.Xaml.Shapes.Path { Data = Path((string)glyphs[((int)item["id"]!).ToString()]!), Fill = Paint.Brush("ink"),
                        RenderTransform = new CompositeTransform { ScaleX = scale, ScaleY = scale, TranslateX = N("x") * em, TranslateY = baseline - N("y") * em } };
                    canvas.Children.Add(path); break;
                }
                case "rule":
                {
                    var rect = new Rectangle { Width = Math.Max(.5, N("width") * em), Height = Math.Max(.5, N("height") * em), Fill = Paint.Brush("ink") };
                    Canvas.SetLeft(rect, N("x") * em); Canvas.SetTop(rect, baseline - N("y") * em); canvas.Children.Add(rect); break;
                }
                case "text":
                {
                    var size = N("size") * em;
                    var t = new TextBlock { Text = (string)item["text"]!, FontSize = size, Foreground = Paint.Brush("ink") };
                    Canvas.SetLeft(t, N("x") * em); Canvas.SetTop(t, baseline - N("y") * em - size * .8); canvas.Children.Add(t); break;
                }
            }
        }
        return canvas;
    }

    private static FrameworkElement Formula(string tex, bool display, double size)
    {
        var f = FormulaOf(tex, display);
        double width = (double)f["width"]!, height = (double)f["height"]!, depth = (double)f["depth"]!;
        var line = 2 * Math.Max(height - TextMiddle, depth + TextMiddle);
        var canvas = Draw(f, size, line * size / 2 + TextMiddle * size, width * size, line * size, tex);
        canvas.Margin = new Thickness(0, 0, 0, -(line * size / 2 - size * .32));
        return canvas;
    }

    private static FrameworkElement MathBlock(string tex)
    {
        var f = FormulaOf(tex, true); var em = 16 * 1.08;
        double width = (double)f["width"]!, height = (double)f["height"]!, depth = (double)f["depth"]!;
        var canvas = Draw(f, em, height * em, width * em, (height + depth) * em, tex);
        canvas.HorizontalAlignment = HorizontalAlignment.Center;
        return new ScrollViewer { Content = canvas, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollMode = ScrollMode.Auto, VerticalScrollMode = ScrollMode.Disabled, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled, Padding = new Thickness(0, 4, 0, 4) };
    }

    private static JsonObject? Diagram(string source)
    {
        if (!Diagrams.TryGetValue(source, out var laid)) Diagrams[source] = laid = DocstreamNativeMethods.Diagram(source) is { } json ? JsonNode.Parse(json)!.AsObject() : null;
        return laid;
    }

    /** A diagram fitted to the width, never larger than laid out, never smaller than `Smallest`; past that it scrolls. */
    private static FrameworkElement DiagramView(JsonObject d, string source)
    {
        double x = (double)d["x"]!, y = (double)d["y"]!, width = (double)d["width"]!, height = (double)d["height"]!;
        var canvas = new Canvas { Width = width, Height = height };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(canvas, source);
        foreach (var item in d["items"]!.AsArray())
        {
            if ((string)item!["type"]! == "path")
            {
                var fill = (string?)item["fill"];
                var stroke = (double)item["stroke"]!;
                var shape = new Microsoft.UI.Xaml.Shapes.Path
                {
                    Data = Path((string)item["d"]!), Fill = fill == "soft" ? Paint.Faded("ink", .06) : fill == "solid" ? Paint.Brush("ink") : null,
                    Stroke = stroke > 0 ? Paint.Brush("ink") : null, StrokeThickness = stroke, StrokeLineJoin = PenLineJoin.Round, StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round,
                    RenderTransform = new TranslateTransform { X = -x, Y = -y },
                };
                if (item["dash"]?.GetValue<bool>() == true && stroke > 0) shape.StrokeDashArray = [5 / stroke, 4 / stroke];
                canvas.Children.Add(shape);
            }
            else
            {
                var size = (double)item["size"]!;
                var text = new TextBlock { Text = (string)item["text"]!, FontSize = size, Foreground = Paint.Brush("ink"), FontWeight = item["bold"]?.GetValue<bool>() == true ? FontWeights.SemiBold : FontWeights.Normal };
                text.Measure(new Windows.Foundation.Size(double.PositiveInfinity, double.PositiveInfinity));
                Canvas.SetLeft(text, (double)item["x"]! - x - text.DesiredSize.Width / 2); Canvas.SetTop(text, (double)item["y"]! - y - text.DesiredSize.Height / 2);
                canvas.Children.Add(text);
            }
        }
        var box = new Viewbox { Child = canvas, Stretch = Stretch.Uniform, HorizontalAlignment = HorizontalAlignment.Center, Width = width * Smallest, Height = height * Smallest };
        var scroll = new ScrollViewer { Content = box, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollMode = ScrollMode.Auto, VerticalScrollMode = ScrollMode.Disabled, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled };
        // The frame is as wide as the answer; the drawing fits it, and scrolls inside it once it would be too small.
        var frame = new Grid();
        frame.Children.Add(scroll);
        frame.SizeChanged += (_, e) => { var fit = Math.Clamp(e.NewSize.Width / width, Smallest, 1); box.Width = width * fit; box.Height = height * fit; };
        return frame;
    }
}
