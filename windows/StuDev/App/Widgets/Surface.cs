// A widget's surface: pressed anywhere that is not a control, the widget keeps exactly under the pointer at every move: no
// easing behind it, no snapping while it is held. Only when it is let go does it settle onto an edge or a neighbour
// close by, in a short glide. The move cursor belongs only to a captured drag; hovering keeps the normal cursor of
// the content underneath, so the surface and its buttons never compete to set a move cursor.
using Microsoft.UI.Input;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using static StuDev.Native;

namespace StuDev.Widgets;

public sealed partial class Surface : Grid
{
    /** How long the settle onto an edge takes. */
    private const double Settle = .12;
    private static readonly InputCursor Arrow = InputSystemCursor.Create(InputSystemCursorShape.Arrow);
    private static readonly InputCursor Move = InputSystemCursor.Create(InputSystemCursorShape.SizeAll);
    private readonly nint hwnd;
    private bool movable = true;
    private (double X, double Y) from, to;
    private bool dragging;
    private Pointer? held;
    private POINT grabCursor;
    private (int X, int Y) grabWindow;
    private readonly System.Diagnostics.Stopwatch settling = new();

    public Surface(nint hwnd)
    {
        this.hwnd = hwnd;
        // Clear rather than none, so the empty parts between its rows are the surface too and take the press.
        Background = StuDev.Ui.Paint.Clear;
        ProtectedCursor = Arrow;
        PointerPressed += Pressed;
        PointerMoved += Moved;
        PointerReleased += (_, e) => Let(e.Pointer);
        PointerCaptureLost += (_, _) => EndDrag();
        PointerCanceled += (_, _) => EndDrag();
        Unloaded += (_, _) => { EndDrag(); CompositionTarget.Rendering -= Step; };
    }

    /** Locking during a drag releases it too; idle hover never advertises an in-progress move. */
    public bool Movable
    {
        get => movable;
        set { movable = value; if (!value) { EndDrag(); CompositionTarget.Rendering -= Step; } }
    }

    /** Whether a press landed on something of its own to press, which it keeps: a button, a field, a scroll bar. */
    private bool OnControl(object source)
    {
        for (var at = source as DependencyObject; at is not null && at != this; at = VisualTreeHelper.GetParent(at))
            if (at is ButtonBase or TextBox or PasswordBox or Selector or ScrollBar or Thumb) return true;
        return false;
    }

    private void Pressed(object sender, PointerRoutedEventArgs e)
    {
        if (!movable || e.Pointer.PointerDeviceType != PointerDeviceType.Mouse || !e.GetCurrentPoint(this).Properties.IsLeftButtonPressed || OnControl(e.OriginalSource)) return;
        if (!GetCursorPos(out grabCursor) || !GetWindowRect(hwnd, out var window)) return;
        CompositionTarget.Rendering -= Step;
        grabWindow = (window.Left, window.Top);
        if (!CapturePointer(e.Pointer)) return;
        held = e.Pointer;
        dragging = true;
        ProtectedCursor = Move;
        e.Handled = true;
    }

    private void Moved(object sender, PointerRoutedEventArgs e)
    {
        if (!dragging || !GetCursorPos(out var cursor)) return;
        SetWindowPos(hwnd, 0, grabWindow.X + cursor.X - grabCursor.X, grabWindow.Y + cursor.Y - grabCursor.Y, 0, 0, 0x0001 | 0x0004 | 0x0010);
        e.Handled = true;
    }

    private void Let(Pointer pointer)
    {
        if (!dragging || held?.PointerId != pointer.PointerId) return;
        EndDrag();
        if (!GetWindowRect(hwnd, out var window)) return;
        var (x, y) = Snapping.Snap(hwnd, window.Left, window.Top);
        if (x == window.Left && y == window.Top) return;
        from = (window.Left, window.Top); to = (x, y);
        settling.Restart();
        CompositionTarget.Rendering += Step;
    }

    private void EndDrag()
    {
        var pointer = held;
        held = null;
        dragging = false;
        ProtectedCursor = Arrow;
        if (pointer is not null) ReleasePointerCapture(pointer);
    }

    private void Step(object? sender, object e)
    {
        var t = Math.Min(1, settling.Elapsed.TotalSeconds / Settle);
        var eased = 1 - Math.Pow(1 - t, 3);
        SetWindowPos(hwnd, 0, (int)Math.Round(from.X + (to.X - from.X) * eased), (int)Math.Round(from.Y + (to.Y - from.Y) * eased), 0, 0, 0x0001 | 0x0004 | 0x0010);
        if (t >= 1) CompositionTarget.Rendering -= Step;
    }
}
