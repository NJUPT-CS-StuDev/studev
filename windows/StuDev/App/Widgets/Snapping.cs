// What the widget windows handle below XAML: the class background, which would paint the window opaque white, is
// cleared to black, which blur-behind composes as transparent; and a widget being moved snaps to the screen's work
// area and to the other widgets, so a row of them lines up without care.
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
        if (message == WM_MOVING) { Snap(hwnd, (RECT*)l); return 1; }
        return CallWindowProcW(previous, hwnd, message, w, l);
    }

    /** The visible frame of a window, without the invisible resize borders around it. */
    private static RECT Frame(nint hwnd) => DwmGetWindowAttribute(hwnd, 9, out var frame, sizeof(RECT)) >= 0 ? frame : GetWindowRect(hwnd, out var outer) ? outer : default;

    private static void Snap(nint hwnd, RECT* moving)
    {
        if (!GetWindowRect(hwnd, out var outer)) return;
        var frame = Frame(hwnd);
        // The proposed visible frame: the proposed window rect less its invisible borders.
        var left = moving->Left + frame.Left - outer.Left; var top = moving->Top + frame.Top - outer.Top;
        var right = moving->Right - (outer.Right - frame.Right); var bottom = moving->Bottom - (outer.Bottom - frame.Bottom);
        var info = new MONITORINFO { cbSize = (uint)sizeof(MONITORINFO) };
        if (!GetMonitorInfoW(MonitorFromRect(*moving, MONITOR_DEFAULTTONEAREST), ref info)) return;
        var scale = GetDpiForWindow(hwnd) / 96.0;
        int reach = (int)(14 * scale), gap = (int)(10 * scale);
        var xs = new List<(int Edge, bool Right)> { (info.rcWork.Left, false), (info.rcWork.Right, true) };
        var ys = new List<(int Edge, bool Bottom)> { (info.rcWork.Top, false), (info.rcWork.Bottom, true) };
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
        moving->Left += dx; moving->Right += dx; moving->Top += dy; moving->Bottom += dy;
    }
}
