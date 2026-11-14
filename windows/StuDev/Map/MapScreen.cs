// The map: pick a moment, unfold campus > building > floor > room. Free rooms, places and walking routes live here.
// src/campus/map/MapApp.tsx and scene.ts, natively over MapLibre Native: the same packaged style, the same colours of
// day and night from the tokens, the same labels standing over the buildings, the same panel with its time ruler.
using System.Text.Json;
using System.Text.Json.Nodes;
using Maplibre.NativeFfi;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using StuDev.Data;
using StuDev.Ui;
using StuDev.World;

namespace StuDev.Map;

public sealed record ModelBuilding(string Id, int Levels, double Height, JsonElement Geometry);
public sealed record ModelPart(string? Id, string? Kind, JsonElement Geometry);
public sealed record ModelFloor(int Level, JsonElement Plate, List<ModelPart> Cores, List<ModelPart> Rooms);
public sealed record CampusModel(List<ModelBuilding> Buildings, Dictionary<string, ModelFloor> Floors);

public sealed partial class MapScreen : Screen
{
    private const double Flat = .14;
    private const int RulerStart = 7 * 60, RulerEnd = 22 * 60;
    private readonly Campus campus = Campus.Shared;
    private readonly MapSurface surface = new();
    private readonly Canvas labels = new() { IsHitTestVisible = true };
    private readonly StackPanel sheet = new();
    private readonly StackPanel floorsBar = new() { Spacing = 0 };
    private Space? space;
    private CampusModel? model;
    private RoomIndex? roomIndex;
    private Dictionary<string, Room> roomById = new();
    private World.Rooms? reader;
    private RoomDay? day;
    private string? dayDate;
    private Kernels.Wayfind.Router? router;
    private Moment moment = Moment.Now();
    private bool isNow = true;
    private string? placeId, navId, origin;
    private int? floor;
    private string mode = "walk";
    private List<JsonNode> routes = [];
    private int chosen;
    private string? notice;
    private double[]? me;
    private bool styled;
    private string? openBuilding;
    private double night = -1;
    private readonly List<(FrameworkElement El, double[] At, double Height, LabelRule Rule, string Id, bool Place)> buildingLabels = [];
    private readonly List<(FrameworkElement El, double[] At, double[] Box, bool Picked, double Min)> roomLabels = [];
    private double roomTop;

    public MapScreen()
    {
        ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(360) });
        ColumnDefinitions.Add(new ColumnDefinition());
        var panel = new Border { Background = Paint.Brush("paper"), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 0, 1, 0), Child = new ScrollViewer { Content = sheet, VerticalScrollBarVisibility = ScrollBarVisibility.Auto } };
        Children.Add(panel);
        var stage = new Grid { Background = Paint.Brush("surfaceSunken") };
        stage.Children.Add(surface);
        stage.Children.Add(labels);
        // Labels of rooms near the edge stay inside the map, never over the panel.
        stage.SizeChanged += (_, e) => stage.Clip = new RectangleGeometry { Rect = new Windows.Foundation.Rect(0, 0, e.NewSize.Width, e.NewSize.Height) };
        var controls = new StackPanel { Spacing = 10, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 16, 16, 0) };
        controls.Children.Add(Round("回正视角", "M10,3.5 L13.5,10 H6.5 Z M10,16.5 L6.5,10 H13.5 Z", Square));
        controls.Children.Add(new Border { Child = floorsBar, CornerRadius = new CornerRadius(8), Background = Paint.Brush("paper"), Translation = new System.Numerics.Vector3(0, 0, 6), Shadow = new ThemeShadow() });
        controls.Children.Add(Round("我的位置", "M13,10 A3,3 0 1 1 7,10 A3,3 0 1 1 13,10 Z M17.5,10 A7.5,7.5 0 1 1 2.5,10 A7.5,7.5 0 1 1 17.5,10 Z", () => _ = Locate()));
        stage.Children.Add(controls);
        var search = new Tap(Paint.Brush("paper"), Paint.Brush("surfaceSunken")) { Content = Kit.Line(8, Kit.Icon(Icons.Magnifier, 16, "muted", 20), Kit.Text("搜地点或教室", Role.Label, "muted")), Padding = new Thickness(14, 9, 18, 9), CornerRadius = new CornerRadius(20),
            HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(16), Translation = new System.Numerics.Vector3(0, 0, 8), Shadow = new ThemeShadow() };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(search, "搜地点或教室");
        search.Click += (_, _) => App.Open("search", ("channel", "place"));
        stage.Children.Add(search);
        var credit = Kit.Text("© OpenStreetMap 贡献者 · njupt-map", Role.Caption, "faint"); credit.FontSize = 10.5; credit.HorizontalAlignment = HorizontalAlignment.Right; credit.VerticalAlignment = VerticalAlignment.Bottom; credit.Margin = new Thickness(0, 0, 10, 6);
        stage.Children.Add(credit);
        Grid.SetColumn(stage, 1); Children.Add(stage);
        surface.Shown += Place;
        surface.Tapped2 += point => _ = Tap(point);
        Paint.Turned += () => { Repaint(); Draw(); };
        campus.Changed += () => DispatcherQueue.TryEnqueue(() => { if (space is null) _ = Load(); });
        _ = Load();
        Draw();
    }

    private static Tap Round(string label, string icon, Action act)
    {
        var tap = new Tap(Paint.Brush("paper"), Paint.Brush("surfaceSunken")) { Content = Kit.Icon(icon, 20, "ink", 20, 1.6), Width = 40, Height = 40, CornerRadius = new CornerRadius(20), Translation = new System.Numerics.Vector3(0, 0, 6), Shadow = new ThemeShadow() };
        ((FrameworkElement)tap.Content).HorizontalAlignment = HorizontalAlignment.Center; ((FrameworkElement)tap.Content).VerticalAlignment = VerticalAlignment.Center;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(tap, label); ToolTipService.SetToolTip(tap, label);
        tap.Click += (_, _) => act();
        return tap;
    }

    public override void Shown(object? argument)
    {
        switch (argument)
        {
            case ValueTuple<string, string> { Item1: "place" } place: placeId = place.Item2; navId = null; floor = null; break;
            case ValueTuple<string, string> { Item1: "nav" } nav: navId = nav.Item2; placeId = null; break;
        }
        Draw(); _ = Scene();
    }

    // ——— the world ———
    private bool loading;
    private async Task Load()
    {
        if (loading || space is not null || campus.Repository is not { } repo) return;
        loading = true;
        try
        {
            var places = Space.Load(repo); var shape = repo.Read<CampusModel>("space/仙林/model.json"); var index = repo.Rooms();
            await Task.WhenAll(places, shape, index);
            space = places.Result; model = shape.Result; roomIndex = index.Result;
            roomById = roomIndex.Rooms.Where(r => Names.Placed(r.Id)).ToDictionary(r => r.Id);
            reader = new World.Rooms(campus.Periods);
            router = new Kernels.Wayfind.Router(space.Network);
            await surface.Ready;
            var style = JsonNode.Parse(System.Text.Encoding.UTF8.GetString(await repo.Bytes("space/仙林/style.json"))
                .Replace("{data}", $"{Repository.Site}{repo.Release.Base}/space/{Uri.EscapeDataString("仙林")}").Replace("{assets}", $"{Repository.Site}/map"))!.AsObject();
            // Chinese labels from Microsoft YaHei, which every Chinese Windows has, as the web draws them from the system's font.
            var faces = new JsonObject();
            foreach (var stack in new[] { "Noto-Sans-Regular", "Noto-Sans-Medium", "Noto-Sans-Italic" })
                faces[stack] = new JsonArray(new JsonObject { ["url"] = "file:///C:/Windows/Fonts/msyh.ttc", ["unicode-range"] = new JsonArray("U+2E80-9FFF", "U+F900-FAFF", "U+FF00-FFEF") });
            style["font-faces"] = faces;
            // The invisible tap-target copy of the buildings fights the drawn one for depth here; the drawn one is tapped instead.
            foreach (var layer in style["layers"]!.AsArray()) if ((string?)layer!["id"] == "forms") layer["layout"] = new JsonObject { ["visibility"] = "none" };
            await surface.Map.SetStyleJsonAsync(style.ToJsonString());
            await AddLayers();
            var teach = space.ById.GetValueOrDefault("仙林/教3")?.Centre ?? [118.928, 32.113];
            surface.Move(new CameraOptions { Center = new LatLng(teach[1] - .0002, teach[0] + .0006), Zoom = 16.05, Bearing = -24, Pitch = 52 }, CameraUpdateMode.Jump);
            styled = true;
            Labels();
            await LoadDay();
            Counts();
            Repaint();
            await Scene();
        }
        catch (Exception error) when (error is HttpRequestException or IOException or JsonException or MaplibreException) { notice = "地图暂时打不开，请稍后重试。"; }
        finally { loading = false; Draw(); }
    }

    private async Task LoadDay()
    {
        if (campus.Repository is not { } repo || roomIndex is null) return;
        var date = Clock.Text(moment.Date);
        if (dayDate == date) return;
        dayDate = date;
        try { day = await repo.RoomDay(roomIndex.Term, date); }
        catch (Exception error) when (error is HttpRequestException or IOException or JsonException) { day = null; }
    }

    private Task Layer(string json, string? before = null) => surface.Map.AddStyleLayerJsonAsync(json, before ?? "");
    private async Task AddLayers()
    {
        var map = surface.Map;
        foreach (var id in new[] { "route", "sel", "selshell", "selcore", "selrooms" })
            await map.AddGeoJsonSourceAsync(id, new GeoJsonSourceOptions(), """{"type":"FeatureCollection","features":[]}""");
        const string round = "\"layout\":{\"line-cap\":\"round\",\"line-join\":\"round\"}";
        await Layer($$$"""{"id":"route-alternative","type":"line","source":"route","filter":["!",["get","chosen"]],{{{round}}},"paint":{"line-width":["interpolate",["linear"],["zoom"],14,3,18,7]}}""", "context");
        await Layer($$$"""{"id":"route-casing","type":"line","source":"route","filter":["get","chosen"],{{{round}}},"paint":{"line-width":["interpolate",["linear"],["zoom"],14,5,18,11]}}""", "context");
        await Layer($$$"""{"id":"route","type":"line","source":"route","filter":["get","chosen"],{{{round}}},"paint":{"line-width":["interpolate",["linear"],["zoom"],14,2.6,18,6.5]}}""", "context");
        await Layer("""{"id":"sel-lower","type":"fill-extrusion","source":"sel","layout":{"visibility":"none"},"paint":{"fill-extrusion-height":1}}""");
        await Layer("""{"id":"sel-slab","type":"fill-extrusion","source":"sel","layout":{"visibility":"none"},"paint":{"fill-extrusion-height":1}}""");
        await Layer("""{"id":"sel-rooms","type":"fill-extrusion","source":"selrooms","layout":{"visibility":"none"},"paint":{"fill-extrusion-color":["get","c"],"fill-extrusion-height":1}}""");
        await Layer("""{"id":"sel-core","type":"fill-extrusion","source":"selcore","layout":{"visibility":"none"},"paint":{"fill-extrusion-color":"#E3E5E8","fill-extrusion-height":1}}""");
    }

    private Task Set(string layer, string property, object value) => surface.Map.SetStyleLayerPropertyAsync(layer, property, value is string s && s.StartsWith('#') ? $"\"{s}\"" : JsonSerializer.Serialize(value));
    private Task SetRaw(string layer, string property, string json) => surface.Map.SetStyleLayerPropertyAsync(layer, property, json);
    private static string Hex(Windows.UI.Color c) => $"#{c.R:X2}{c.G:X2}{c.B:X2}";
    private string Scene(string key) => Hex(Paint.Scene(key, Paint.Dark));

    /** The day's or the night's colours on the ground, the roads, the labels and the routes, as the app's theme is. */
    private async void Repaint()
    {
        if (!styled) return;
        var dark = Paint.Dark ? 1 : 0;
        if (dark == night) return;
        night = dark;
        await Set("bg", "background-color", Scene("ground"));
        await Set("campus", "fill-color", Scene("campus"));
        await Set("surfaces", "fill-color", Scene("surface"));
        await Set("greens", "fill-color", Scene("green"));
        await Set("sports", "fill-color", Scene("sport"));
        await Set("waters", "fill-color", Scene("water"));
        await Set("roads", "line-color", Scene("road"));
        await Set("paths", "line-color", Scene("path"));
        await Set("context", "fill-extrusion-color", Scene("context"));
        foreach (var layer in new[] { "way-label", "water-label", "green-label", "surface-label", "sport-label", "context-label" })
        { await Set(layer, "text-color", Scene("label")); await Set(layer, "text-halo-color", Scene("halo")); }
        await Set("route-alternative", "line-color", Hex(Paint.Of("routeAlternative", Paint.Dark)));
        await Set("route-casing", "line-color", Hex(Paint.Of("routeCasing", Paint.Dark)));
        await Set("route", "line-color", Hex(Paint.Of("route", Paint.Dark)));
        await Set("sel-lower", "fill-extrusion-color", Scene("model"));
        await Set("sel-slab", "fill-extrusion-color", Scene("slab"));
        await Buildings();
        if (openBuilding is not null) await PaintRooms();
        foreach (var (el, _, _, _, _, _) in buildingLabels) Dress((FrameworkElement)((Tap)el).Tag);
        surface.Redraw();
    }

    private async Task Buildings()
    {
        var model = Scene("model"); var campusColour = Scene("campus");
        var faded = Hex(Paint.Blend(Paint.Parse(model), Paint.Parse(campusColour), .28));
        var lit = Paint.Dark ? """["rgba",["*",["at",0,["to-rgba",["to-color",["get","color"]]]],0.22],["*",["at",1,["to-rgba",["to-color",["get","color"]]]],0.22],["*",["at",2,["to-rgba",["to-color",["get","color"]]]],0.22],1]""" : """["to-color",["get","color"]]""";
        await SetRaw("plain", "fill-extrusion-color", openBuilding is not null && model is not null && HasFloors(openBuilding) ? $"\"{faded}\"" : lit);
    }

    // ——— labels standing over the buildings ———
    private void Labels()
    {
        if (space is null || model is null) return;
        labels.Children.Clear(); buildingLabels.Clear();
        var teaching = roomIndex!.Rooms.Where(World.Rooms.Classroom).Select(r => $"{r.Campus}/{r.Building}").ToHashSet();
        foreach (var building in model.Buildings)
        {
            if (space.ById.GetValueOrDefault(building.Id) is not { } place || place.Names.FirstOrDefault() is not { } name) continue;
            var teach = teaching.Contains(building.Id);
            var rule = LabelRules.Of(place, space.ById, teach)!;
            var el = LabelElement(name, teach ? "teach" : rule.Priority > 1 ? "minor" : "", building.Id, false, teach);
            buildingLabels.Add((el, Centre(building.Geometry), building.Height, rule, building.Id, false));
        }
        foreach (var place in space.Places)
            if (place.Centre is not null && place.Names.FirstOrDefault() is { } name && LabelRules.Of(place, space.ById) is { } rule)
                buildingLabels.Add((LabelElement(name, "minor", place.Id, true, false), place.Centre, 0, rule, place.Id, true));
        Counts();
    }

    private FrameworkElement LabelElement(string text, string kind, string id, bool place, bool teach)
    {
        FrameworkElement el;
        if (teach)
        {
            var words = new TextBlock { FontSize = 12, FontWeight = FontWeights.SemiBold };
            words.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = text });
            words.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = " " });
            words.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = "", FontWeight = FontWeights.SemiBold });
            el = new Border { Child = words, Padding = new Thickness(8, 4, 8, 4), CornerRadius = new CornerRadius(6), BorderThickness = new Thickness(1), Tag = "teach" };
        }
        else el = new TextBlock { Text = text, FontSize = kind == "minor" ? 10.5 : 11.5, FontWeight = kind == "minor" ? FontWeights.Normal : FontWeights.Medium, Tag = kind };
        Dress(el);
        // A label is a button: tapped, clicked or invoked from the keyboard, it opens its place.
        var tap = new Tap { Content = el, Visibility = Visibility.Collapsed, Tag = el };
        tap.Click += (_, _) => Select(id);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(tap, text);
        labels.Children.Add(tap);
        return tap;
    }

    /** A label's colours: dark words with a pale halo by day, pale words by night; teaching buildings on a card. */
    private static void Dress(FrameworkElement el)
    {
        if (el is Border card && card.Child is TextBlock words)
        {
            card.Background = Paint.Brush("paper"); card.BorderBrush = Paint.Brush("line"); words.Foreground = Paint.Brush("ink");
            return;
        }
        if (el is TextBlock text) text.Foreground = new SolidColorBrush(Paint.Parse((string)text.Tag == "minor" ? (Paint.Dark ? "#8E9398" : "#8A8E94") : (Paint.Dark ? "#C4C7CB" : "#46494E")));
    }

    private void Counts()
    {
        if (reader is null || roomIndex is null) return;
        var free = new Dictionary<string, int>();
        foreach (var room in roomIndex.Rooms.Where(World.Rooms.Classroom))
        {
            var key = $"{room.Campus}/{room.Building}";
            if (day is not null && !reader.At(day, room.Id, moment.Min).Busy) free[key] = free.GetValueOrDefault(key) + 1; else free.TryAdd(key, 0);
        }
        foreach (var (tap, _, _, _, id, _) in buildingLabels)
            if (((Tap)tap).Tag is Border { Child: TextBlock words } && words.Inlines.Count == 3 && words.Inlines[2] is Microsoft.UI.Xaml.Documents.Run count)
            { var n = free.GetValueOrDefault(id); count.Text = n.ToString(); count.Foreground = n > 0 ? Paint.Brush("free") : Paint.Brush("faint"); }
    }

    private static double[] Centre(JsonElement geometry)
    {
        double w = double.MaxValue, s = double.MaxValue, e = double.MinValue, n = double.MinValue;
        void Walk(JsonElement node) { if (node.ValueKind == JsonValueKind.Array && node.GetArrayLength() > 0 && node[0].ValueKind == JsonValueKind.Number) { var x = node[0].GetDouble(); var y = node[1].GetDouble(); w = Math.Min(w, x); e = Math.Max(e, x); s = Math.Min(s, y); n = Math.Max(n, y); } else if (node.ValueKind == JsonValueKind.Array) foreach (var c in node.EnumerateArray()) Walk(c); }
        Walk(geometry.GetProperty("coordinates"));
        return [(w + e) / 2, (s + n) / 2, w, s, e, n];
    }

    /** After each frame: every label where its point now is, raised to its building's top, the crowded ones hidden. */
    private void Place(MapProjectionHandle projection)
    {
        if (buildingLabels.Count == 0) return;
        var camera = projection.GetCamera().Camera;
        var zoom = camera.Zoom; var pitch = camera.Pitch * Math.PI / 180;
        var perMetre = 1 / projection.MetersPerPixelAtLatitude(32.11);
        var width = surface.ActualWidth; var height = surface.ActualHeight;
        var open = openBuilding is not null && HasFloors(openBuilding);
        (double X, double Y) Project(double[] at, double metres)
        {
            var p = projection.PixelForLatLng(new LatLng(at[1], at[0]));
            var rise = metres * perMetre;
            return (p.X, p.Y - rise * Math.Sin(pitch));
        }
        var taken = new List<(double L, double T, double R, double B)>();
        foreach (var (el, at, metres, rule, id, place) in buildingLabels.OrderBy(l => l.Rule.Priority))
        {
            if (zoom < rule.MinZoom || (open && (id == openBuilding || place))) { el.Visibility = Visibility.Collapsed; continue; }
            var (x, y) = Project(at, open ? metres * Flat : metres);
            if (x < -40 || x > width + 40 || y < 0 || y > height) { el.Visibility = Visibility.Collapsed; continue; }
            if (el.Visibility == Visibility.Collapsed) { el.Visibility = Visibility.Visible; el.Measure(new Windows.Foundation.Size(double.PositiveInfinity, double.PositiveInfinity)); }
            var (w, h) = (el.DesiredSize.Width, el.DesiredSize.Height);
            var box = (x - w / 2 - 4, y - h / 2 - 6, x + w / 2 + 4, y + h / 2 + 2);
            if (taken.Any(o => box.Item1 < o.R && o.L < box.Item3 && box.Item2 < o.B && o.T < box.Item4)) { el.Visibility = Visibility.Collapsed; continue; }
            taken.Add(box);
            Canvas.SetLeft(el, x - w / 2); Canvas.SetTop(el, y - 2 - h / 2);
        }
        foreach (var (el, at, box, picked, min) in roomLabels)
        {
            var a = projection.PixelForLatLng(new LatLng(box[1], box[0])); var b = projection.PixelForLatLng(new LatLng(box[3], box[2]));
            if (!picked && (Math.Sqrt(Math.Pow(a.X - b.X, 2) + Math.Pow(a.Y - b.Y, 2)) * .62 < min || zoom < 17.4)) { el.Visibility = Visibility.Collapsed; continue; }
            var (x, y) = Project(at, roomTop);
            el.Visibility = Visibility.Visible; el.Measure(new Windows.Foundation.Size(double.PositiveInfinity, double.PositiveInfinity));
            Canvas.SetLeft(el, x - el.DesiredSize.Width / 2); Canvas.SetTop(el, y - el.DesiredSize.Height / 2);
        }
        if (me is not null && meDot is not null)
        {
            var p = projection.PixelForLatLng(new LatLng(me[1], me[0]));
            Canvas.SetLeft(meDot, p.X - 7); Canvas.SetTop(meDot, p.Y - 7); meDot.Visibility = Visibility.Visible;
        }
    }
    private Ellipse? meDot;

    // ——— picking ———
    private async Task Tap(ScreenPoint point)
    {
        if (!styled) return;
        var box = new RenderedQueryGeometry.Box(new ScreenBox(new ScreenPoint(point.X - 4, point.Y - 4), new ScreenPoint(point.X + 4, point.Y + 4)));
        if (openBuilding is not null && HasFloors(openBuilding))
        {
            var rooms = await surface.Session.QueryRenderedFeaturesAsync(box, new RenderedFeatureQueryOptions { LayerIds = ["sel-rooms"] });
            if (rooms.Length > 0 && (string?)JsonNode.Parse(rooms[0].Feature)?["properties"]?["id"] is { } room) { Select(room); return; }
        }
        var forms = await surface.Session.QueryRenderedFeaturesAsync(box, new RenderedFeatureQueryOptions { LayerIds = ["plain"] });
        foreach (var feature in forms)
            if ((string?)JsonNode.Parse(feature.Feature)?["properties"]?["building"] is { Length: > 0 } building) { Select(building); return; }
        if (placeId is not null || navId is not null) { placeId = null; navId = null; floor = null; Draw(); await Scene(); }
    }
    private void Select(string id) { placeId = id; navId = null; floor = null; Draw(); _ = Scene(); }

    private bool HasFloors(string building) => model?.Floors.Keys.Any(k => k.StartsWith(building + "/")) == true;
    private List<int> FloorsOf(string building) => model?.Floors.Where(f => f.Key.StartsWith(building + "/")).Select(f => f.Value.Level).Order().ToList() ?? [];
    private Place? BuildingOf(Place? place)
    {
        while (place is not null && place.Kind != "building") place = place.Parent is { } p ? space!.ById.GetValueOrDefault(p) : null;
        return place;
    }
    private List<Room> TeachingRooms(string building) => roomIndex?.Rooms.Where(r => $"{r.Campus}/{r.Building}" == building && World.Rooms.Classroom(r)).ToList() ?? [];
    private RoomState? StateOf(string id) => reader?.At(day, id, moment.Min);

    /** Opens the selected building at a floor, or flies to the selected place; shows the routes. */
    private async Task Scene()
    {
        if (!styled || space is null || model is null) return;
        var selected = placeId is not null ? space.ById.GetValueOrDefault(placeId) : null;
        var building = BuildingOf(selected);
        var picked = selected?.Kind == "room" ? selected : null;
        if (navId is null && building is not null && HasFloors(building.Id))
        {
            var levels = FloorsOf(building.Id);
            floor = picked?.Floor is { } f && int.TryParse(f, out var pf) ? pf : floor is { } chosenFloor && levels.Contains(chosenFloor) ? chosenFloor : BestFloor(building.Id, levels);
            await Enter(building.Id, floor!.Value, picked?.Id);
        }
        else
        {
            await Exit();
            var at = selected?.Centre ?? (building is not null ? Centre(model.Buildings.FirstOrDefault(b => b.Id == building.Id)?.Geometry ?? default) : null);
            if (at is not null && navId is null) surface.Move(new CameraOptions { Center = new LatLng(at[1], at[0]), Zoom = 17.4, Padding = new EdgeInsets(60, 50, 60, 70) });
        }
        await Routes();
        FloorButtons(building?.Id);
    }

    private int BestFloor(string building, List<int> levels)
    {
        var rooms = TeachingRooms(building); var best = levels[0]; var most = -1;
        foreach (var level in levels) { var free = rooms.Count(r => r.Floor == level.ToString() && StateOf(r.Id)?.Busy == false); if (free > most) { most = free; best = level; } }
        return best;
    }

    private async Task Enter(string building, int level, string? picked)
    {
        var shape = model!.Buildings.First(b => b.Id == building);
        var data = model.Floors.GetValueOrDefault($"{building}/{level}");
        var same = openBuilding == building;
        openBuilding = building;
        var filter = $$"""["!=",["get","building"],"{{building}}"]""";
        await SetRaw("plain", "filter", filter);
        await Buildings();
        await surface.Map.SetGeoJsonSourceDataAsync("sel", JsonSerializer.Serialize(new { type = "Feature", geometry = data?.Plate ?? shape.Geometry, properties = new { } }));
        await surface.Map.SetGeoJsonSourceDataAsync("selcore", JsonSerializer.Serialize(new { type = "FeatureCollection", features = (data?.Cores ?? []).Select(c => new { type = "Feature", geometry = c.Geometry, properties = new { } }) }));
        foreach (var layer in new[] { "sel-lower", "sel-slab", "sel-rooms", "sel-core" }) await SetRaw(layer, "visibility", "\"visible\"");
        var floorHeight = shape.Height / shape.Levels; var basis = (level - 1) * floorHeight; var wall = Math.Max(1.3, floorHeight * .42);
        await Set("sel-lower", "fill-extrusion-height", Math.Max(.01, basis));
        await Set("sel-slab", "fill-extrusion-base", basis); await Set("sel-slab", "fill-extrusion-height", basis + .18);
        await Set("sel-rooms", "fill-extrusion-base", basis + .18); await Set("sel-rooms", "fill-extrusion-height", basis + .18 + wall);
        await Set("sel-core", "fill-extrusion-base", basis + .18); await Set("sel-core", "fill-extrusion-height", basis + .18 + wall * .5);
        roomTop = basis + .18 + wall;
        await Flatten(Flat);
        await PaintRooms(picked);
        // Fly over the floor, turned to the building's longest side.
        var focus = picked is not null && data?.Rooms.FirstOrDefault(r => r.Id == picked) is { } room ? room.Geometry : shape.Geometry;
        var c = Centre(focus);
        var camera = await surface.Map.CameraForLatLngBoundsAsync(new LatLngBounds(new LatLng(c[3], c[2]), new LatLng(c[5], c[4])), new CameraFitOptions { Padding = new EdgeInsets(90, 80, 90, 110), Bearing = Bearing(shape.Geometry), Pitch = 44 });
        camera = camera with { Zoom = Math.Min(Math.Max(camera.Zoom ?? 18, 17.6), 19.1) };
        surface.Move(camera, same ? CameraUpdateMode.Ease : CameraUpdateMode.Fly, same ? 500 : 1050);
    }

    private async Task Exit()
    {
        if (openBuilding is null) return;
        openBuilding = null;
        await SetRaw("plain", "filter", "null");
        foreach (var layer in new[] { "sel-lower", "sel-slab", "sel-rooms", "sel-core" }) await SetRaw(layer, "visibility", "\"none\"");
        await Flatten(1);
        await Buildings();
        foreach (var (el, _, _, _, _) in roomLabels) labels.Children.Remove(el);
        roomLabels.Clear();
    }

    private async Task Flatten(double value)
    {
        foreach (var layer in new[] { "plain" })
        {
            await SetRaw(layer, "fill-extrusion-height", $"""["*",["get","top"],{value}]""");
            await SetRaw(layer, "fill-extrusion-base", $"""["*",["get","base"],{value}]""");
        }
        await SetRaw("context", "fill-extrusion-height", $"""["*",["coalesce",["to-number",["get","height_m"]],["*",["to-number",["get","levels"],0],3.4]],{value}]""");
    }

    private static double Bearing(JsonElement geometry)
    {
        var ring = geometry.GetProperty("type").GetString() == "Polygon" ? geometry.GetProperty("coordinates")[0] : geometry.GetProperty("coordinates")[0][0];
        var cosine = Math.Cos(32.11 * Math.PI / 180); double best = 0, angle = 0;
        for (var i = 0; i < ring.GetArrayLength() - 1; i++)
        {
            var dx = (ring[i + 1][0].GetDouble() - ring[i][0].GetDouble()) * cosine; var dy = ring[i + 1][1].GetDouble() - ring[i][1].GetDouble();
            if (dx * dx + dy * dy > best) { best = dx * dx + dy * dy; angle = Math.Atan2(dx, dy) * 180 / Math.PI; }
        }
        var bearing = angle - 90;
        while (bearing > 90) bearing -= 180;
        while (bearing < -90) bearing += 180;
        return bearing;
    }

    /** The open floor's rooms in the colours of how long each stays free, and their numbers over them. */
    private async Task PaintRooms(string? picked = null)
    {
        if (openBuilding is null || floor is null || model is null) return;
        picked ??= placeId is not null && space!.ById.GetValueOrDefault(placeId)?.Kind == "room" ? placeId : null;
        var data = model.Floors.GetValueOrDefault($"{openBuilding}/{floor}");
        var night = Paint.Dark;
        string Colour(string tier) => Hex(Paint.Parse(RoomColour(tier, night)));
        var features = new List<object>();
        foreach (var (el, _, _, _, _) in roomLabels) labels.Children.Remove(el);
        roomLabels.Clear();
        foreach (var room in data?.Rooms ?? [])
        {
            var classroom = roomById.TryGetValue(room.Id!, out var r) && World.Rooms.Classroom(r);
            var tier = room.Id == picked ? "picked" : classroom && day is not null ? reader!.At(day, room.Id!, moment.Min).Tier : "other";
            features.Add(new { type = "Feature", geometry = room.Geometry, properties = new { id = room.Id, c = Colour(tier) } });
            var place = space!.ById.GetValueOrDefault(room.Id!);
            var label = place?.Names.FirstOrDefault() ?? room.Id![(room.Id!.LastIndexOf('-') + 1)..];
            var text = new TextBlock { Text = label, FontSize = tier == "picked" ? 12 : 10.5, FontWeight = tier == "picked" ? FontWeights.SemiBold : FontWeights.Normal, IsHitTestVisible = false,
                Foreground = new SolidColorBrush(Paint.Parse(tier switch { "long" => night ? "#052A23" : "#FFFFFF", "busy" or "other" => night ? "#7D8186" : "#7E8389", "picked" => Hex(Paint.Of("paper", night)), _ => night ? "#C9F4EA" : "#0B5C4C" })) };
            FrameworkElement el = tier == "picked" ? new Border { Child = text, Background = Paint.Brush("ink"), Padding = new Thickness(7, 3, 7, 3), CornerRadius = new CornerRadius(5), IsHitTestVisible = false } : text;
            labels.Children.Add(el);
            var c = Centre(room.Geometry);
            roomLabels.Add((el, c, [c[2], c[3], c[4], c[5]], tier == "picked", 20));
        }
        foreach (var core in data?.Cores ?? [])
        {
            var text = new TextBlock { Text = core.Kind switch { "stairs" => "楼梯", "wc" => "卫生间", "lift" => "电梯", _ => "" }, FontSize = 9.5, Foreground = new SolidColorBrush(Paint.Parse("#8A8E94")), IsHitTestVisible = false };
            labels.Children.Add(text);
            var c = Centre(core.Geometry);
            roomLabels.Add((text, c, [c[2], c[3], c[4], c[5]], false, 22));
        }
        await surface.Map.SetGeoJsonSourceDataAsync("selrooms", JsonSerializer.Serialize(new { type = "FeatureCollection", features }));
        surface.Redraw();
    }

    private static string RoomColour(string tier, bool night)
    {
        var root = JsonDocument.Parse(File.ReadAllText(System.IO.Path.Combine(AppContext.BaseDirectory, "design", "tokens.json"))).RootElement.GetProperty("scene").GetProperty("room").GetProperty(night ? "night" : "day");
        return root.GetProperty(tier).GetString()!;
    }

    private void FloorButtons(string? building)
    {
        floorsBar.Children.Clear();
        if (building is null || !HasFloors(building) || navId is not null) { floorsBar.Visibility = Visibility.Collapsed; return; }
        floorsBar.Visibility = Visibility.Visible;
        var rooms = TeachingRooms(building);
        foreach (var level in FloorsOf(building).AsEnumerable().Reverse())
        {
            var on = level == floor;
            var free = rooms.Any(r => r.Floor == level.ToString() && day is not null && StateOf(r.Id)?.Busy == false);
            var words = Kit.Text(level.ToString(), Role.Label, on ? "paper" : "muted", bold: on); words.HorizontalAlignment = HorizontalAlignment.Center; words.VerticalAlignment = VerticalAlignment.Center;
            var face = new Grid(); face.Children.Add(words);
            if (free && !on) face.Children.Add(new Ellipse { Width = 4, Height = 4, Fill = Paint.Brush("free"), HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 6, 6, 0) });
            var tap = new Tap(on ? Paint.Brush("ink") : Paint.Brush("paper"), on ? null : Paint.Brush("surfaceSunken")) { Content = face, Width = 36, Height = 34, BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, floorsBar.Children.Count > 0 ? 1 : 0, 0, 0) };
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(tap, $"{level} 层");
            var chosenLevel = level; tap.Click += (_, _) => { placeId = building; floor = chosenLevel; Draw(); _ = Scene(); };
            floorsBar.Children.Add(tap);
        }
    }

    // ——— routes ———
    private async Task Routes()
    {
        routes = [];
        if (navId is not null && space?.ById.GetValueOrDefault(navId) is { } destination && router is not null)
        {
            JsonNode? from = origin is not null && space.ById.GetValueOrDefault(origin) is { } start ? JsonNode.Parse(start.Routing.GetRawText()) : me is not null ? new JsonObject { ["type"] = "position", ["position"] = new JsonArray(me[0], me[1]) } : null;
            if (from is null)
            {
                notice = "输入出发地，或点右边的定位。";
                var at = destination.Centre ?? (BuildingOf(destination) is { } b && model!.Buildings.FirstOrDefault(x => x.Id == b.Id) is { } shape ? Centre(shape.Geometry) : null);
                if (at is not null)
                    surface.Move(new CameraOptions { Center = new LatLng(at[1], at[0]), Zoom = 16.6, Pitch = 45 }, CameraUpdateMode.Fly, 900);
            }
            else
            {
                var request = new JsonObject { ["origin"] = from, ["destination"] = JsonNode.Parse(destination.Routing.GetRawText()), ["mode"] = mode, ["avoid_steps"] = false, ["max_snap_distance_m"] = 100, ["alternatives"] = 3 };
                try { routes = JsonNode.Parse(router.Route(request.ToJsonString()))!["routes"]!.AsArray().Select(r => r!).ToList(); notice = routes.Count > 0 ? null : "没有找到路线。"; }
                catch (Exception error) when (error is not OutOfMemoryException) { notice = origin is not null ? "没有找到路线。" : "你现在不在校园路网附近，请选一个出发地。"; }
                chosen = Math.Min(chosen, Math.Max(0, routes.Count - 1));
            }
        }
        await surface.Map.SetGeoJsonSourceDataAsync("route", JsonSerializer.Serialize(new
        {
            type = "FeatureCollection",
            features = routes.Select((r, i) => new { type = "Feature", properties = new { chosen = i == chosen, index = i }, geometry = new { type = "LineString", coordinates = r["geometry"] } }).OrderBy(f => f.properties.chosen),
        }));
        if (routes.Count > 0)
        {
            var line = routes[chosen]["geometry"]!.AsArray().Select(p => ((double)p![1]!, (double)p[0]!)).ToList();
            var bounds = new LatLngBounds(new LatLng(line.Min(p => p.Item1), line.Min(p => p.Item2)), new LatLng(line.Max(p => p.Item1), line.Max(p => p.Item2)));
            var flat = await surface.Map.CameraForLatLngBoundsAsync(bounds, new CameraFitOptions { Padding = new EdgeInsets(90, 90, 90, 90), Pitch = 0, Bearing = 0 });
            // Seen tilted, the far half of the route needs a little more room than seen from above.
            var camera = new CameraOptions { Center = flat.Center, Zoom = Math.Min((flat.Zoom ?? 17) - .5, 18), Pitch = 45, Bearing = 0 };
            surface.Move(camera, CameraUpdateMode.Fly, 1000);
        }
        surface.Redraw();
        Draw();
    }

    private async Task Locate()
    {
        try
        {
            var access = await Windows.Devices.Geolocation.Geolocator.RequestAccessAsync();
            if (access != Windows.Devices.Geolocation.GeolocationAccessStatus.Allowed) throw new UnauthorizedAccessException();
            var position = await new Windows.Devices.Geolocation.Geolocator { DesiredAccuracy = Windows.Devices.Geolocation.PositionAccuracy.High }.GetGeopositionAsync();
            me = [position.Coordinate.Point.Position.Longitude, position.Coordinate.Point.Position.Latitude];
            meDot ??= new Ellipse { Width = 14, Height = 14, Fill = Paint.Brush("position"), Stroke = new SolidColorBrush(Microsoft.UI.Colors.White), StrokeThickness = 2.5, IsHitTestVisible = false, Visibility = Visibility.Collapsed };
            if (!labels.Children.Contains(meDot)) labels.Children.Add(meDot);
            surface.Move(new CameraOptions { Center = new LatLng(me[1], me[0]) });
            if (navId is not null) await Routes();
        }
        catch (Exception error) when (error is UnauthorizedAccessException or System.Runtime.InteropServices.COMException or TaskCanceledException)
        { notice = "没有拿到你的位置：在 Windows 设置里允许定位，或选一个出发地。"; Draw(); }
    }

    private void Square()
    {
        _ = SquareAsync();
        async Task SquareAsync()
        {
            var camera = (await surface.Map.GetCameraAsync()).Camera;
            var upright = camera.Pitch < 4 && Math.Abs(camera.Bearing) < 1;
            surface.Move(new CameraOptions { Bearing = 0, Pitch = upright ? (openBuilding is not null ? 44 : 52) : 0 }, CameraUpdateMode.Ease, 800);
        }
    }

    private async void SetMoment(DateOnly date, int min)
    {
        var now = Moment.Now();
        moment = new Moment(date, min); isNow = date == now.Date && min == now.Min;
        await LoadDay();
        Counts();
        if (openBuilding is not null) await PaintRooms();
        FloorButtons(openBuilding);
        Draw();
    }

    // ——— the panel ———
    private void Draw()
    {
        sheet.Children.Clear();
        sheet.Children.Add(RulerBox());
        var body = new StackPanel { Padding = new Thickness(20, 6, 20, 24) };
        sheet.Children.Add(body);
        if (space is null || model is null) { body.Children.Add(Kit.Text(notice ?? "正在打开校园…", Role.Label, "muted")); return; }
        void Row(string key, UIElement value, Action? open = null) => body.Children.Add(Kit.Row(key, value, open));
        UIElement Value(string text, string? small = null) { var v = Kit.Column(2, Kit.Text(text, Role.Label, wrap: true)); ((TextBlock)v.Children[0]).FontSize = 14; if (small is not null) v.Children.Add(Kit.Text(small, Role.Caption, "muted", wrap: true)); return v; }
        void Title(string text) { var t = Pages.SheetTitle(text); t.Margin = new Thickness(0, 10, 0, 4); body.Children.Add(t); }
        void Meta(string text) { var m = Kit.Text(text, Role.Label, "muted", wrap: true); m.Margin = new Thickness(0, 0, 0, 8); body.Children.Add(m); }
        void Buttons(params (string Label, Action Act, bool Go)[] buttons)
        {
            var grid = new Grid { ColumnSpacing = 8, Margin = new Thickness(0, 6, 0, 14) };
            for (var i = 0; i < buttons.Length; i++) { grid.ColumnDefinitions.Add(new ColumnDefinition()); var b = Kit.Action(buttons[i].Label, buttons[i].Act, buttons[i].Go); b.HorizontalAlignment = HorizontalAlignment.Stretch; Grid.SetColumn(b, i); grid.Children.Add(b); }
            body.Children.Add(grid);
        }
        var selected = placeId is not null ? space.ById.GetValueOrDefault(placeId) : null;
        var building = BuildingOf(selected);
        var picked = selected?.Kind == "room" ? selected : null;
        string Metres(double m) => m < 1000 ? $"{Math.Round(m / 10) * 10} 米" : $"{m / 1000:0.0} 公里";

        if (navId is not null && space.ById.GetValueOrDefault(navId) is { } destination)
        {
            var name = destination.Kind == "room" ? Names.Room(destination.Id) : Places.DisplayName(destination, space.ById);
            var route = routes.Count > chosen ? routes[chosen] : null;
            Title(route is not null ? $"{(mode == "walk" ? "步行" : "骑行")} {Math.Max(1, (int)Math.Ceiling((double)route["duration_s"]! / 60))} 分钟 · {Metres((double)route["distance_m"]!)}" : name);
            Meta($"到 {name}");
            // Where from: one's position, or a place typed and picked, found as every place is found (Find.Places).
            var fromName = origin is not null && space.ById.GetValueOrDefault(origin) is { } start ? Places.DisplayName(start, space.ById) : null;
            var fromBox = Kit.Field(fromName ?? "", "从我的位置出发，或输入出发地", "出发地");
            var found = new StackPanel { Margin = new Thickness(0, 4, 0, 6) };
            fromBox.TextChanged += (_, _) =>
            {
                found.Children.Clear();
                var said = fromBox.Text.Trim();
                if (said.Length == 0 || said == fromName) return;
                foreach (var p in Find.Places(space.Places, said, 6).Where(p => p.Id != destination.Id))
                {
                    var row = Kit.Row("", Value(Places.DisplayName(p, space.ById), p.Category), () => { origin = p.Id; _ = Routes(); });
                    found.Children.Add(row);
                }
            };
            body.Children.Add(fromBox);
            body.Children.Add(found);
            if (origin is not null) { var mine = new Tap { Content = Kit.Text("改从我的位置出发", Role.Label, "brand"), Margin = new Thickness(0, 0, 0, 10) }; mine.Click += (_, _) => { origin = null; _ = Routes(); }; body.Children.Add(mine); }
            var modes = Kit.Choice([("walk", "步行"), ("bike", "骑行")], mode, m => { mode = m; _ = Routes(); }); modes.Margin = new Thickness(0, 0, 0, 10);
            body.Children.Add(modes);
            if (routes.Count > 1)
                for (var i = 0; i < routes.Count; i++)
                {
                    var r = routes[i]; var index = i;
                    Row($"{Math.Max(1, (int)Math.Ceiling((double)r["duration_s"]! / 60))} 分钟", Value(Metres((double)r["distance_m"]!), $"经 {Places.RouteText((string?)r["via"] ?? "")}"), () => { chosen = index; _ = Routes(); });
                }
            if (route is not null)
            {
                var steps = new StackPanel { Spacing = 6, Margin = new Thickness(0, 10, 0, 0) };
                var n = 1;
                foreach (var step in route["maneuvers"]!.AsArray())
                {
                    var line = new Grid { ColumnSpacing = 10 }; line.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(18) }); line.ColumnDefinitions.Add(new ColumnDefinition());
                    line.Children.Add(Kit.Text($"{n++}", Role.Caption, "faint"));
                    var t = Kit.Text(Places.RouteText((string)step!["instruction"]!), Role.Label, wrap: true); Grid.SetColumn(t, 1); line.Children.Add(t);
                    steps.Children.Add(line);
                }
                body.Children.Add(steps);
            }
            Buttons(("结束导航", () => { navId = null; routes = []; _ = Routes(); Draw(); }, false));
        }
        else if (picked is not null && building is not null)
        {
            var room = roomById.GetValueOrDefault(picked.Id);
            var state = room is not null && World.Rooms.Classroom(room) ? StateOf(picked.Id) : null;
            Title(Names.Room(picked.Id));
            Meta($"{building.Names.FirstOrDefault()} {floor} 层{(room?.Seats is { } seats ? $" · {seats} 座" : "")}{(room?.Kinds.FirstOrDefault() is { } kind ? $" · {System.Text.RegularExpressions.Regex.Replace(kind, "^(仙林|三牌楼|锁金)", "")}" : "")}");
            if (state is not null)
            {
                var said = day is null ? "这一天没有排课数据" : state.Busy ? $"{(state.Current is not null ? "上课中" : "有人用")}，到 {Clock.Hm(state.Until)}" : state.Minutes > 0 ? $"空闲，到 {Clock.Hm(state.Until)}，还能待 {Clock.Duration(state.Minutes)}" : "空闲，今天没课了";
                var t = Kit.Text(said, Role.Body, state.Busy || day is null ? "muted" : "free", bold: true); t.Margin = new Thickness(0, 0, 0, 6); body.Children.Add(t);
            }
            Buttons(("去这里", () => { navId = picked.Id; placeId = null; _ = Scene(); Draw(); }, true));
            foreach (var use in state?.Occupants ?? [])
                Row($"{Clock.Hm(use.Start)}–{Clock.Hm(use.End)}", Value($"{Names.Course(use.Occupant.Course)}{(use.Occupant.Kind == "exam" ? " · 考试" : "")}", string.Join(" ", use.Occupant.Teachers) + (use.Occupant.Classes.Count > 0 ? $" · {string.Join(" ", use.Occupant.Classes.Take(2))}{(use.Occupant.Classes.Count > 2 ? " 等" : "")}" : "")));
            if (state is not null && day is not null && state.Occupants.Count == 0) Meta("今天没有排课");
        }
        else if (building is not null && HasFloors(building.Id))
        {
            var rooms = TeachingRooms(building.Id).Where(r => floor is null || r.Floor == floor.ToString()).ToList();
            var free = rooms.Select(r => (Room: r, State: StateOf(r.Id)!)).Where(x => day is not null && !x.State.Busy).OrderByDescending(x => x.State.Minutes).ToList();
            Title($"{building.Names.FirstOrDefault()}{(floor is not null ? $" {floor} 层" : "")}");
            Buttons(("去这里", () => { navId = building.Id; placeId = null; _ = Scene(); Draw(); }, true));
            if (rooms.Count > 0)
            {
                var all = TeachingRooms(building.Id).Count(r => day is not null && StateOf(r.Id)?.Busy == false);
                var sum = new TextBlock { FontSize = 13.5, Foreground = Paint.Brush("muted"), Margin = new Thickness(0, 4, 0, 6) };
                sum.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = free.Count.ToString(), Foreground = Paint.Brush("free"), FontWeight = FontWeights.SemiBold });
                sum.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = $" / {rooms.Count} 间空闲 · 全楼 {all} 间" });
                body.Children.Add(sum);
                foreach (var (room, state) in free)
                    Row(Names.RoomShort(room.Id), Value(state.Minutes > 0 ? $"空到 {Clock.Hm(state.Until)}" : "今天没课了", room.Seats is { } s ? $"{s} 座" : "座位未知"), () => Select(room.Id));
                if (free.Count == 0) Meta("这一层此刻没有空教室");
            }
            else
                foreach (var part in model.Floors.GetValueOrDefault($"{building.Id}/{floor}")?.Rooms ?? [])
                    if (space.ById.GetValueOrDefault(part.Id!) is { } p) Row("", Value(p.Names.FirstOrDefault() ?? p.Id), () => Select(p.Id));
        }
        else if (selected is not null)
        {
            Title(Places.DisplayName(selected, space.ById));
            if (selected.Category is not null) Meta(selected.Category);
            var now = CampusDay.Now();
            var status = Hours.At(selected.Hours, now.DayOfWeek == DayOfWeek.Sunday ? 7 : (int)now.DayOfWeek, now.Hour * 60 + now.Minute);
            if (status.Open != Open.Unknown) { var t = Kit.Text($"{Places.OpenLabel[status.Open]} · 今日 {status.Today}", Role.Label, status.Open == Open.Closed ? "muted" : "free", bold: true); t.Margin = new Thickness(0, 0, 0, 6); body.Children.Add(t); }
            Buttons(("去这里", () => { navId = selected.Id; placeId = null; _ = Scene(); Draw(); }, true));
            if (selected.Hours is { ValueKind: JsonValueKind.Object } hours && hours.TryGetProperty("week", out var week))
                for (var d = 1; d <= 7; d++)
                    Row(Clock.Weekdays[d], Value(week.TryGetProperty(d.ToString(), out var list) && list.GetArrayLength() > 0 ? string.Join("、", list.EnumerateArray().Select(w => $"{w[0].GetString()}–{w[1].GetString()}")) : "不开放"));
        }
        else
        {
            var head = Kit.Text("此刻可以去", Role.Label, "muted", bold: true); head.Margin = new Thickness(0, 10, 0, 4); body.Children.Add(head);
            foreach (var s in Places.Recommendations(space.Places, Clock.Weekday(moment.Date), moment.Min, me))
                Row("", Value(Places.DisplayName(s.Place, space.ById), string.Join(" · ", new[] { s.Place.Category, s.Status.Open == Open.Unknown ? null : Places.OpenLabel[s.Status.Open], me is not null ? Metres(s.Distance) : null }.Where(x => !string.IsNullOrEmpty(x)))), () => Select(s.Place.Id));
            if (day is not null && reader is not null && roomIndex is not null)
            {
                var count = roomIndex.Rooms.Where(World.Rooms.Classroom).Count(r => !reader.At(day, r.Id, moment.Min).Busy);
                Row("", Value($"{count} 间空教室"), () => App.Open("search", ("rooms", moment)));
            }
        }
        if (notice is not null)
        {
            var n = Kit.Text(notice, Role.Label, "warning", wrap: true); n.Margin = new Thickness(0, 12, 0, 0);
            body.Children.Add(n);
        }
    }

    /** The moment the map shows: its time large, its day, and the ruler of the campus day to drag along. */
    private FrameworkElement RulerBox()
    {
        var box = new StackPanel { Padding = new Thickness(20, 16, 20, 2) };
        var head = new Grid { ColumnSpacing = 8 };
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); head.ColumnDefinitions.Add(new ColumnDefinition()); head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var time = Kit.Text(Clock.Hm(moment.Min), Role.Title); time.VerticalAlignment = VerticalAlignment.Center; head.Children.Add(time);
        var holiday = campus.Line?.Holidays.GetValueOrDefault(moment.Date);
        var date = Kit.Line(2, Kit.Button("前一天", () => SetMoment(moment.Date.AddDays(-1), moment.Min), Icons.Back, iconOnly: true),
            Kit.Text($"{(moment.Date == Moment.Now().Date ? "今天" : Clock.Weekdays[Clock.Weekday(moment.Date)])} {Clock.DateLabel(moment.Date)}{(holiday is not null ? $" · {holiday}" : "")}", Role.Label, "muted"),
            Kit.Button("后一天", () => SetMoment(moment.Date.AddDays(1), moment.Min), Icons.Chevron, iconOnly: true));
        foreach (var c in date.Children) ((FrameworkElement)c).VerticalAlignment = VerticalAlignment.Center;
        date.VerticalAlignment = VerticalAlignment.Center; date.Margin = new Thickness(6, 0, 0, 0);
        Grid.SetColumn(date, 1); head.Children.Add(date);
        var back = Kit.Button(isNow ? "现在" : "回到现在", () => { var n = Moment.Now(); SetMoment(n.Date, n.Min); }); back.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(back, 2); head.Children.Add(back);
        box.Children.Add(head);
        box.Children.Add(Ruler());
        return box;
    }

    private FrameworkElement Ruler()
    {
        var ruler = new Grid { Height = 40, Margin = new Thickness(0, 8, 0, 4), Background = Paint.Clear };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(ruler, "查看的时刻");
        double Share(int minutes) => (Math.Clamp(minutes, RulerStart, RulerEnd) - RulerStart) / (double)(RulerEnd - RulerStart);
        var lane = new Canvas { Height = 40 };
        ruler.Children.Add(lane);
        void Lay()
        {
            lane.Children.Clear();
            var w = ruler.ActualWidth; if (w <= 0) return;
            var basis = new Border { Width = w, Height = 8, CornerRadius = new CornerRadius(2), Background = Paint.Brush("surfaceSunken") }; Canvas.SetTop(basis, 9); lane.Children.Add(basis);
            foreach (var p in campus.Periods)
            {
                var a = Share(Clock.Minutes(p.Start)) * w; var b = Share(Clock.Minutes(p.End)) * w;
                var per = new Rectangle { Width = Math.Max(1, b - a), Height = 8, Fill = Paint.Brush("ink"), Opacity = .14 }; Canvas.SetLeft(per, a); Canvas.SetTop(per, 9); lane.Children.Add(per);
            }
            foreach (var hour in new[] { 8, 10, 12, 14, 16, 18, 20 })
            {
                var t = Kit.Text(hour.ToString(), Role.Caption, "faint"); t.FontSize = 10.5; t.Measure(new(100, 100));
                Canvas.SetLeft(t, Share(hour * 60) * w - t.DesiredSize.Width / 2); Canvas.SetTop(t, 22); lane.Children.Add(t);
            }
            var now = Moment.Now();
            if (moment.Date == now.Date) { var n = new Rectangle { Width = 1.5, Height = 16, Fill = Paint.Brush("now") }; Canvas.SetLeft(n, Share(now.Min) * w - .75); Canvas.SetTop(n, 5); lane.Children.Add(n); }
            var cur = new Border { Width = 3, Height = 20, CornerRadius = new CornerRadius(1.5), Background = Paint.Brush("ink") }; Canvas.SetLeft(cur, Share(moment.Min) * w - 1.5); Canvas.SetTop(cur, 3); lane.Children.Add(cur);
        }
        ruler.SizeChanged += (_, _) => Lay();
        var dragging = false;
        void From(Microsoft.UI.Xaml.Input.PointerRoutedEventArgs e)
        {
            var x = e.GetCurrentPoint(ruler).Position.X;
            var min = (int)(Math.Round((RulerStart + Math.Clamp(x / ruler.ActualWidth, 0, 1) * (RulerEnd - RulerStart)) / 5) * 5);
            moment = new Moment(moment.Date, min); isNow = false; Lay();
            ((TextBlock)((Grid)((StackPanel)sheet.Children[0]).Children[0]).Children[0]).Text = Clock.Hm(min);
        }
        ruler.PointerPressed += (_, e) => { dragging = true; ruler.CapturePointer(e.Pointer); From(e); };
        ruler.PointerMoved += (_, e) => { if (dragging) From(e); };
        ruler.PointerReleased += (_, e) => { dragging = false; ruler.ReleasePointerCapture(e.Pointer); SetMoment(moment.Date, moment.Min); };
        return ruler;
    }
}
