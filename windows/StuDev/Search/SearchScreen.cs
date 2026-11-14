// The one way in: everything searchable is one document in one index, so a query has one ranking, one set of
// highlights and one way to page — here, on the web and in the app. SearchApp.tsx and RoomsBrowse.tsx, natively.
using System.Text.Json.Nodes;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using StuDev.Data;
using StuDev.Ui;
using StuDev.World;

namespace StuDev.Search;

public sealed record Channel(string Id, string Label, List<string>? Sources = null, List<string>? Excluded = null, bool Dated = false);

public sealed partial class SearchScreen : Screen
{
    private const int PageSize = 10;
    private static readonly List<Channel> Channels = System.Text.Json.JsonSerializer.Deserialize<List<Channel>>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "world", "channels.json")), Storage.Json)!;
    private static readonly HashSet<string> Entities = ["courses", "teachers", "classes", "teaching-classes", "exams", "rooms", "places"];
    private static readonly (string Value, string Label)[] Since = [("", "全部时间"), ("3", "近三天"), ("7", "近一周"), ("30", "近一月"), ("365", "近一年")];
    private static readonly string[] Campuses = ["仙林", "三牌楼", "锁金"];
    private readonly Campus campus = Campus.Shared;
    private readonly TextBox box;
    private readonly StackPanel body = new();
    private readonly StackPanel chips = new();
    private NativeSearch? search;
    private Channel channel = Channels[0];
    private string since = "";
    private int page = 1;
    private CancellationTokenSource? running;
    private (List<JsonObject> Results, int Total, double Seconds)? answer;
    private bool failed;
    private Moment? roomsAt;
    private string roomsCampus = Campuses[0];
    private string? roomsBuilding;
    private bool roomsAll;

    public SearchScreen()
    {
        box = Kit.Field("", "搜课程、老师、班级、地点、通知、资料", "搜索");
        box.FontSize = 15.5; box.MinHeight = 44;
        box.TextChanged += (_, _) => { page = 1; Run(); };
        var column = new StackPanel();
        var field = new Grid();
        field.Children.Add(box);
        var glass = Kit.Icon(Icons.Magnifier, 17, "muted", 20); glass.HorizontalAlignment = HorizontalAlignment.Left; glass.Margin = new Thickness(12, 0, 0, 0);
        box.Padding = new Thickness(38, 10, 8, 10);
        field.Children.Add(glass);
        column.Children.Add(field);
        column.Children.Add(chips);
        column.Children.Add(body);
        Children.Add(Pages.Frame(column, 680));
        box.Loaded += (_, _) => box.Focus(FocusState.Programmatic);
        Paint.Turned += Draw;
        campus.Changed += () => DispatcherQueue.TryEnqueue(() => { if (search is null && campus.Repository is not null) Draw(); });
        _ = campus.Load();
        Draw();
    }

    public override void Shown(object? argument)
    {
        if (argument is ValueTuple<string, Moment> { Item1: "rooms" } rooms) { channel = Channels.First(c => c.Id == "room"); box.Text = ""; roomsAt = rooms.Item2; Draw(); }
        else if (argument is ValueTuple<string, string> { Item1: "query" } query) { box.Text = query.Item2; }
        else if (argument is ValueTuple<string, string> { Item1: "channel" } scope && Channels.FirstOrDefault(c => c.Id == scope.Item2) is { } chosen) { channel = chosen; page = 1; Run(); Draw(); }
        DispatcherQueue.TryEnqueue(() => box.Focus(FocusState.Programmatic));
    }

    private bool Live => channel.Id == "room" && box.Text.Trim().Length == 0;

    private JsonObject Filters()
    {
        var query = box.Text.Trim();
        var filters = new JsonObject();
        if (channel.Sources is { } sources) filters["sourceIds"] = new JsonArray([.. sources.Select(s => (JsonNode)s)]);
        if (channel.Excluded is { } excluded)
            filters["excludedSourceIds"] = new JsonArray([.. (channel.Id == "all" && System.Text.RegularExpressions.Regex.IsMatch(query, @"\S\s+\S") ? excluded.Where(id => id != "teaching-classes") : excluded).Select(s => (JsonNode)s)]);
        string Ago(int days) => DateTime.UtcNow.AddDays(-days).ToString("yyyy-MM-dd");
        if (since.Length > 0) { filters["publishedFrom"] = Ago(int.Parse(since)); filters["publishedTo"] = Ago(0); filters["includeUndated"] = false; }
        else if (query.Length == 0) { filters["publishedTo"] = Ago(0); filters["includeUndated"] = true; }
        return filters;
    }

    private async void Run()
    {
        running?.Cancel();
        var query = box.Text.Trim();
        if (query.Length == 1 || Live || campus.Repository is null) { answer = null; Draw(); return; }
        search ??= new NativeSearch(campus.Repository);
        var cancel = (running = new CancellationTokenSource()).Token;
        var started = System.Diagnostics.Stopwatch.StartNew();
        failed = false;
        try
        {
            await Task.Delay(120, cancel);
            var done = await search.Page(query, PageSize, "relevance", Filters(), (page - 1) * PageSize,
                ranked => { if (!cancel.IsCancellationRequested) { answer = (ranked.Results, ranked.Total, started.Elapsed.TotalSeconds); Draw(); } }, cancel);
            if (cancel.IsCancellationRequested) return;
            answer = (done.Results, done.Total, answer?.Seconds ?? started.Elapsed.TotalSeconds);
        }
        catch (OperationCanceledException) { return; }
        catch (Exception error) when (error is HttpRequestException or IOException or System.Text.Json.JsonException) { failed = true; }
        Draw();
    }

    private void Draw()
    {
        chips.Children.Clear();
        var tabs = Kit.Tabs(Channels.Select(c => (c.Id, c.Label)).ToList(), channel.Id, id => { channel = Channels.First(c => c.Id == id); if (!channel.Dated && channel.Id != "all") since = ""; page = 1; Run(); Draw(); }, 16);
        tabs.Margin = new Thickness(0, 12, 0, 0);
        chips.Children.Add(tabs);
        body.Children.Clear();
        if (campus.Repository is null) return;
        if (Live) { Rooms(); return; }
        if (channel.Dated || channel.Id == "all")
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 14, Margin = new Thickness(0, 10, 0, 2) };
            foreach (var (value, label) in Since) row.Children.Add(Plain(label, since == value, () => { since = value; page = 1; Run(); }));
            body.Children.Add(row);
        }
        var query = box.Text.Trim();
        if (query.Length == 1) { body.Children.Add(Pages.Empty("再多输入一个字")); return; }
        if (answer is { Total: > 0 } a)
        {
            var tally = Kit.Text($"{(query.Length == 0 ? $"{a.Total:N0} 条" : a.Total >= 1000 ? "超过 1000 条结果" : $"约 {a.Total:N0} 条结果")}（{a.Seconds:0.00} 秒）{(page > 1 ? $" · 第 {page} 页" : "")}", Role.Caption, "faint");
            tally.FontSize = 12.5; tally.Margin = new Thickness(0, 12, 0, 2); body.Children.Add(tally);
        }
        if (page == 1 && System.Text.RegularExpressions.Regex.IsMatch(query, "空教室|自习"))
            body.Children.Add(Kit.Row("", Kit.Column(1, Kit.Text("看此刻的空教室", Role.Body, bold: true), Kit.Text("按楼和楼层，还能待多久", Role.Caption, "muted")), () => { channel = Channels.First(c => c.Id == "room"); box.Text = ""; }));
        if (failed) body.Children.Add(Pages.Empty("搜索暂时出了问题，请稍后重试。"));
        foreach (var result in answer?.Results ?? []) body.Children.Add(Result(result));
        if (answer is { Total: 0 } && !failed) body.Children.Add(Pages.Empty(query.Length == 0 ? "这段时间没有内容" : $"没有找到“{query}”{(channel.Id != "all" ? "，换到“全部”试试" : "")}"));
        if (answer is { Total: > PageSize } paged)
        {
            var last = (paged.Total + PageSize - 1) / PageSize;
            var nav = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, Margin = new Thickness(0, 20, 0, 0), HorizontalAlignment = HorizontalAlignment.Center };
            if (page > 1) nav.Children.Add(Kit.Button("上一页", () => { page--; Run(); }, Icons.Back));
            var from = Math.Max(1, Math.Min(page - 4, last - 8));
            for (var n = from; n <= Math.Min(last, from + 8); n++) { var at = n; nav.Children.Add(Kit.Pick(n.ToString(), n == page, () => { page = at; Run(); })); }
            if (page < last) nav.Children.Add(Kit.Button("下一页", () => { page++; Run(); }, Icons.Chevron));
            body.Children.Add(nav);
        }
    }

    private static Tap Plain(string label, bool on, Action act)
    {
        var words = Kit.Text(label, Role.Label, on ? "ink" : "muted", bold: on); words.FontSize = 13;
        var tap = new Tap { Content = words, HorizontalAlignment = HorizontalAlignment.Left };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(tap, label);
        tap.Click += (_, _) => act();
        return tap;
    }

    /** The kernel's highlight ranges, which count Unicode scalar values, marked in a line of text. */
    private static TextBlock Marked(string text, JsonArray? ranges, double size, string colour, string markColour, bool bold = false, bool wrap = false)
    {
        var block = new TextBlock { FontSize = size, Foreground = Paint.Brush(colour), TextWrapping = wrap ? TextWrapping.Wrap : TextWrapping.NoWrap, TextTrimming = TextTrimming.CharacterEllipsis, FontWeight = bold ? FontWeights.Medium : FontWeights.Normal };
        var runes = text.EnumerateRunes().Select(r => r.ToString()).ToList();
        var cursor = 0;
        foreach (var range in ranges ?? [])
        {
            var (start, end) = ((int)range![0]!, (int)range[1]!);
            if (start > cursor) block.Inlines.Add(new Run { Text = string.Concat(runes.Skip(cursor).Take(start - cursor)) });
            block.Inlines.Add(new Run { Text = string.Concat(runes.Skip(start).Take(end - start)), Foreground = Paint.Brush(markColour), FontWeight = FontWeights.SemiBold });
            cursor = end;
        }
        block.Inlines.Add(new Run { Text = string.Concat(runes.Skip(cursor)) });
        return block;
    }

    private FrameworkElement Result(JsonObject r)
    {
        var title = (string)r["title"]!; var source = (string)r["source"]!; var snippet = r["snippet"]?.GetValue<string>();
        string Says(string t) => System.Text.RegularExpressions.Regex.Replace(t, @"\.[a-z0-9]{1,5}$", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase).Trim();
        var attachments = r["attachments"]?.AsArray() ?? [];
        var adds = snippet is not null && Says(snippet) != Says(title) && !attachments.Any(f => Says((string)f!["name"]!) == Says(snippet));
        var url = (string?)r["url"] ?? "";
        if (Entities.Contains(source))
        {
            var grid = new Grid { ColumnSpacing = 12, Padding = new Thickness(0, 11, 0, 11), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 0, 0, 1) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(44) }); grid.ColumnDefinitions.Add(new ColumnDefinition()); grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var kind = Kit.Text((string?)r["sourceName"] ?? "", Role.Caption, "faint"); kind.VerticalAlignment = VerticalAlignment.Center; grid.Children.Add(kind);
            var main = new StackPanel { Spacing = 1 };
            var head = Marked(title, r["titleHighlights"]?.AsArray(), 15, "ink", "brand", true);
            if (r["section"]?.GetValue<string>() is { Length: > 0 } section) head.Inlines.Add(new Run { Text = "  " + section, FontSize = 12.5, Foreground = Paint.Brush("muted"), FontWeight = FontWeights.Normal });
            main.Children.Add(head);
            if (source == "rooms" && RoomSaid(((string)r["id"]!)["rooms/".Length..]) is { } room)
            {
                var dot = new Microsoft.UI.Xaml.Shapes.Ellipse { Width = 6, Height = 6, Fill = room.Busy ? Paint.Brush("faint") : Paint.Brush("free"), VerticalAlignment = VerticalAlignment.Center };
                main.Children.Add(Kit.Line(5, dot, Kit.Text(room.Text, Role.Caption, "muted")));
            }
            else if (adds) main.Children.Add(Marked(snippet!, r["snippetHighlights"]?.AsArray(), 12.5, "muted", "ink"));
            Grid.SetColumn(main, 1); grid.Children.Add(main);
            var chev = Kit.Icon(Icons.Chevron, 14, "faint"); chev.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(chev, 2); grid.Children.Add(chev);
            var tap = new Tap(Paint.Brush("paper"), Paint.Faded("surfaceSunken", .55)) { Content = grid };
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(tap, title);
            tap.Click += (_, _) =>
            {
                var id = ((string)r["id"]!)[(source.Length + 1)..];
                if (source is "rooms" or "places") App.Open("map", ("place", id));
                else Browse(url);
            };
            return tap;
        }
        var date = r["publishedAt"]?.GetValue<string>() ?? r["updatedAt"]?.GetValue<string>();
        var crumbs = string.Join(" › ", new[] { (string?)r["sourceName"], r["section"]?.GetValue<string>() }.Where(s => !string.IsNullOrEmpty(s)));
        var doc = new StackPanel { Padding = new Thickness(0, 16, 0, 16), Spacing = 3 };
        doc.Children.Add(Kit.Text($"{crumbs}{(date is not null ? $" · {date[..10]}" : "")}{((string?)r["kind"] == "file" ? " · 文件" : (string?)r["kind"] == "link" ? " · 站外" : "")}", Role.Caption, "muted"));
        var link = Marked(title, r["titleHighlights"]?.AsArray(), 17, "brand", "brand", wrap: true); link.LineHeight = 24;
        var open = new Tap { Content = link, HorizontalAlignment = HorizontalAlignment.Left };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(open, title);
        open.Click += (_, _) => Browse(url);
        doc.Children.Add(open);
        if (adds) { var p = Marked(snippet!, r["snippetHighlights"]?.AsArray(), 14, "muted", "ink", wrap: true); p.MaxLines = 3; p.LineHeight = 23; doc.Children.Add(p); }
        else if (r["snippet"] is null) doc.Children.Add(new Border { Height = 40, CornerRadius = new CornerRadius(4), Background = Paint.Brush("surfaceSunken") });
        if (attachments.Count > 0)
        {
            var files = new WrapRow { Gap = 10, Margin = new Thickness(0, 4, 0, 0) };
            foreach (var f in attachments.Take(4))
            {
                var file = new Tap { Content = Kit.Text((string)f!["name"]!, Role.Caption, "brand") };
                var fileUrl = (string)f["url"]!; file.Click += (_, _) => Browse(fileUrl);
                files.Children.Add(file);
            }
            if (attachments.Count > 4) files.Children.Add(Kit.Text($"等 {attachments.Count} 个附件", Role.Caption, "muted"));
            doc.Children.Add(files);
        }
        return doc;
    }

    private static async void Browse(string url) => await Windows.System.Launcher.LaunchUriAsync(new Uri(url.StartsWith("http") ? url : Repository.Site + url));

    private RoomIndex? roomIndex;
    private Rooms? reader;
    private readonly Dictionary<string, RoomDay?> roomDays = new();

    private (bool Busy, string Text)? RoomSaid(string id)
    {
        var now = Moment.Now();
        if (reader is null || !roomDays.TryGetValue(Clock.Text(now.Date), out var day)) { LoadRooms(now.Date); return null; }
        if (day is null) return null;
        var state = reader.At(day, id, now.Min);
        return (state.Busy, state.Busy ? $"上课中，到 {Clock.Hm(state.Until)}" : $"现在空闲，到 {Clock.Hm(state.Until)}");
    }

    private bool loadingRooms;
    private async void LoadRooms(DateOnly date)
    {
        if (loadingRooms || campus.Repository is not { } repo || campus.Term is not { } term) return;
        loadingRooms = true;
        try
        {
            roomIndex ??= await repo.Rooms();
            reader ??= new Rooms(campus.Periods);
            if (!roomDays.ContainsKey(Clock.Text(date))) roomDays[Clock.Text(date)] = await repo.RoomDay(roomIndex.Term, Clock.Text(date));
        }
        catch (Exception error) when (error is HttpRequestException or IOException or System.Text.Json.JsonException) { failed = true; }
        finally { loadingRooms = false; }
        Draw();
    }

    /** Every classroom at a moment, by building and floor, how long each stays free. */
    private void Rooms()
    {
        var now = Moment.Now();
        var at = roomsAt ?? now;
        if (reader is null || roomIndex is null || !roomDays.TryGetValue(Clock.Text(at.Date), out var day)) { LoadRooms(at.Date); return; }
        var when = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Margin = new Thickness(0, 16, 0, 0) };
        when.Children.Add(Kit.Button("前一天", () => { roomsAt = new Moment(at.Date.AddDays(-1), at.Min); Draw(); }, Icons.Back, iconOnly: true));
        var time = Kit.Text(Clock.Hm(at.Min), Role.Title); time.VerticalAlignment = VerticalAlignment.Center; when.Children.Add(time);
        var date = Kit.Text($"{(at.Date == now.Date ? "今天" : Clock.Weekdays[Clock.Weekday(at.Date)])} {Clock.DateLabel(at.Date)}", Role.Label, "muted"); date.VerticalAlignment = VerticalAlignment.Center; when.Children.Add(date);
        when.Children.Add(Kit.Button("后一天", () => { roomsAt = new Moment(at.Date.AddDays(1), at.Min); Draw(); }, Icons.Chevron, iconOnly: true));
        if (roomsAt is not null) when.Children.Add(Kit.Button("现在", () => { roomsAt = null; Draw(); }));
        body.Children.Add(when);
        var periods = new Grid { ColumnSpacing = 4, Margin = new Thickness(0, 12, 0, 2) };
        var current = campus.Periods.FirstOrDefault(p => Clock.Minutes(p.Start) <= at.Min && at.Min < Clock.Minutes(p.End));
        foreach (var period in campus.Periods)
        {
            periods.ColumnDefinitions.Add(new ColumnDefinition());
            var on = current?.Period == period.Period;
            var words = Kit.Text(period.Period.ToString(), Role.Caption, on ? "paper" : "muted", bold: on); words.HorizontalAlignment = HorizontalAlignment.Center; words.VerticalAlignment = VerticalAlignment.Center;
            var tap = new Tap(on ? Paint.Brush("ink") : Paint.Brush("surfaceSunken"), on ? null : Paint.Brush("line")) { Content = words, Height = 30, CornerRadius = new CornerRadius(6) };
            ToolTipService.SetToolTip(tap, $"{period.Start}–{period.End}");
            var p = period; tap.Click += (_, _) => { roomsAt = new Moment(at.Date, Clock.Minutes(p.Start)); Draw(); };
            Grid.SetColumn(tap, periods.ColumnDefinitions.Count - 1); periods.Children.Add(tap);
        }
        body.Children.Add(periods);
        var campusRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 14, Margin = new Thickness(0, 10, 0, 0) };
        foreach (var name in Campuses) campusRow.Children.Add(Plain(name, roomsCampus == name, () => { roomsCampus = name; roomsBuilding = null; Draw(); }));
        body.Children.Add(campusRow);
        var collator = StringComparer.Create(new System.Globalization.CultureInfo("zh-CN"), System.Globalization.CompareOptions.NumericOrdering);
        var groups = roomIndex.Rooms.Where(r => World.Rooms.Classroom(r) && r.Campus == roomsCampus).GroupBy(r => r.Building).OrderBy(g => g.Key, collator).ToList();
        var buildings = new WrapRow { Gap = 14, Margin = new Thickness(0, 10, 0, 0) };
        buildings.Children.Add(Plain("全部的楼", roomsBuilding is null, () => { roomsBuilding = null; Draw(); }));
        foreach (var g in groups) { var name = g.Key; buildings.Children.Add(Plain(name, roomsBuilding == name, () => { roomsBuilding = name; Draw(); })); }
        buildings.Children.Add(Plain(roomsAll ? "显示全部" : "只看空的", roomsAll, () => { roomsAll = !roomsAll; Draw(); }));
        body.Children.Add(buildings);
        if (day is null) { body.Children.Add(Pages.Empty("这一天没有排课数据")); return; }
        foreach (var group in groups.Where(g => roomsBuilding is null || g.Key == roomsBuilding))
        {
            var states = group.Select(r => (Room: r, State: reader.At(day, r.Id, at.Min))).ToList();
            var head = new Grid { Margin = new Thickness(0, 22, 0, 8), Padding = new Thickness(0, 0, 0, 6), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 0, 0, 1) };
            head.ColumnDefinitions.Add(new ColumnDefinition()); head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var name = Kit.Text(group.Key, Role.Body, bold: true); name.FontSize = 17; head.Children.Add(name);
            var count = new TextBlock { FontSize = 12.5, Foreground = Paint.Brush("muted"), VerticalAlignment = VerticalAlignment.Bottom };
            count.Inlines.Add(new Run { Text = states.Count(s => !s.State.Busy).ToString(), Foreground = Paint.Brush("free"), FontWeight = FontWeights.SemiBold });
            count.Inlines.Add(new Run { Text = $" / {states.Count} 间空闲" });
            Grid.SetColumn(count, 1); head.Children.Add(count);
            body.Children.Add(head);
            foreach (var floor in states.GroupBy(s => s.Room.Floor).OrderBy(f => f.Key, collator))
            {
                var visible = floor.Where(s => roomsAll || !s.State.Busy).OrderBy(s => s.Room.Number, collator).ToList();
                if (visible.Count == 0) continue;
                var row = new Grid { ColumnSpacing = 10, Margin = new Thickness(0, 0, 0, 6) };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(18) }); row.ColumnDefinitions.Add(new ColumnDefinition());
                var fn = Kit.Text(floor.Key, Role.Caption, "faint"); fn.Margin = new Thickness(0, 9, 0, 0); row.Children.Add(fn);
                var tiles = new WrapRow { Gap = 4 };
                foreach (var (room, state) in visible)
                {
                    var tile = Kit.Column(0, Kit.Text(room.Number, Role.Label, state.Busy ? "faint" : "ink", bold: !state.Busy), Kit.Text(state.Busy ? "有课" : $"到 {Clock.Hm(state.Until)}", Role.Caption, state.Busy ? "faint" : "muted"));
                    ((TextBlock)tile.Children[1]).FontSize = 11;
                    var ground = state.Tier switch { "long" => Paint.Faded("free", .26), "mid" => Paint.Faded("free", .14), "short" => Paint.Faded("free", .06), _ => Paint.Brush("paper") };
                    var tap = new Tap(ground, Paint.Brush("surfaceSunken")) { Content = tile, Width = 76, Padding = new Thickness(8, 7, 8, 7), CornerRadius = new CornerRadius(6), BorderBrush = state.Busy || state.Tier == "other" ? Paint.Brush("line") : Paint.Clear, BorderThickness = new Thickness(1) };
                    Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(tap, room.Number);
                    var id = room.Id; tap.Click += (_, _) => App.Open("map", ("place", id));
                    tiles.Children.Add(tap);
                }
                Grid.SetColumn(tiles, 1); row.Children.Add(tiles);
                body.Children.Add(row);
            }
        }
    }
}
