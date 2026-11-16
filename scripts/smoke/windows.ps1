# The Windows app as it ships, opened and used before it is released, in a home of its own so no one's records are
# touched: a class chosen, the four boards, a search, and a desktop widget opened on one of its lessons. After every
# step the app must still be running and must not have written a crash log. Usage: pwsh windows.ps1 -Exe <StuDev.exe>
param([Parameter(Mandatory)] [string]$Exe)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$release = Get-Content -LiteralPath (Join-Path $repo 'src/data/campus-release.json') -Raw | ConvertFrom-Json
$knowledge = Get-Content -LiteralPath (Join-Path $repo "public/data/$($release.version)/knowledge/knowledge.json") -Raw | ConvertFrom-Json
$course = $knowledge.courses | Where-Object name -EQ '数据结构' | Select-Object -First 1
$topic = $knowledge.topics | Where-Object { $_.taught_by -contains $course.id -and $_.references.Count -gt 0 } | Select-Object -First 1
$reference = $topic.references | Select-Object -First 1
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public static class Owned {
    delegate bool Each(IntPtr window, IntPtr context);
    [DllImport("user32.dll")] static extern bool EnumWindows(Each each, IntPtr context);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr window, StringBuilder text, int length);
    // A desktop widget belongs to the desktop's icon view, so it sits outside the automation tree's desktop children.
    public static List<IntPtr> Of(uint process, string title) {
        var found = new List<IntPtr>();
        EnumWindows((window, _) => { GetWindowThreadProcessId(window, out var owner); var text = new StringBuilder(128); GetWindowTextW(window, text, 128); if (owner == process && text.ToString() == title) found.Add(window); return true; }, IntPtr.Zero);
        return found;
    }
}
"@
$A = [System.Windows.Automation.AutomationElement]
$Tree = [System.Windows.Automation.TreeScope]
$tempBase = 'D:\Temp\codex\studev-windows-smoke'
$home_ = Join-Path $tempBase ([guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $home_ | Out-Null
$start = [Diagnostics.ProcessStartInfo]::new($Exe)
$start.Environment['STUDEV_DATA_DIR'] = $home_
$app = [Diagnostics.Process]::Start($start)
$crashLog = Join-Path $home_ 'crash.log'

function Alive([string]$step) {
    if ($app.HasExited) { throw "the app is gone after: $step`n$(if (Test-Path $crashLog) { Get-Content $crashLog -Raw })" }
    if (Test-Path $crashLog) { throw "the app crashed during: $step`n$(Get-Content $crashLog -Raw)" }
    Write-Output "ok  $step"
}
function Windows() { $A::RootElement.FindAll($Tree::Children, [System.Windows.Automation.PropertyCondition]::new($A::ProcessIdProperty, $app.Id)) }
function Main() { foreach ($w in Windows) { if ($w.Current.Name -eq 'StuDev') { return $w } }; $null }
$Prop = [System.Windows.Automation.PropertyCondition]
function Is($property, $value) { $Prop::new($property, $value) }
function Both($a, $b) { [System.Windows.Automation.AndCondition]::new($a, $b) }
$Pressable = Is $A::IsInvokePatternAvailableProperty $true
$Editable = Both (Is $A::ControlTypeProperty ([System.Windows.Automation.ControlType]::Edit)) (Is $A::IsValuePatternAvailableProperty $true)
# The search is the provider's own: a condition goes to the app, not every element through this script.
function Find($root, $condition, [scriptblock]$match, [string]$step, [int]$seconds = 20) {
    for ($i = 0; $i -lt $seconds * 2; $i++) {
        if ($root) { foreach ($e in $root.FindAll($Tree::Descendants, $condition)) { try { if (-not $match -or (& $match $e)) { return $e } } catch {} } }
        Start-Sleep -Milliseconds 500
    }
    throw "not found after ${seconds}s: $step"
}
function Press($root, $what, [string]$step, [int]$seconds = 20) {
    $e = if ($what -is [string]) { Find $root (Both $Pressable (Is $A::NameProperty $what)) $null $step $seconds } else { Find $root $Pressable $what $step $seconds }
    $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    Start-Sleep -Milliseconds 900
    Alive $step
}
function Fill($root, [scriptblock]$match, [string]$text, [string]$step) {
    $e = Find $root $Editable $match $step
    $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($text)
    Start-Sleep -Milliseconds 1200
    Alive $step
}
function PressText($root, [string]$text, [string]$step) {
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    for ($i = 0; $i -lt 40; $i++) {
        foreach ($e in $root.FindAll($Tree::Descendants, (Is $A::NameProperty $text))) {
            $parent = $e
            for ($depth = 0; $parent -and $depth -lt 4; $depth++) {
                if ($parent.Current.IsInvokePatternAvailable) {
                    $parent.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
                    Start-Sleep -Milliseconds 900
                    Alive $step
                    return
                }
                $parent = $walker.GetParent($parent)
            }
        }
        Start-Sleep -Milliseconds 500
    }
    throw "No control for ${text}: $step"
}


try {
    for ($i = 0; -not ($window = Main) -and $i -lt 120; $i++) { Start-Sleep -Milliseconds 250 }
    if (-not $window) { throw 'the main window never appeared' }
    Alive 'open the app'
    # The picker asks once the campus data is in, which a first run fetches.
    Find $window (Is $A::NameProperty '你在哪个班？') $null 'the class picker' 90 | Out-Null
    Fill $window $null 'B240402' 'search a class'
    Press $window 'B240402' 'choose B240402' 30
    foreach ($scale in '周', '学期', '清单', '天') { Press $window $scale "the $scale view" 30 }
    Press $window '地图' 'the map'
    Start-Sleep -Seconds 6; Alive 'the map, drawn'
    Press $window '搜索' 'the search board'
    Fill $window { param($e) $e.Current.Name -eq '搜索' } '计算机' 'search 计算机'
    Find $window (Is $A::ControlTypeProperty ([System.Windows.Automation.ControlType]::Text)) { param($e) $e.Current.Name -match '条结果' } 'search results (the search kernel)' 30 | Out-Null
    Alive 'search results'
    Press $window '知识' 'the knowledge board'
    Fill $window { param($e) $e.Current.Name -eq '筛选课程' } $course.codes[0] 'find the course in the released knowledge'
    PressText $window $course.name 'open the course outline'
    PressText $window $topic.title 'open a topic from the outline'
    Find $window (Is $A::NameProperty '关联资料') $null 'the topic references' 30 | Out-Null
    PressText $window $reference.heading 'open the referenced material passage'
    Find $window (Is $A::ControlTypeProperty ([System.Windows.Automation.ControlType]::Text)) { param($e) $e.Current.Name -eq $reference.heading } 'the referenced passage in the document' 30 | Out-Null
    Alive 'read a linked knowledge passage'
    Press $window 'AI' 'the AI board'
    Press $window '我' 'the me board'
    Press $window { param($e) $e.Current.Name -like '小组件*' } 'the widgets sheet'
    $adds = @($window.FindAll($Tree::Descendants, (Both $Pressable (Is $A::NameProperty '添加'))))
    if ($adds.Count -lt 2) { throw 'the widgets sheet offers no list and calendar to add' }
    $adds[1].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); Start-Sleep -Seconds 3; Alive 'add a calendar widget'
    $widget = $null; for ($i = 0; -not $widget -and $i -lt 40; $i++) { $hwnd = [Owned]::Of([uint32]$app.Id, 'StuDev 桌面小组件') | Select-Object -First 1; if ($hwnd) { $widget = $A::FromHandle($hwnd) } else { Start-Sleep -Milliseconds 250 } }
    if (-not $widget) { throw 'the calendar widget never appeared' }
    $tools = '切换显示内容', '往前', '回到现在', '往后', '更多', '系统', '关闭', '最小化', '最大化'
    $lesson = $null; foreach ($e in $widget.FindAll($Tree::Descendants, $Pressable)) { if (-not $lesson -and $e.Current.Name -and $tools -notcontains $e.Current.Name) { $lesson = $e } }
    if ($lesson) {
        $lesson.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); Start-Sleep -Seconds 2
        Alive "open $($lesson.Current.Name) in the widget"
    } else { Write-Output 'note: the widget shows nothing to open today' }
    Write-Output 'Windows smoke passed'
} finally {
    if (-not $app.HasExited) { $app.Kill(); $app.WaitForExit(5000) | Out-Null }
    $resolvedHome = (Resolve-Path -LiteralPath $home_).Path
    if (-not $resolvedHome.StartsWith($tempBase + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Unexpected smoke directory: $resolvedHome" }
    Remove-Item -LiteralPath $resolvedHome -Recurse -Force
}
