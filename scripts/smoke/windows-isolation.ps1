if (!('SmokeDesktop' -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public sealed class SmokeDesktop : IDisposable
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct Startup {
        public int Size;
        public string Reserved, Desktop, Title;
        public int X, Y, XSize, YSize, XCount, YCount, Fill, Flags;
        public short Show, ReservedBytes;
        public IntPtr ReservedData, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInfo {
        public IntPtr Process, Thread;
        public int ProcessId, ThreadId;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateDesktopW(string name, IntPtr device, IntPtr mode, uint flags, uint access, IntPtr security);
    [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr handle);
    [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint thread);
    [DllImport("user32.dll", EntryPoint = "GetUserObjectInformationW", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool DesktopName(IntPtr handle, int index, StringBuilder buffer, int bytes, out int needed);
    [DllImport("user32.dll", EntryPoint = "GetUserObjectInformationW", SetLastError = true)]
    static extern bool DesktopInput(IntPtr handle, int index, out int receivingInput, int bytes, out int needed);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcessW(string image, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity,
        bool inheritHandles, uint flags, IntPtr environment, string directory, ref Startup startup, out ProcessInfo process);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr handle, out int code);

    const string Prefix = "StuDevSmoke-";
    readonly IntPtr desktop;
    IntPtr child;
    public SmokeDesktop(string shell, string encodedCommand, string directory)
    {
        var name = Prefix + Guid.NewGuid().ToString("N");
        desktop = CreateDesktopW(name, IntPtr.Zero, IntPtr.Zero, 0, 0x000F01FF, IntPtr.Zero);
        if (desktop == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        var startup = new Startup { Size = Marshal.SizeOf<Startup>(), Desktop = name };
        var command = new StringBuilder("\"" + shell + "\" -NoProfile -NonInteractive -EncodedCommand " + encodedCommand);
        if (!CreateProcessW(shell, command, IntPtr.Zero, IntPtr.Zero, false, 0x08000000, IntPtr.Zero, directory, ref startup, out var process))
        {
            var failure = Marshal.GetLastWin32Error();
            CloseDesktop(desktop);
            throw new Win32Exception(failure);
        }
        CloseHandle(process.Thread);
        child = process.Process;
    }

    public static bool IsIsolated()
    {
        var handle = GetThreadDesktop(GetCurrentThreadId());
        var name = new StringBuilder(128);
        return DesktopName(handle, 2, name, name.Capacity * 2, out _) && name.ToString().StartsWith(Prefix, StringComparison.Ordinal)
            && DesktopInput(handle, 6, out var input, sizeof(int), out _) && input == 0;
    }

    public bool Finished => WaitForSingleObject(child, 0) == 0;
    public int ExitCode => GetExitCodeProcess(child, out int code) ? code : throw new Win32Exception(Marshal.GetLastWin32Error());
    public void Dispose() { CloseHandle(child); CloseDesktop(desktop); }
}
"@
}

function Invoke-OnSmokeDesktop([string]$Script, [hashtable]$Parameters, [string]$Directory) {
    $log = Join-Path $Directory ('desktop-' + [guid]::NewGuid().ToString('N') + '.log')
    $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($Parameters | ConvertTo-Json -Compress)))
    $scriptPath = $Script.Replace("'", "''")
    $logPath = $log.Replace("'", "''")
    $command = @'
$env:STUDEV_SMOKE_DESKTOP = '1'
$passed = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('@payload@')) | ConvertFrom-Json -AsHashtable
try { & '@script@' @passed *>&1 | Out-File -LiteralPath '@log@' -Encoding utf8 -Width 4096 }
catch { $_ | Out-File -LiteralPath '@log@' -Encoding utf8 -Append; exit 1 }
exit 0
'@
    $command = $command.Replace('@payload@', $payload).Replace('@script@', $scriptPath).Replace('@log@', $logPath)
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    $child = [SmokeDesktop]::new((Join-Path $PSHOME 'pwsh.exe'), $encoded, $Directory)
    try {
        $seen = 0
        do {
            $finished = $child.Finished
            if (Test-Path -LiteralPath $log) {
                $lines = @(Get-Content -LiteralPath $log)
                $lines | Select-Object -Skip $seen
                $seen = $lines.Count
            }
            if (!$finished) { Start-Sleep -Seconds 1 }
        } until ($finished)
        $code = $child.ExitCode
        if ($code -ne 0) { throw "Windows acceptance failed on the isolated desktop (exit $code). Log: $log" }
    } finally { $child.Dispose() }
}
