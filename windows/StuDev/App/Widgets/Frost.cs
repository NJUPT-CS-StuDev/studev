// A widget's backdrop: the theme's paper as one translucent brush, so the wallpaper shows through. It is real
// transparency rather than a system material, which turns into a flat colour whenever the system's transparency
// effects are off. DWM composes the window with per-pixel alpha once its frame covers the client area and blur-behind
// is on over an empty region; the brush is made on the system compositor the backdrop target takes, which needs a
// Windows.System dispatcher queue on this thread.
using Microsoft.UI.Composition;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using StuDev.Ui;
using Windows.UI;
using static StuDev.Native;

namespace StuDev.Widgets;

internal sealed partial class Frost : SystemBackdrop
{
    private static Windows.UI.Composition.Compositor? compositor;
    private static nint queue;
    private Windows.UI.Composition.CompositionColorBrush? brush;
    private bool dark = Paint.Dark;
    private double opacity = .88;

    public bool Dark { get => dark; set { dark = value; Tint(); } }
    public double Opacity { get => opacity; set { opacity = Math.Clamp(value, .3, 1); Tint(); } }

    private Color Colour { get { var paper = Paint.Of("paper", dark); return Color.FromArgb((byte)Math.Round(opacity * 255), paper.R, paper.G, paper.B); } }
    private void Tint() { if (brush is not null) brush.Color = Colour; }

    protected override void OnTargetConnected(ICompositionSupportsSystemBackdrop target, XamlRoot root)
    {
        base.OnTargetConnected(target, root);
        if (Windows.System.DispatcherQueue.GetForCurrentThread() is null && queue == 0)
            Check(CreateDispatcherQueueController(new DispatcherQueueOptions { Size = (uint)System.Runtime.InteropServices.Marshal.SizeOf<DispatcherQueueOptions>(), ThreadType = 2, ApartmentType = 2 }, out queue));
        compositor ??= new Windows.UI.Composition.Compositor();
        var window = (nint)root.ContentIslandEnvironment.AppWindowId.Value;
        Check(DwmExtendFrameIntoClientArea(window, new MARGINS()));
        var region = CreateRectRgn(-2, -2, -1, -1);
        Check(DwmEnableBlurBehindWindow(window, new DWM_BLURBEHIND { dwFlags = 3, fEnable = 1, hRgnBlur = region }));
        DeleteObject(region);
        brush = compositor.CreateColorBrush(Colour);
        target.SystemBackdrop = brush;
    }

    protected override void OnTargetDisconnected(ICompositionSupportsSystemBackdrop target)
    {
        base.OnTargetDisconnected(target);
        target.SystemBackdrop = null;
        brush?.Dispose(); brush = null;
    }

    private static void Check(int result) { if (result < 0) System.Runtime.InteropServices.Marshal.ThrowExceptionForHR(result); }
}
