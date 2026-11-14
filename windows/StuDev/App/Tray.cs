// StuDev in the notification area, as TickTick and other desktop apps are: closing the window leaves it running here,
// so the desktop card and reminders go on. Its menu opens the window, shows or hides the card, or quits.
using System.Runtime.InteropServices;
using static StuDev.Native;

namespace StuDev;

internal static unsafe class Tray
{
    private const uint Callback = WM_APP + 1;
    private const nuint Open = 1, Card = 2, Quit = 3;
    private static nint window;
    private static uint taskbarCreated;
    private static NOTIFYICONDATAW data;
    public static event Action? Opened, CardToggled, QuitAsked;
    public static Func<bool>? CardShown;

    public static void Show()
    {
        if (window != 0) return;
        var instance = GetModuleHandleW(null);
        fixed (char* name = "StuDevTray")
        {
            var wc = new WNDCLASSEXW { cbSize = (uint)sizeof(WNDCLASSEXW), lpfnWndProc = &Procedure, hInstance = instance, lpszClassName = name };
            RegisterClassExW(in wc);
        }
        window = CreateWindowExW(0, "StuDevTray", "StuDev", 0, 0, 0, 0, 0, HWND_MESSAGE, 0, instance, 0);
        taskbarCreated = RegisterWindowMessageW("TaskbarCreated");
        data = new NOTIFYICONDATAW { cbSize = (uint)sizeof(NOTIFYICONDATAW), hWnd = window, uID = 1, uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP, uCallbackMessage = Callback,
            hIcon = LoadImageW(0, Path.Combine(AppContext.BaseDirectory, "Assets", "StuDev.ico"), 1, 32, 32, 0x10), uVersion = NOTIFYICON_VERSION_4 };
        fixed (char* tip = data.szTip) { "StuDev".AsSpan().CopyTo(new Span<char>(tip, 128)); }
        Add();
    }
    private static void Add() { Shell_NotifyIconW(NIM_ADD, in data); Shell_NotifyIconW(NIM_SETVERSION, in data); }
    public static void Hide() { if (window != 0) Shell_NotifyIconW(NIM_DELETE, in data); }

    [UnmanagedCallersOnly]
    private static nint Procedure(nint hwnd, uint message, nint w, nint l)
    {
        if (message == taskbarCreated && taskbarCreated != 0) { Add(); return 0; }
        if (message != Callback) return DefWindowProcW(hwnd, message, w, l);
        var said = (uint)(l & 0xFFFF);
        if (said == WM_LBUTTONUP) Opened?.Invoke();
        else if (said is WM_RBUTTONUP or WM_CONTEXTMENU) Menu(hwnd);
        return 0;
    }

    private static void Menu(nint hwnd)
    {
        var menu = CreatePopupMenu();
        AppendMenuW(menu, MF_STRING, Open, "打开 StuDev");
        AppendMenuW(menu, MF_STRING | (CardShown?.Invoke() == true ? MF_CHECKED : 0), Card, "桌面卡片");
        AppendMenuW(menu, MF_SEPARATOR, 0, null);
        AppendMenuW(menu, MF_STRING, Quit, "退出");
        GetCursorPos(out var at);
        SetForegroundWindow(hwnd);
        var chosen = TrackPopupMenuEx(menu, TPM_RIGHTBUTTON | TPM_RETURNCMD, at.X, at.Y, hwnd, 0);
        DestroyMenu(menu);
        switch (chosen) { case (uint)Open: Opened?.Invoke(); break; case (uint)Card: CardToggled?.Invoke(); break; case (uint)Quit: QuitAsked?.Invoke(); break; }
    }
}
