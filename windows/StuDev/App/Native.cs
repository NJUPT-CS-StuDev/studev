// The few Win32 calls StuDev's presence on the desktop needs (the tray icon, a borderless card dragged and kept on the
// desktop), declared for NativeAOT: generated marshalling, no reflection.
using System.Runtime.InteropServices;

namespace StuDev;

internal static unsafe partial class Native
{
    public const uint WM_APP = 0x8000, WM_LBUTTONUP = 0x0202, WM_RBUTTONUP = 0x0205, WM_CONTEXTMENU = 0x007B, WM_NCLBUTTONDOWN = 0x00A1, WM_COMMAND = 0x0111;
    public const nint HTCAPTION = 2;
    public const uint NIM_ADD = 0, NIM_MODIFY = 1, NIM_DELETE = 2, NIM_SETVERSION = 4, NIF_MESSAGE = 1, NIF_ICON = 2, NIF_TIP = 4, NOTIFYICON_VERSION_4 = 4;
    public const uint MF_STRING = 0, MF_SEPARATOR = 0x800, MF_CHECKED = 8, TPM_RIGHTBUTTON = 2, TPM_RETURNCMD = 0x100;
    public const uint SWP_NOSIZE = 1, SWP_NOMOVE = 2, SWP_NOACTIVATE = 0x10;
    public static readonly nint HWND_BOTTOM = 1, HWND_MESSAGE = -3;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct WNDCLASSEXW { public uint cbSize, style; public delegate* unmanaged<nint, uint, nint, nint, nint> lpfnWndProc; public int cbClsExtra, cbWndExtra; public nint hInstance, hIcon, hCursor, hbrBackground; public char* lpszMenuName, lpszClassName; public nint hIconSm; }
    [StructLayout(LayoutKind.Sequential)]
    public struct NOTIFYICONDATAW
    {
        public uint cbSize; public nint hWnd; public uint uID, uFlags, uCallbackMessage; public nint hIcon;
        public fixed char szTip[128]; public uint dwState, dwStateMask; public fixed char szInfo[256]; public uint uVersion; public fixed char szInfoTitle[64]; public uint dwInfoFlags;
        public Guid guidItem; public nint hBalloonIcon;
    }
    public struct POINT { public int X, Y; }

    [LibraryImport("user32.dll", SetLastError = true)] public static partial ushort RegisterClassExW(in WNDCLASSEXW wc);
    [LibraryImport("user32.dll", SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
    public static partial nint CreateWindowExW(uint exStyle, string className, string name, uint style, int x, int y, int w, int h, nint parent, nint menu, nint instance, nint param);
    [LibraryImport("user32.dll")] public static partial nint DefWindowProcW(nint hwnd, uint msg, nint w, nint l);
    [LibraryImport("user32.dll", StringMarshalling = StringMarshalling.Utf16)] public static partial uint RegisterWindowMessageW(string name);
    [LibraryImport("user32.dll", StringMarshalling = StringMarshalling.Utf16)] public static partial nint LoadImageW(nint instance, string name, uint type, int cx, int cy, uint load);
    [LibraryImport("user32.dll")] public static partial nint CreatePopupMenu();
    [LibraryImport("user32.dll", StringMarshalling = StringMarshalling.Utf16)] [return: MarshalAs(UnmanagedType.Bool)] public static partial bool AppendMenuW(nint menu, uint flags, nuint id, string? text);
    [LibraryImport("user32.dll")] public static partial uint TrackPopupMenuEx(nint menu, uint flags, int x, int y, nint hwnd, nint param);
    [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static partial bool DestroyMenu(nint menu);
    [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static partial bool GetCursorPos(out POINT point);
    [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static partial bool SetForegroundWindow(nint hwnd);
    [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static partial bool SetWindowPos(nint hwnd, nint after, int x, int y, int cx, int cy, uint flags);
    [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static partial bool ReleaseCapture();
    [LibraryImport("user32.dll")] public static partial nint SendMessageW(nint hwnd, uint msg, nint w, nint l);
    [LibraryImport("shell32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static partial bool Shell_NotifyIconW(uint message, in NOTIFYICONDATAW data);
    [LibraryImport("kernel32.dll", StringMarshalling = StringMarshalling.Utf16)] public static partial nint GetModuleHandleW(string? name);
}
