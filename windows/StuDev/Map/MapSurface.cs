// The map drawn natively: MapLibre Native renders the campus with Vulkan into a ring of DXGI shared textures, and each
// frame is copied by Direct3D 11 into a swap chain the window composes; nothing is drawn by a browser. The pointer pans
// with the left button, turns and tilts with the right (or Ctrl), and the wheel zooms where it points. A frame is made
// only when the map asks for one.
using System.Runtime.InteropServices;
using Maplibre.NativeFfi;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace StuDev.Map;

public sealed partial class MapSurface : SwapChainPanel
{
    private static RuntimeHandle? runtime;
    private MapHandle? map;
    private VulkanDeviceHandle? vulkan;
    private RenderSessionHandle? session;
    private ID3D11Device1? device;
    private ID3D11DeviceContext? context;
    private IDXGISwapChain1? chain;
    private ID3D11Query? done;
    private readonly Dictionary<long, ID3D11Texture2D> opened = new();
    private MapProjectionHandle? projection;
    private (uint Width, uint Height) logical, physical;
    private double scale = 1;
    private volatile bool redraw = true;
    private bool rendering;
    private Windows.Foundation.Point? down;
    private Windows.Foundation.Point last;
    private bool steering, moved;
    private TaskCompletionSource ready = new();

    /** After each frame is shown: where things now are on screen. */
    public event Action<MapProjectionHandle>? Shown;
    /** A tap that did not move the map, at its point in the panel. */
    public event Action<ScreenPoint>? Tapped2;
    public MapHandle Map => map ?? throw new InvalidOperationException("地图还没准备好。");
    public RenderSessionHandle Session => session ?? throw new InvalidOperationException("地图还没准备好。");
    public Task Ready => ready.Task;
    public MapProjectionHandle? Projection => projection;

    public MapSurface()
    {
        Loaded += (_, _) => Start();
        Unloaded += (_, _) => Stop();
        SizeChanged += async (_, _) => await Resize();
        PointerPressed += OnPressed; PointerMoved += OnMoved; PointerReleased += OnReleased; PointerCanceled += (_, _) => down = null;
        PointerWheelChanged += OnWheel;
        DoubleTapped += (_, e) => { var at = e.GetPosition(this); Delta(new CameraDelta { Scale = 2, Anchor = new ScreenPoint(at.X, at.Y), Animation = new AnimationOptions { DurationMs = 300 } }); };
        CompositionScaleChanged += async (_, _) => await Resize();
    }

    private static (uint, uint) Logical(double w, double h) => ((uint)Math.Max(1, Math.Round(w)), (uint)Math.Max(1, Math.Round(h)));

    private void Start()
    {
        if (map is null) Create();
        if (!rendering) { CompositionTarget.Rendering += Pump; rendering = true; }
        redraw = true;
    }
    private void Stop() { if (rendering) { CompositionTarget.Rendering -= Pump; rendering = false; } }

    private void Create()
    {
        scale = XamlRoot.RasterizationScale;
        logical = Logical(ActualWidth, ActualHeight);
        physical = ((uint)Math.Round(logical.Width * scale), (uint)Math.Round(logical.Height * scale));
        // Direct3D and Vulkan on the same GPU, the faster one, so the shared textures never cross adapters.
        using var factory = DXGI.CreateDXGIFactory2<IDXGIFactory6>(false);
        factory.EnumAdapterByGpuPreference(0, GpuPreference.HighPerformance, out IDXGIAdapter1? adapter).CheckError();
        using (adapter)
        {
            D3D11.D3D11CreateDevice(adapter!, Vortice.Direct3D.DriverType.Unknown, DeviceCreationFlags.BgraSupport, [Vortice.Direct3D.FeatureLevel.Level_11_1], out ID3D11Device base0, out ID3D11DeviceContext context0).CheckError();
            device = base0.QueryInterface<ID3D11Device1>(); base0.Dispose(); context = context0;
            var luid = adapter!.Description1.Luid;
            vulkan = VulkanDeviceHandle.Create(new VulkanDeviceOptions { DeviceLuid = System.Collections.Immutable.ImmutableArray.Create(BitConverter.GetBytes(((long)luid.HighPart << 32) | luid.LowPart)) });
        }
        done = device.CreateQuery(new QueryDescription(QueryType.Event));
        Chain();
        runtime ??= RuntimeHandle.Create(new RuntimeOptions(Path.Combine(AppContext.BaseDirectory, "map"), Data.Storage.PathFor("map-cache.db")));
        map = runtime.CreateMap(new MapOptions { InitialExtent = new LogicalExtent(logical.Width, logical.Height, scale), MapMode = Maplibre.NativeFfi.MapMode.Continuous });
        session = map.AttachDxgiSharedTextureRing(new DxgiSharedTextureRingDescriptor(new LogicalSize(logical.Width, logical.Height), 3), vulkan,
            new RenderSessionAttachOptions { Driver = RenderDriverKind.CoreWorker, ProducerSyncKinds = GpuSyncKindFlag.CpuComplete, RedrawWake = new Wake(() => redraw = true), FrameWake = new Wake(() => redraw = true) });
        ready.TrySetResult();
    }

    private void Chain()
    {
        chain?.Dispose();
        using var dxgi = device!.QueryInterface<IDXGIDevice>();
        using var adapter = dxgi.GetAdapter();
        using var factory = adapter.GetParent<IDXGIFactory2>();
        chain = factory.CreateSwapChainForComposition(device, new SwapChainDescription1
        {
            Width = physical.Width, Height = physical.Height, Format = Format.B8G8R8A8_UNorm, BufferCount = 2, SwapEffect = SwapEffect.FlipSequential,
            BufferUsage = Usage.RenderTargetOutput, SampleDescription = new SampleDescription(1, 0), AlphaMode = AlphaMode.Ignore, Scaling = Scaling.Stretch,
        });
        using (var two = chain.QueryInterface<IDXGISwapChain2>()) two.MatrixTransform = System.Numerics.Matrix3x2.CreateScale((float)(1 / scale));
        SetSwapChain(chain.NativePointer);
    }

    /** Hands the swap chain to the panel through ISwapChainPanelNative, by its vtable, as NativeAOT allows. */
    private unsafe void SetSwapChain(IntPtr swapChain)
    {
        var self = ((WinRT.IWinRTObject)this).NativeObject.ThisPtr;
        var iid = new Guid("63aad0b8-7c24-40ff-85a8-640d944cc325");
        Marshal.ThrowExceptionForHR(Marshal.QueryInterface(self, in iid, out var native));
        try { Marshal.ThrowExceptionForHR(((delegate* unmanaged[Stdcall]<IntPtr, IntPtr, int>)(*(IntPtr**)native)[3])(native, swapChain)); }
        finally { Marshal.Release(native); }
    }

    private async Task Resize()
    {
        if (map is null || session is null || ActualWidth < 1 || ActualHeight < 1) return;
        var nextScale = XamlRoot.RasterizationScale;
        var next = Logical(ActualWidth, ActualHeight);
        if (next == logical && nextScale == scale) return;
        logical = next; scale = nextScale;
        physical = ((uint)Math.Round(logical.Width * scale), (uint)Math.Round(logical.Height * scale));
        foreach (var texture in opened.Values) texture.Dispose();
        opened.Clear();
        chain!.ResizeBuffers(2, physical.Width, physical.Height, Format.B8G8R8A8_UNorm, SwapChainFlags.None).CheckError();
        using (var two = chain.QueryInterface<IDXGISwapChain2>()) two.MatrixTransform = System.Numerics.Matrix3x2.CreateScale((float)(1 / scale));
        await session.ResizeAsync(new LogicalSize(logical.Width, logical.Height));
        projection?.Release(); projection = null;
        redraw = true;
    }

    /** Each composition tick: ask for a frame when the map wants one, and show the newest that is ready. */
    private void Pump(object? sender, object e)
    {
        if (session is null || chain is null) return;
        if (redraw) { redraw = false; session.DemandFrame(new FrameDemand(FrameDemandFlag.Force, 0)); }
        MapView? view = null;
        foreach (var result in session.DrainFrameResults()) { view = result.View; if (result.NeedsRepaint) redraw = true; }
        var frame = session.AcquireFrame();
        if (frame is null) return;
        try
        {
            ID3D11Texture2D? source = null;
            frame.WithDxgiSharedTexture(texture =>
            {
                var handle = (long)texture.Handle.Address;
                if (!opened.TryGetValue(handle, out source)) opened[handle] = source = device!.OpenSharedResource1<ID3D11Texture2D>((IntPtr)handle);
            });
            using var back = chain.GetBuffer<ID3D11Texture2D>(0);
            var size = source!.Description;
            if (size.Width == physical.Width && size.Height == physical.Height) context!.CopyResource(back, source);
            else context!.CopySubresourceRegion(back, 0, 0, 0, 0, source, 0, new Vortice.Mathematics.Box(0, 0, 0, (int)Math.Min(size.Width, physical.Width), (int)Math.Min(size.Height, physical.Height), 1));
            // The texture goes back to the map only once the copy has finished on the GPU.
            context.End(done!);
            context.Flush();
            while (!context.IsDataAvailable(done!)) Thread.SpinWait(64);
            chain.Present(1, PresentFlags.None);
        }
        finally { frame.Release(new GpuSync(GpuSyncKind.CpuComplete, 0, 0)); }
        if (view is { } v)
        {
            if (projection is null) projection = MapProjectionHandle.Create(v);
            else projection.SetCamera(v.Camera.ToOptions());
            Shown?.Invoke(projection);
        }
    }

    public void Delta(CameraDelta delta) { if (map is not null) _ = map.ApplyCameraDeltaAsync(delta); redraw = true; }
    public void Move(CameraOptions camera, CameraUpdateMode mode = CameraUpdateMode.Ease, double ms = 900)
    {
        if (map is null) return;
        _ = map.UpdateCameraAsync(new CameraUpdate { Mode = mode, Camera = camera, Animation = mode == CameraUpdateMode.Jump ? new AnimationOptions() : new AnimationOptions { DurationMs = ms } });
        redraw = true;
    }
    public void Redraw() => redraw = true;

    private void OnPressed(object sender, PointerRoutedEventArgs e)
    {
        var point = e.GetCurrentPoint(this);
        down = last = point.Position; moved = false;
        steering = point.Properties.IsRightButtonPressed || e.KeyModifiers.HasFlag(Windows.System.VirtualKeyModifiers.Control);
        CapturePointer(e.Pointer);
        Delta(new CameraDelta { GesturePhase = GesturePhase.Begin });
        e.Handled = true;
    }
    private void OnMoved(object sender, PointerRoutedEventArgs e)
    {
        if (down is not { } start) return;
        var at = e.GetCurrentPoint(this).Position;
        if (!moved && Math.Abs(at.X - start.X) + Math.Abs(at.Y - start.Y) < 4) return;
        moved = true;
        var (dx, dy) = (at.X - last.X, at.Y - last.Y);
        last = at;
        Delta(steering ? new CameraDelta { Bearing = -dx * .4, Pitch = -dy * .35, GesturePhase = GesturePhase.Update } : new CameraDelta { Offset = new ScreenPoint(dx, dy), GesturePhase = GesturePhase.Update });
        e.Handled = true;
    }
    private void OnReleased(object sender, PointerRoutedEventArgs e)
    {
        if (down is null) return;
        var at = e.GetCurrentPoint(this).Position;
        down = null; ReleasePointerCapture(e.Pointer);
        Delta(new CameraDelta { GesturePhase = GesturePhase.End });
        if (!moved) Tapped2?.Invoke(new ScreenPoint(at.X, at.Y));
        e.Handled = true;
    }
    private void OnWheel(object sender, PointerRoutedEventArgs e)
    {
        var point = e.GetCurrentPoint(this);
        Delta(new CameraDelta { Scale = Math.Pow(2, point.Properties.MouseWheelDelta / 480.0), Anchor = new ScreenPoint(point.Position.X, point.Position.Y) });
        e.Handled = true;
    }
}
