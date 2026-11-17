# Physical cursor acceptance for the shipping widget, with an isolated profile and restored pointer/focus.
param([Parameter(Mandatory)][string]$Exe, [string]$Output='D:\Temp\codex\studev-cursor')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.ComponentModel; using System.Collections.Generic; using System.Text;
public static class CursorProbe {
 [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; }
 [StructLayout(LayoutKind.Sequential)] public struct Info { public uint Size,Flags; public IntPtr Cursor; public Point Position; }
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [StructLayout(LayoutKind.Sequential)] struct Mouse { public int X,Y; public uint Data,Flags,Time; public IntPtr Extra; }
 [StructLayout(LayoutKind.Sequential)] struct Input { public uint Type; public Mouse Mouse; }
 [DllImport("user32.dll",SetLastError=true)] static extern bool GetCursorInfo(ref Info value);
 [DllImport("user32.dll",SetLastError=true)] static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] static extern IntPtr LoadCursor(IntPtr instance,IntPtr id);
 [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,Input[] inputs,int size);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window,out Rect bounds);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr window,StringBuilder text,int length);
 delegate bool Each(IntPtr window,IntPtr context);
 [DllImport("user32.dll")] static extern bool EnumWindows(Each each,IntPtr context);
 public static Info Read() { var before=SetThreadDpiAwarenessContext((IntPtr)(-4)); try { var value=new Info { Size=(uint)Marshal.SizeOf<Info>() }; if(!GetCursorInfo(ref value)) throw new Win32Exception(Marshal.GetLastWin32Error()); return value; } finally { SetThreadDpiAwarenessContext(before); } }
 public static uint HitOwner(Point point) { var before=SetThreadDpiAwarenessContext((IntPtr)(-4)); try { GetWindowThreadProcessId(WindowFromPoint(point),out var owner); return owner; } finally { SetThreadDpiAwarenessContext(before); } }
 public static void Move(int x,int y) { var before=SetThreadDpiAwarenessContext((IntPtr)(-4)); try { if(!SetCursorPos(x,y)) throw new Win32Exception(Marshal.GetLastWin32Error()); } finally { SetThreadDpiAwarenessContext(before); } }
 public static void Button(bool down) { var input=new Input { Mouse=new Mouse { Flags=down?2u:4u } }; if(SendInput(1,new[]{input},Marshal.SizeOf<Input>())!=1) throw new Win32Exception(Marshal.GetLastWin32Error()); }
 public static string Shape(IntPtr cursor) { if(cursor==LoadCursor(IntPtr.Zero,(IntPtr)32512)) return "Arrow"; if(cursor==LoadCursor(IntPtr.Zero,(IntPtr)32649)) return "Hand"; if(cursor==LoadCursor(IntPtr.Zero,(IntPtr)32646)) return "SizeAll"; if(cursor==LoadCursor(IntPtr.Zero,(IntPtr)32513)) return "IBeam"; return "Other:"+cursor; }
 public static IntPtr Widget(uint owner) { IntPtr found=IntPtr.Zero; EnumWindows((window,_)=>{GetWindowThreadProcessId(window,out var process); if(process!=owner)return true;var title=new StringBuilder(128);GetWindowTextW(window,title,128);if(title.ToString()=="StuDev 桌面小组件")found=window;return true;},IntPtr.Zero);return found; }
}
'@
# A denied global-cursor API ends this test; no alternate observation mechanism is substituted.
$null=[CursorProbe]::Read()
New-Item -ItemType Directory -Force -Path $Output | Out-Null
$taskHome=Join-Path $Output ([guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskHome | Out-Null
@{tray=$false;widgets=@(@{id='cursor-accept';kind='calendar';view='week';bounds=@(80,80,680,620);onTop=$true;locked=$false;opacity=100})} | ConvertTo-Json -Depth 8 -Compress | Set-Content -LiteralPath (Join-Path $taskHome 'device.json') -Encoding utf8NoBOM
'{"class":"B240402","appearance":"dark"}' | Set-Content -LiteralPath (Join-Path $taskHome 'preferences.json') -Encoding utf8NoBOM
$start=[Diagnostics.ProcessStartInfo]::new((Resolve-Path -LiteralPath $Exe).Path)
$start.Environment['STUDEV_DATA_DIR']=$taskHome
$start.ArgumentList.Add('--background')
$previous=[CursorProbe]::GetForegroundWindow()
$app=[Diagnostics.Process]::Start($start)
$pointer=$null; $held=$false; $phases=[Collections.Generic.List[object]]::new()
$A=[System.Windows.Automation.AutomationElement]; $tree=[System.Windows.Automation.TreeScope]::Descendants
function FindControl($root,[string]$name) {
 $condition=[System.Windows.Automation.PropertyCondition]::new($A::NameProperty,$name)
 for($attempt=0;$attempt -lt 30;$attempt++){ $found=$root.FindFirst($tree,$condition);if($found){return $found};Start-Sleep -Milliseconds 100 }
 throw "The owned widget has no '$name' control."
}
function Bounds { $physical=$script:widget.Current.BoundingRectangle; $value=[CursorProbe+Rect]::new();$value.Left=[int]$physical.Left;$value.Top=[int]$physical.Top;$value.Right=[int]$physical.Right;$value.Bottom=[int]$physical.Bottom;return $value }
function Trace([string]$name,[int]$x,[int]$y,[string]$expected,[bool]$moving=$false) {
 $samples=[Collections.Generic.List[string]]::new()
 [CursorProbe]::Move($x,$y);Start-Sleep -Milliseconds 70
 for($i=0;$i -lt 64;$i++){
  $dx=if($moving){[int]($i/4)}else{$i%3-1}
  [CursorProbe]::Move($x+$dx,$y+($i%3-1));Start-Sleep -Milliseconds 8
  $sample=[CursorProbe]::Read()
  if([CursorProbe]::HitOwner($sample.Position) -ne $script:app.Id){throw "$name is not over the owned widget at intended $($x+$dx),$($y+($i%3-1)); observed $($sample.Position.X),$($sample.Position.Y). No other window will be sampled."}
  $samples.Add([CursorProbe]::Shape($sample.Cursor))
 }
 $groups=@($samples | Group-Object | ForEach-Object { @{shape=$_.Name;count=$_.Count} })
 $transitions=0;for($i=1;$i -lt $samples.Count;$i++){if($samples[$i] -ne $samples[$i-1]){$transitions++}}
 $phases.Add(@{phase=$name;samples=$samples.Count;shapes=$groups;transitions=$transitions})
 $allowed=$expected.Split('|')
 if(((-not $moving) -and $groups.Count -ne 1) -or $transitions -gt 2 -or @($samples | Where-Object {$_ -notin $allowed}).Count){throw "$name changed away from stable $expected : $($groups | ConvertTo-Json -Compress)"}
}
function ToggleLock {
 $more=FindControl $script:widget '更多'
 $more.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
 $control=FindControl $script:widget '锁定位置和大小'
 $toggle=$null
 if($control.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$toggle)){ $toggle.Toggle() }
 else { $control.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }
 Start-Sleep -Milliseconds 150
}
try {
 for($i=0;$i -lt 160;$i++){ $widgetHandle=[CursorProbe]::Widget([uint32]$app.Id);if($widgetHandle -ne [IntPtr]::Zero){break};if($app.HasExited){throw 'The owned app exited.'};Start-Sleep -Milliseconds 250 }
 if($widgetHandle -eq [IntPtr]::Zero){throw 'The owned shipping widget did not appear.'}
 $widget=$A::FromHandle($widgetHandle)
 $control=FindControl $widget '更多'
 [CursorProbe]::SetWindowPos($widgetHandle,[IntPtr](-1),0,0,0,0,0x13) | Out-Null
 Start-Sleep -Milliseconds 900
 $pointer=[CursorProbe]::Read()
 $before=Bounds
 $x=[int](($before.Left+$before.Right)/2);$y=$before.Top+40
 Trace 'unlocked surface hover and slight motion' $x $y 'Arrow'
 $box=$control.Current.BoundingRectangle
 $controlX=[int]($box.Left+$box.Width/2);$controlY=[int]($box.Top+$box.Height/2)
 if($controlX -lt $before.Left -or $controlX -ge $before.Right -or $controlY -lt $before.Top -or $controlY -ge $before.Bottom){throw 'The owned control is outside its widget.'}
 Trace 'unlocked control hover and slight motion' $controlX $controlY 'Arrow|Hand'
 [CursorProbe]::Move($x,$y);Start-Sleep -Milliseconds 50
 [CursorProbe]::Button($true);$held=$true;Start-Sleep -Milliseconds 70
 Trace 'captured drag' ($x+8) ($y+4) 'Arrow|SizeAll' $true
 [CursorProbe]::Button($false);$held=$false;Start-Sleep -Milliseconds 180
 $after=Bounds
 if($after.Left -eq $before.Left -and $after.Top -eq $before.Top){throw 'The unlocked surface did not move while dragging.'}
 if([Math]::Abs(($after.Left-$before.Left)-23) -gt 4){throw 'The unlocked widget did not follow the complete drag.'}
 $x=[int](($after.Left+$after.Right)/2);$y=$after.Top+40
 Trace 'released drag returns to ordinary hover' $x $y 'Arrow'
 ToggleLock
 $locked=Bounds
 Trace 'locked surface hover and slight motion' $x $y 'Arrow'
 [CursorProbe]::Move($x,$y);[CursorProbe]::Button($true);$held=$true;Start-Sleep -Milliseconds 30
 Trace 'locked surface refuses a drag' ($x+8) ($y+4) 'Arrow' $true
 [CursorProbe]::Button($false);$held=$false
 $still=Bounds
 if($still.Left -ne $locked.Left -or $still.Top -ne $locked.Top){throw 'The locked widget moved.'}
 ToggleLock
 $result=@{passed=$true;exe=(Resolve-Path -LiteralPath $Exe).Path;profile=$taskHome;phases=@($phases.ToArray())}
 $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $Output 'result.json') -Encoding utf8NoBOM
 Write-Output 'Windows physical widget cursor acceptance passed.'
} catch {
 @{passed=$false;error=$_.Exception.Message;profile=$taskHome;phases=@($phases.ToArray())} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $Output 'result.json') -Encoding utf8NoBOM
 throw
} finally {
 if($held){[CursorProbe]::Button($false)}
 if($pointer){[CursorProbe]::Move($pointer.Position.X,$pointer.Position.Y)}
 if($previous -ne [IntPtr]::Zero){[CursorProbe]::SetForegroundWindow($previous) | Out-Null}
 if(-not $app.HasExited){$app.Kill();$app.WaitForExit(5000) | Out-Null}
}
