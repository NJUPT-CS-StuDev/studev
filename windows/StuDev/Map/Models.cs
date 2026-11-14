// The baked campus buildings over the map, as the website's model layer puts them (src/campus/map/models.ts): one
// buffer from njupt-map, 12 bytes a vertex, drawn with the map's own camera into the same swap chain after the map's
// frame is copied in. MapLibre Native gives its camera, not its matrix, so the matrix is made here as its
// TransformState::getProjMatrix makes it; the plain footprints of the modelled buildings are filtered out of the map.
using System.IO.Compression;
using System.Runtime.InteropServices;
using Maplibre.NativeFfi;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace StuDev.Map;

public sealed record ModelIndex(double[] Origin, double Scale, Dictionary<string, int[]> Buildings);

/** How the models look this frame: one building left out while its floors are open, the others faded, by night darker. */
public sealed record ModelLook(string? Hidden, double Flatten, double Night, double Faded, (float R, float G, float B) FadeTo);

public sealed partial class Models : IDisposable
{
    [StructLayout(LayoutKind.Sequential)]
    private struct Constants { public System.Numerics.Matrix4x4 Matrix; public float Flatten, Night, Faded, Unused; public float R, G, B, Unused2; }

    private const double Earth = 2 * Math.PI * 6378137.0;
    private readonly ModelIndex index;
    private readonly int count;
    private readonly ID3D11Buffer vertices, constants;
    private readonly ID3D11InputLayout layout;
    private readonly ID3D11VertexShader vertexShader;
    private readonly ID3D11PixelShader pixelShader;
    private readonly ID3D11DepthStencilState depthState;
    private readonly ID3D11RasterizerState rasterizer;
    private ID3D11Texture2D? depth;
    private ID3D11DepthStencilView? depthView;
    private (uint Width, uint Height) depthSize;
    public ModelLook Look { get; set; } = new(null, 1, 0, 0, (0, 0, 0));
    public IReadOnlyCollection<string> Buildings => index.Buildings.Keys;

    public Models(ID3D11Device device, ModelIndex index, byte[] gzipped)
    {
        this.index = index;
        using var unzip = new GZipStream(new MemoryStream(gzipped), CompressionMode.Decompress);
        using var raw = new MemoryStream();
        unzip.CopyTo(raw);
        var data = raw.ToArray();
        count = (int)(raw.Length / 12);
        vertices = device.CreateBuffer(data, BindFlags.VertexBuffer);
        constants = device.CreateBuffer(new BufferDescription((uint)Marshal.SizeOf<Constants>(), BindFlags.ConstantBuffer, Vortice.Direct3D11.ResourceUsage.Dynamic, CpuAccessFlags.Write));
        var vertexCode = Shader("ModelsVertex.cso");
        vertexShader = device.CreateVertexShader(vertexCode);
        pixelShader = device.CreatePixelShader(Shader("ModelsPixel.cso"));
        layout = device.CreateInputLayout([new InputElementDescription("WORDS", 0, Format.R32G32B32_UInt, 0, 0)], vertexCode);
        depthState = device.CreateDepthStencilState(new DepthStencilDescription(true, DepthWriteMask.All, ComparisonFunction.LessEqual));
        rasterizer = device.CreateRasterizerState(new RasterizerDescription(CullMode.None, FillMode.Solid) { DepthClipEnable = true, MultisampleEnable = false });
    }

    private static byte[] Shader(string name)
    {
        using var stream = typeof(Models).Assembly.GetManifestResourceStream($"StuDev.Map.Shaders.{name}") ?? throw new InvalidOperationException($"shader {name} is not embedded");
        using var memory = new MemoryStream();
        stream.CopyTo(memory);
        return memory.ToArray();
    }

    /** Draws the buildings over the map frame already in the back buffer, with the camera that frame was drawn with. */
    public void Draw(ID3D11Device device, ID3D11DeviceContext context, ID3D11Texture2D back, Camera camera, double width, double height, (uint Width, uint Height) physical)
    {
        if (depthSize != physical || depthView is null)
        {
            depthView?.Dispose(); depth?.Dispose();
            depth = device.CreateTexture2D(new Texture2DDescription(Format.D24_UNorm_S8_UInt, physical.Width, physical.Height, 1, 1, BindFlags.DepthStencil));
            depthView = device.CreateDepthStencilView(depth);
            depthSize = physical;
        }
        using var target = device.CreateRenderTargetView(back);
        context.ClearDepthStencilView(depthView, DepthStencilClearFlags.Depth, 1, 0);
        var look = Look;
        var matrix = Matrix(camera, width, height);
        var mapped = context.Map(constants, Vortice.Direct3D11.MapMode.WriteDiscard);
        Marshal.StructureToPtr(new Constants { Matrix = matrix, Flatten = (float)look.Flatten, Night = (float)look.Night, Faded = (float)look.Faded, R = look.FadeTo.R, G = look.FadeTo.G, B = look.FadeTo.B }, mapped.DataPointer, false);
        context.Unmap(constants);
        context.OMSetRenderTargets(target, depthView);
        context.RSSetViewport(new Vortice.Mathematics.Viewport(0, 0, physical.Width, physical.Height));
        context.RSSetState(rasterizer);
        context.OMSetDepthStencilState(depthState);
        context.OMSetBlendState(null);
        context.IASetPrimitiveTopology(PrimitiveTopology.TriangleList);
        context.IASetInputLayout(layout);
        context.IASetVertexBuffer(0, vertices, 12);
        context.VSSetShader(vertexShader);
        context.VSSetConstantBuffer(0, constants);
        context.PSSetShader(pixelShader);
        context.PSSetConstantBuffer(0, constants);
        if (look.Hidden is { } hidden && index.Buildings.TryGetValue(hidden, out var skip))
        {
            context.Draw((uint)skip[0], 0);
            context.Draw((uint)(count - skip[0] - skip[1]), (uint)(skip[0] + skip[1]));
        }
        else context.Draw((uint)count, 0);
        context.OMSetRenderTargets((ID3D11RenderTargetView)null!, null);
    }

    /** World pixels of a place at a zoom: what MapLibre's projection matrix takes. */
    public static (double X, double Y) WorldPixel(double lng, double lat, double worldSize) =>
        ((lng + 180) / 360 * worldSize, (180 - 180 / Math.PI * Math.Log(Math.Tan(Math.PI / 4 + lat * Math.PI / 360))) / 360 * worldSize);

    /** The model's units to Direct3D clip space through the map's camera (MapLibre Native's getProjMatrix, then the model). */
    public System.Numerics.Matrix4x4 Matrix(Camera camera, double width, double height)
    {
        var zoom = camera.Zoom; var worldSize = 512 * Math.Pow(2, zoom);
        var fov = camera.FieldOfView > 3.2 ? camera.FieldOfView * Math.PI / 180 : camera.FieldOfView;
        if (fov <= 0) fov = 0.6435011087932844;
        var pitch = camera.Pitch * Math.PI / 180; var bearing = -camera.Bearing * Math.PI / 180;
        var padding = camera.Padding;
        var offsetX = (padding.Left - padding.Right) / 2; var offsetY = (padding.Top - padding.Bottom) / 2;
        var toCentre = 0.5 / Math.Tan(fov / 2) * height;
        var tanAbove = (height * 0.5 + offsetY) / (height * 0.5) * Math.Tan(fov / 2);
        var far = toCentre / Math.Max(1e-3, 1 - tanAbove * Math.Tan(pitch)) * 1.01;
        var m = Mat.Perspective(fov, width / height, 1, far);
        m[8] = -offsetX * 2 / width; m[9] = offsetY * 2 / height;
        m = Mat.Scale(m, 1, -1, 1);
        m = Mat.Translate(m, 0, 0, -toCentre);
        m = Mat.RotateX(m, pitch);
        m = Mat.RotateZ(m, bearing);
        var centre = WorldPixel(camera.Center.Longitude, camera.Center.Latitude, worldSize);
        m = Mat.Translate(m, -centre.X, -centre.Y, 0);
        var metresPerPixel = Math.Cos(camera.Center.Latitude * Math.PI / 180) * Earth / worldSize;
        m = Mat.Scale(m, 1, 1, 1 / metresPerPixel);
        // The model: int16 units of `scale` metres from the origin, y northward, z up in metres.
        var origin = WorldPixel(index.Origin[0], index.Origin[1], worldSize);
        var pixelsPerMetre = worldSize / (Earth * Math.Cos(index.Origin[1] * Math.PI / 180));
        var unit = pixelsPerMetre * index.Scale;
        double[] model = [unit, 0, 0, 0, 0, -unit, 0, 0, 0, 0, index.Scale, 0, origin.X, origin.Y, 0, 1];
        m = Mat.Multiply(m, model);
        // OpenGL's clip depth runs -1 to 1, Direct3D's 0 to 1.
        double[] direct = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, .5, 0, 0, 0, .5, 1];
        m = Mat.Multiply(direct, m);
        // Row-major for the shader: row r is m[c * 4 + r] over the columns c.
        return new((float)m[0], (float)m[4], (float)m[8], (float)m[12], (float)m[1], (float)m[5], (float)m[9], (float)m[13],
            (float)m[2], (float)m[6], (float)m[10], (float)m[14], (float)m[3], (float)m[7], (float)m[11], (float)m[15]);
    }

    /** Screen point of a model-space point through the matrix: for checking the matrix against the map's own projection. */
    public static (double X, double Y) Screen(System.Numerics.Matrix4x4 matrix, double x, double y, double z, double width, double height)
    {
        var clip = System.Numerics.Vector4.Transform(new System.Numerics.Vector4((float)x, (float)y, (float)z, 1), System.Numerics.Matrix4x4.Transpose(matrix));
        return ((clip.X / clip.W + 1) / 2 * width, (1 - clip.Y / clip.W) / 2 * height);
    }

    public void Dispose()
    {
        depthView?.Dispose(); depth?.Dispose();
        rasterizer.Dispose(); depthState.Dispose(); layout.Dispose(); pixelShader.Dispose(); vertexShader.Dispose(); constants.Dispose(); vertices.Dispose();
    }
}

/** Column-major 4×4 matrices, as gl-matrix and MapLibre write them. */
internal static class Mat
{
    public static double[] Multiply(double[] a, double[] b)
    {
        var o = new double[16];
        for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) { double s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
        return o;
    }
    public static double[] Perspective(double fovy, double aspect, double near, double far)
    {
        var f = 1 / Math.Tan(fovy / 2); var nf = 1 / (near - far);
        return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
    }
    public static double[] Scale(double[] m, double x, double y, double z) => Multiply(m, [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]);
    public static double[] Translate(double[] m, double x, double y, double z) => Multiply(m, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
    public static double[] RotateX(double[] m, double a) { double s = Math.Sin(a), c = Math.Cos(a); return Multiply(m, [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); }
    public static double[] RotateZ(double[] m, double a) { double s = Math.Sin(a), c = Math.Cos(a); return Multiply(m, [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
}
