// The buildings' shadows on the ground, as the web's scene draws them (src/campus/map/scene.ts) and Android's Scene:
// each footprint moved away from the sun by its height, with the walls between, filled black into one picture over
// the campus, softened, and laid under the buildings at a strength the sun's height gives.
using System.Text.Json;
using Maplibre.NativeFfi;

namespace StuDev.Map;

public static class Shadows
{
    public const double North = 32.128, South = 32.102, West = 118.912, East = 118.938;
    public const int Width = 1024, Height = 1260;
    /** The picture's corners, clockwise from the top left. */
    public static LatLng[] Corners => [new(North, West), new(North, East), new(South, East), new(South, West)];

    private static double Merc(double lat) => Math.Log(Math.Tan(Math.PI / 4 + lat * Math.PI / 360));
    private static double X(double lon) => (lon - West) / (East - West) * Width;
    private static double Y(double lat) => (Merc(North) - Merc(lat)) / (Merc(North) - Merc(South)) * Height;

    /** How strongly the shadows show: none with the sun this low, deeper as it climbs, a little less by night. */
    public static double Strength(double altitude, bool night) { var strength = altitude <= 1.5 ? 0 : Math.Min(.2, .05 + altitude / 60); return night ? strength * .9 : strength; }

    /** The shadows of every footprint with the sun where it is, as black of varying cover. */
    public static PremultipliedRgba8Image Draw(IEnumerable<(double Height, JsonElement Geometry)> shapes, double altitude, double azimuth)
    {
        var cover = new byte[Width * Height];
        if (altitude > 1.5)
        {
            var length = 1 / Math.Tan(Math.Max(altitude, 7) * Math.PI / 180);
            var turn = azimuth * Math.PI / 180;
            var dLon = -Math.Sin(turn) * length / (111320 * Math.Cos(32.11 * Math.PI / 180));
            var dLat = -Math.Cos(turn) * length / 110574;
            foreach (var (height, geometry) in shapes)
            {
                var dx = dLon * height; var dy = dLat * height;
                foreach (var edge in OuterRings(geometry))
                {
                    Fill(cover, [.. edge.Select(p => (X(p.Lon + dx), Y(p.Lat + dy)))]);
                    for (var i = 0; i < edge.Count - 1; i++)
                    {
                        var (a, b) = (edge[i], edge[i + 1]);
                        Fill(cover, [(X(a.Lon), Y(a.Lat)), (X(b.Lon), Y(b.Lat)), (X(b.Lon + dx), Y(b.Lat + dy)), (X(a.Lon + dx), Y(a.Lat + dy))]);
                    }
                }
            }
            Soften(cover); Soften(cover);
        }
        var pixels = new byte[Width * Height * 4];
        for (var i = 0; i < cover.Length; i++) pixels[i * 4 + 3] = cover[i];
        return new PremultipliedRgba8Image((uint)Width, (uint)Height, (uint)(Width * 4), System.Runtime.InteropServices.ImmutableCollectionsMarshal.AsImmutableArray(pixels));
    }

    /** The outer ring of each polygon of a GeoJSON polygon or multipolygon, in longitude and latitude. */
    private static IEnumerable<List<(double Lon, double Lat)>> OuterRings(JsonElement geometry)
    {
        static List<(double, double)> Ring(JsonElement ring) => [.. ring.EnumerateArray().Select(p => (p[0].GetDouble(), p[1].GetDouble()))];
        var coordinates = geometry.GetProperty("coordinates");
        switch (geometry.GetProperty("type").GetString())
        {
            case "Polygon": yield return Ring(coordinates[0]); break;
            case "MultiPolygon": foreach (var polygon in coordinates.EnumerateArray()) yield return Ring(polygon[0]); break;
            default: throw new InvalidDataException($"a footprint is a {geometry.GetProperty("type").GetString()}");
        }
    }

    /** Fills a polygon into the cover, row by row through the centres of the pixels. */
    private static void Fill(byte[] cover, (double X, double Y)[] points)
    {
        double top = double.MaxValue, bottom = double.MinValue;
        foreach (var (_, y) in points) { top = Math.Min(top, y); bottom = Math.Max(bottom, y); }
        var from = Math.Max(0, (int)Math.Floor(top)); var to = Math.Min(Height - 1, (int)Math.Ceiling(bottom));
        var crossings = new List<double>();
        for (var row = from; row <= to; row++)
        {
            var y = row + .5;
            crossings.Clear();
            for (var i = 0; i < points.Length; i++)
            {
                var (a, b) = (points[i], points[(i + 1) % points.Length]);
                if ((a.Y <= y) == (b.Y <= y)) continue;
                crossings.Add(a.X + (y - a.Y) / (b.Y - a.Y) * (b.X - a.X));
            }
            crossings.Sort();
            for (var k = 0; k + 1 < crossings.Count; k += 2)
            {
                var left = Math.Max(0, (int)Math.Round(crossings[k])); var right = Math.Min(Width, (int)Math.Round(crossings[k + 1]));
                for (var x = left; x < right; x++) cover[row * Width + x] = 255;
            }
        }
    }

    /** A three-pixel blur across and down, as the web's soft edge. */
    private static void Soften(byte[] cover)
    {
        var across = new byte[cover.Length];
        for (var y = 0; y < Height; y++)
            for (var x = 0; x < Width; x++)
            {
                int sum = 0, n = 0;
                for (var d = -1; d <= 1; d++) { var xx = x + d; if (xx < 0 || xx >= Width) continue; sum += cover[y * Width + xx]; n++; }
                across[y * Width + x] = (byte)(sum / n);
            }
        for (var y = 0; y < Height; y++)
            for (var x = 0; x < Width; x++)
            {
                int sum = 0, n = 0;
                for (var d = -1; d <= 1; d++) { var yy = y + d; if (yy < 0 || yy >= Height) continue; sum += across[yy * Width + x]; n++; }
                cover[y * Width + x] = (byte)(sum / n);
            }
    }
}
