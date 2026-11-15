// What the widget windows handle below XAML: the class background, which would paint the window opaque white, is
// cleared to black, which blur-behind composes as transparent; and where a widget let go settles: onto the screen's
// work area or another widget within a short reach, so a row of them lines up without care.
using System.Runtime.InteropServices;
using static StuDev.Native;

namespace StuDev.Widgets;

internal static unsafe class Snapping
{
    private static readonly Dictionary<nint, nint> Previous = [];

    public static void Attach(nint hwnd)
    {
        if (Previous.ContainsKey(hwnd)) return;
        delegate* unmanaged<nint, uint, nint, nint, nint> procedure = &Procedure;
        Previous[hwnd] = SetWindowLongPtrW(hwnd, GWLP_WNDPROC, (nint)procedure);
    }

    public static void Detach(nint hwnd)
    {
        if (Previous.Remove(hwnd, out var previous)) SetWindowLongPtrW(hwnd, GWLP_WNDPROC, previous);
    }

    [UnmanagedCallersOnly]
    private static nint Procedure(nint hwnd, uint message, nint w, nint l)
    {
        if (!Previous.TryGetValue(hwnd, out var previous)) return DefWindowProcW(hwnd, message, w, l);
        if (message == WM_ERASEBKGND && GetClientRect(hwnd, out var client)) { FillRect(w, client, GetStockObject(4)); return 1; }
        return CallWindowProcW(previous, hwnd, message, w, l);
    }

    /** The visible frame of a window, without the invisible resize borders around it. */
    private static RECT Frame(nint hwnd) => DwmGetWindowAttribute(hwnd, 9, out var frame, sizeof(RECT)) >= 0 ? frame : GetWindowRect(hwnd, out var outer) ? outer : default;

    /** Where a widget let go at the top left (x, y), in window coordinates, settles. */
    public static (int X, int Y) Snap(nint hwnd, int x, int y)
    {
        if (!GetWindowRect(hwnd, out var outer)) return (x, y);
        var frame = Frame(hwnd);
        // The proposed visible frame: the proposed window less its invisible borders.
        var left = x + frame.Left - outer.Left; var top = y + frame.Top - outer.Top;
        var right = left + (frame.Right - frame.Left); var bottom = top + (frame.Bottom - frame.Top);
        var proposed = new RECT { Left = x, Top = y, Right = x + outer.Right - outer.Left, Bottom = y + outer.Bottom - outer.Top };
        var info = new MONITORINFO { cbSize = (uint)sizeof(MONITORINFO) };
        if (!GetMonitorInfoW(MonitorFromRect(proposed, MONITOR_DEFAULTTONEAREST), ref info)) return (x, y);
        var scale = GetDpiForWindow(hwnd) / 96.0;
        int reach = (int)(16 * scale), gap = (int)(10 * scale);
        var xs = new List<(int Edge, bool Far)> { (info.rcWork.Left, false), (info.rcWork.Right, true) };
        var ys = new List<(int Edge, bool Far)> { (info.rcWork.Top, false), (info.rcWork.Bottom, true) };
        foreach (var other in Previous.Keys)
        {
            if (other == hwnd) continue;
            var o = Frame(other);
            // Side by side with a gap, or aligned edge to edge when stacked.
            xs.Add((o.Right + gap, false)); xs.Add((o.Left - gap, true)); xs.Add((o.Left, false)); xs.Add((o.Right, true));
            ys.Add((o.Bottom + gap, false)); ys.Add((o.Top - gap, true)); ys.Add((o.Top, false)); ys.Add((o.Bottom, true));
        }
        int Nearest(List<(int Edge, bool Far)> edges, int near, int far)
        {
            var best = 0; var distance = reach + 1;
            foreach (var (edge, isFar) in edges)
            {
                var shift = edge - (isFar ? far : near);
                if (Math.Abs(shift) < distance) { distance = Math.Abs(shift); best = shift; }
            }
            return distance <= reach ? best : 0;
        }
        var dx = Nearest(xs, left, right); var dy = Nearest(ys, top, bottom);
        return (x + dx, y + dy);
    }
}
