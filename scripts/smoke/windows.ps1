# The Windows app as it ships, opened and used before it is released, in a home of its own so no one's records are
# touched: a class chosen, the four boards, a search, and a desktop widget opened on one of its lessons. After every
# step the app must still be running and must not have written a crash log. Usage: pwsh windows.ps1 -Exe <StuDev.exe>
param([Parameter(Mandatory)] [string]$Exe, [switch]$KeepData, [switch]$Online, [switch]$RoutesOnly)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$release = Get-Content -LiteralPath (Join-Path $repo 'src/data/campus-release.json') -Raw | ConvertFrom-Json
$product = Get-Content -LiteralPath (Join-Path $repo 'product.json') -Raw | ConvertFrom-Json
$places = Get-Content -LiteralPath (Join-Path $repo "public/data/$($release.version)/space/$($product.campus.id)/entities.json") -Raw | ConvertFrom-Json
$building = $places | Where-Object id -EQ $product.campus.opens | Select-Object -First 1
$origin = $places | Where-Object id -EQ "$($product.campus.id)/图书馆" | Select-Object -First 1
$knowledge = Get-Content -LiteralPath (Join-Path $repo "public/data/$($release.version)/knowledge/knowledge.json") -Raw | ConvertFrom-Json
$course = $knowledge.courses | Where-Object name -EQ '数据结构' | Select-Object -First 1
$topic = $knowledge.topics | Where-Object { $_.taught_by -contains $course.id -and $_.references.Count -gt 0 } | Select-Object -First 1
$reference = $topic.references | Select-Object -First 1
$ownSchedule = (Get-Content -LiteralPath (Join-Path $repo "public/data/$($release.version)/teaching/$($release.teaching)/classes/B240402.json") -Raw | ConvertFrom-Json).meetings
$managedCourse = $ownSchedule | Where-Object { $_.course.name -like '*计算机通信与网络*' } | Select-Object -First 1
$managedName = $managedCourse.course.name -replace '[（(].*?[)）]', ''
$allMeetings = @(Get-Content -LiteralPath (Join-Path $repo "public/data/$($release.version)/teaching/$($release.teaching)/meetings.json") -Raw | ConvertFrom-Json)
$ownTeachingGroups = @($ownSchedule.teaching_class.id)
$catalogCourse = $allMeetings | Where-Object { $_.teaching_class.id -notin $ownTeachingGroups -and $_.course.code -and $_.teachers.Count -gt 0 } | Select-Object -First 1
$catalogName = ($catalogCourse.course.name -replace '[（(].*?[)）]', '').Trim()
$navTeacher = ($ownSchedule | Where-Object { $_.teachers.Count -gt 0 } | Select-Object -First 1).teachers[0].name
$navExam = Get-Content -LiteralPath (Join-Path $repo "public/data/$($release.version)/exams/$($release.exams)/exams.json") -Raw | ConvertFrom-Json | Select-Object -First 1
$examIndex = Get-Content -LiteralPath (Join-Path $repo "public/data/$($release.version)/exams/$($release.exams)/index.json") -Raw | ConvertFrom-Json -DateKind String
$examChanges = @(Get-Content -LiteralPath (Join-Path $repo "public/data/$($release.version)/exams/$($release.exams)/changes.json") -Raw | ConvertFrom-Json -DateKind String)
$classIds = @((Get-Content -LiteralPath (Join-Path $repo "public/data/$($release.version)/teaching/$($release.teaching)/classes.json") -Raw | ConvertFrom-Json).id)
$affectedExam = $examChanges | Where-Object { $_.class -in $classIds } | Select-Object -First 1
if (-not $affectedExam -or -not ($examIndex.history | Where-Object baseline)) { throw 'the actual release has no exam baseline or affected class' }
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public static class Owned {
    [StructLayout(LayoutKind.Sequential)] public struct Bounds { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Bounds bounds);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr context, uint flags);
    delegate bool Each(IntPtr window, IntPtr context);
    [DllImport("user32.dll")] static extern bool EnumWindows(Each each, IntPtr context);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr window, StringBuilder text, int length);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr window, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr window, int index, IntPtr value);
    public static uint Owner(IntPtr window) { GetWindowThreadProcessId(window, out var process); return process; }
    // A test instance stays behind the user's work and outside the taskbar; all input uses its own UIA provider.
    public static void ShowForTest(IntPtr window) {
        var style = GetWindowLongPtr(window, -20).ToInt64();
        SetWindowLongPtr(window, -20, new IntPtr((style & ~0x40000L) | 0x80L | 0x08000000L));
        ShowWindow(window, 4);
        SetWindowPos(window, new IntPtr(1), 0, 0, 0, 0, 0x33);
    }
    public static void ResizeForTest(IntPtr window, int width, int height) {
        // Test viewports are logical DIPs; Win32 window dimensions are physical pixels.
        var dpi = GetDpiForWindow(window);
        if (dpi == 0) throw new InvalidOperationException("cannot read the owned test window DPI");
        width = (int)Math.Round(width * dpi / 96d); height = (int)Math.Round(height * dpi / 96d);
        // Do not let a headless desktop's small work area cap this isolated window's tracking size.
        if (!SetWindowPos(window, IntPtr.Zero, 0, 0, width, height, 0x416)) throw new InvalidOperationException("cannot resize the owned test window");
        if (!GetWindowRect(window, out var bounds) || bounds.Right - bounds.Left != width || bounds.Bottom - bounds.Top != height)
            throw new InvalidOperationException("the owned test window did not reach its requested size");
    }
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
'{"tray":false}' | Set-Content -LiteralPath (Join-Path $home_ 'device.json') -Encoding utf8NoBOM
# A real public TCP conversation replay, stored through the application's normal chat schema.
# Viewing its recorded calls needs no account and never sends another request to a model.
$traceMessages = @(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'fixtures/ai-tcp.json') -Raw | ConvertFrom-Json -AsHashtable)
$traceNodes = @(); $traceChosen = @{}; $traceParent = ''
for ($traceIndex = 0; $traceIndex -lt $traceMessages.Count; $traceIndex++) {
    $traceId = "ai-replay-message-$traceIndex"
    $traceNodes += @{ id = $traceId; parent = $traceParent; message = $traceMessages[$traceIndex] }
    $traceChosen[$traceParent] = $traceId; $traceParent = $traceId
}
$traceCalls = @($traceMessages | ForEach-Object { if ($_.ContainsKey('tool_calls')) { $_.tool_calls } })
$traceRead = $traceCalls | Where-Object { $_.function.name -eq 'read' } | Select-Object -First 1
if (-not $traceRead -or $traceMessages[-1].role -ne 'assistant') { throw 'the real AI conversation fixture is incomplete' }
if ($RoutesOnly) {
    # Ordinary public links exercise the same native entry used by actual AI route cards.
    $links = @(
        @{ label='楼内位置'; from='仙林/教1-102'; to='仙林/教1-101' },
        @{ label='楼内跨层'; from='仙林/教1-101'; to='仙林/教1-201' },
        @{ label='同一教室'; from='仙林/教1-101'; to='仙林/教1-101' },
        @{ label='查看二层'; from='仙林/教1-101'; to='仙林/教1/2' },
        @{ label='错误起点'; from='仙林/不存在的起点'; to='仙林/教1-101' },
        @{ label='跨楼骑行'; from='仙林/教1-101'; to='仙林/教2-101'; mode='bike' }
    ) | ForEach-Object { "[$($_.label)](/map/?from=$([uri]::EscapeDataString($_.from))&nav=$([uri]::EscapeDataString($_.to))$(if($_.mode){'&mode='+$_.mode}))" }
    $traceNodes = @(@{ id='route-links-question'; parent=''; message=@{ role='user'; content='查看这些校园地点的路线与楼层。' } }, @{ id='route-links'; parent='route-links-question'; message=@{ role='assistant'; content=$links -join "`n`n" } })
    $traceChosen = @{ ''='route-links-question'; 'route-links-question'='route-links' }
}
$traceSeed = @{ current = 'ai-replay'; chats = @(@{ id = 'ai-replay'; title = ''; updated = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); proposals = @(); thread = @{ nodes = $traceNodes; chosen = $traceChosen } }) }
New-Item -ItemType Directory -Path (Join-Path $home_ 'ai') -Force | Out-Null
$traceSeed | ConvertTo-Json -Depth 50 -Compress | Set-Content -LiteralPath (Join-Path $home_ 'ai/chats.json') -Encoding utf8NoBOM
# Before publication, exercise the exact compiled release through the normal offline cache.
# The isolated home is populated as a device that already fetched this release; app code has no test reader.
if (-not $Online) {
    $cacheRoot = Join-Path $home_ 'cache/campus'
    New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null
    $facts = Join-Path $cacheRoot $release.base.TrimStart('/')
    New-Item -ItemType Directory -Path $facts -Force | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $repo "public$($release.base)") | Where-Object Name -NotIn @('space','knowledge','search','search-base','texts') | Copy-Item -Destination $facts -Recurse
    foreach ($base in @($release.map_base,$release.knowledge_base,$release.search_base,$release.texts_base,$release.search_stable_base) | Where-Object { $_ }) {
        $destination = Join-Path $cacheRoot $base.TrimStart('/')
        New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $repo "public$base") -Destination (Split-Path $destination) -Recurse
    }
    Copy-Item -LiteralPath (Join-Path $repo 'src/data/campus-release.json') -Destination (Join-Path $cacheRoot 'release.json')
}
$start = [Diagnostics.ProcessStartInfo]::new($Exe)
$start.Environment['STUDEV_DATA_DIR'] = $home_
$start.ArgumentList.Add('--background')
$foreground = [Owned]::GetForegroundWindow()
$app = [Diagnostics.Process]::Start($start)
$crashLog = Join-Path $home_ 'crash.log'

function Alive([string]$step) {
    $current = [Owned]::GetForegroundWindow()
    if ($foreground -ne [IntPtr]::Zero -and [Owned]::Owner($current) -eq $app.Id) { [Owned]::SetForegroundWindow($foreground) | Out-Null }
    if ($app.HasExited) { throw "the app is gone after: $step`n$(if (Test-Path $crashLog) { Get-Content $crashLog -Raw })" }
    if (Test-Path $crashLog) { throw "the app crashed during: $step`n$(Get-Content $crashLog -Raw)" }
    Write-Output "ok  $step"
}
function Windows() { $A::RootElement.FindAll($Tree::Children, [System.Windows.Automation.PropertyCondition]::new($A::ProcessIdProperty, $app.Id)) }
function Main() {
    $hwnd = [Owned]::Of([uint32]$app.Id, 'StuDev') | Select-Object -First 1
    if ($hwnd) { [Owned]::ShowForTest($hwnd); return $A::FromHandle($hwnd) }
    $null
}
function Capture([string]$name) {
    $hwnd = [Owned]::Of([uint32]$app.Id, 'StuDev') | Select-Object -First 1
    if (-not $hwnd) { throw "no owned window to capture: $name" }
    $bounds_ = [Owned+Bounds]::new()
    if (-not [Owned]::GetWindowRect($hwnd, [ref]$bounds_)) { throw "cannot read owned window bounds: $name" }
    $bitmap_ = [System.Drawing.Bitmap]::new($bounds_.Right - $bounds_.Left, $bounds_.Bottom - $bounds_.Top)
    $graphics_ = [System.Drawing.Graphics]::FromImage($bitmap_)
    try {
        $context_ = $graphics_.GetHdc()
        try { if (-not [Owned]::PrintWindow($hwnd, $context_, 2)) { throw "cannot capture owned window: $name" } }
        finally { $graphics_.ReleaseHdc($context_) }
        $directory_ = Join-Path $home_ 'screenshots'
        New-Item -ItemType Directory -Path $directory_ -Force | Out-Null
        $bitmap_.Save((Join-Path $directory_ "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics_.Dispose(); $bitmap_.Dispose() }
}
$Prop = [System.Windows.Automation.PropertyCondition]
function Is($property, $value) { $Prop::new($property, $value) }
function Both($a, $b) { [System.Windows.Automation.AndCondition]::new($a, $b) }
$Pressable = Is $A::IsInvokePatternAvailableProperty $true
$Editable = Both (Is $A::ControlTypeProperty ([System.Windows.Automation.ControlType]::Edit)) (Is $A::IsValuePatternAvailableProperty $true)
# The search is the provider's own: a condition goes to the app, not every element through this script.
function Find($root, $condition, [scriptblock]$match, [string]$step, [int]$seconds = 20) {
    $elapsed = [Diagnostics.Stopwatch]::StartNew()
    while ($elapsed.Elapsed.TotalSeconds -lt $seconds) {
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
function SetValue($element, [string]$text) {
    $previous = [Owned]::GetForegroundWindow()
    try { $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($text) }
    finally {
        if ($previous -ne [IntPtr]::Zero -and [Owned]::Owner([Owned]::GetForegroundWindow()) -eq $app.Id) { [Owned]::SetForegroundWindow($previous) | Out-Null }
    }
}
function Fill($root, [scriptblock]$match, [string]$text, [string]$step) {
    $e = Find $root $Editable $match $step
    SetValue $e $text
    Start-Sleep -Milliseconds 1200
    if ($e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value -cne $text) { throw "the input changed during: $step" }
    Alive $step
}
function InWindow($element, [string]$step) {
    $bounds_ = $element.Current.BoundingRectangle
    $windowBounds_ = $window.Current.BoundingRectangle
    if ($element.Current.IsOffscreen -or $bounds_.Width -le 0 -or $bounds_.Height -le 0 -or
        $bounds_.Left -lt $windowBounds_.Left -or $bounds_.Right -gt $windowBounds_.Right -or
        $bounds_.Top -lt $windowBounds_.Top -or $bounds_.Bottom -gt $windowBounds_.Bottom) { throw "the control is clipped: $step" }
    Alive $step
}
function PressText($root, [string]$text, [string]$step) {
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    for ($i = 0; $i -lt 40; $i++) {
        foreach ($e in $root.FindAll($Tree::Descendants, (Is $A::NameProperty $text))) {
            $parent = $e
            for ($depth = 0; $parent -and $depth -lt 4; $depth++) {
                if ($parent.GetCurrentPropertyValue($A::IsInvokePatternAvailableProperty)) {
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

function MapHealthy() {
    foreach ($message in '地图暂时打不开，请稍后重试。', '没有找到路线。') {
        if ($window.FindFirst($Tree::Descendants, (Is $A::NameProperty $message))) { throw "map failure: $message" }
    }
}

function PickFilter([string]$label, [string]$value) {
    $box_ = Find $window (Both (Is $A::ControlTypeProperty ([System.Windows.Automation.ControlType]::ComboBox)) (Is $A::NameProperty $label)) $null "the $label filter"
    $expand_ = $box_.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
    $expand_.Expand()
    $item_ = Find $window (Both (Is $A::IsSelectionItemPatternAvailableProperty $true) (Is $A::NameProperty $value)) $null "the $value filter choice"
    $item_.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
    $expand_.Collapse()
    Start-Sleep -Milliseconds 350
}

function FilterSheet() {
    function Scope() { Find $window (Is $A::ControlTypeProperty ([System.Windows.Automation.ControlType]::Text)) { param($e) $e.Current.Name -match '^2024级 · 计算机科学与技术(?: · \d+项筛选)?$' } 'the inherited knowledge scope' }
    $original_ = (Scope).Current.Name
    if (@($window.FindAll($Tree::Descendants, (Is $A::ControlTypeProperty ([System.Windows.Automation.ControlType]::ComboBox)))).Count -ne 0) { throw 'the knowledge homepage exposes advanced filter fields' }
    Press $window '筛选' 'open the knowledge filter sheet'
    foreach ($label_ in '入学年份', '专业', '学年', '课程类别', '修读要求') {
        Find $window (Both (Is $A::ControlTypeProperty ([System.Windows.Automation.ControlType]::ComboBox)) (Is $A::NameProperty $label_)) $null "the $label_ filter belongs to the sheet" | Out-Null
    }
    PickFilter '学年' '大四'
    Capture 'knowledge-filter-sheet'
    Press $window '取消' 'cancel draft knowledge filters'
    if ((Scope).Current.Name -cne $original_) { throw 'cancelling draft filters changed the knowledge scope' }
    Press $window '筛选' 'reopen knowledge filters'
    PickFilter '学年' '大二'
    Press $window '应用筛选' 'apply the chosen knowledge filters together'
    if ((Scope).Current.Name -notmatch ' · 1项筛选$') { throw 'applying a draft filter did not update the scope summary' }
    Press $window '筛选' 'open the applied knowledge filters'
    Press $window '重置' 'reset only the draft to the personal scope'
    Press $window '应用筛选' 'apply the personal knowledge scope'
    if ((Scope).Current.Name -cne $original_) { throw 'reset did not restore the inherited personal scope' }
    Alive 'knowledge filters stay in their sheet; cancel, apply and reset preserve their intended state'
}

function ManagedCourses() {
    Press $window { param($e) $e.Current.AutomationId -eq 'me' } 'the labeled personal entry'
    Press $window '课表设置' 'open timetable settings'
    Press $window '我的课程' 'one list for public and personal courses'
    Press $window $managedName 'open the actual public course details'
    Find $window (Is $A::NameProperty '上课安排') $null 'course details show all published arrangements' | Out-Null
    Press $window '编辑名称' 'open personal course-name editing'
    Fill $window { param($e) $e.Current.Name -eq '课程名称' } 'SmokeRenamed' 'rename this public course for the current person'
    Capture 'course-name-edit'
    Press $window '保存名称' 'save the personal course name'
    Find $window (Is $A::NameProperty 'SmokeRenamed') $null 'the course details show the saved personal name' | Out-Null
    Press $window '编辑名称' 'reopen personal name editing'
    Press $window '恢复原名' 'restore its original public name'
    Find $window (Is $A::NameProperty $managedName) $null 'the course details show the restored public name' | Out-Null
    $beforeLabs = (Get-Content -LiteralPath (Join-Path $home_ 'preferences.json') -Raw | ConvertFrom-Json).labs | ConvertTo-Json -Depth 20 -Compress
    Press $window '隐藏这门课' 'hide the public teaching class'
    $afterHide = Get-Content -LiteralPath (Join-Path $home_ 'preferences.json') -Raw | ConvertFrom-Json
    if ($afterHide.timetable.($release.teaching).hidden -notcontains $managedCourse.teaching_class.id) { throw 'hiding the course did not persist its public teaching-class identity' }
    if (($afterHide.labs | ConvertTo-Json -Depth 20 -Compress) -cne $beforeLabs) { throw 'hiding a theoretical course changed laboratory attendance' }
    Press $window '显示已隐藏的课程' 'include hidden courses in management'
    Press $window $managedName 'hidden courses retain their details'
    Find $window (Is $A::NameProperty '相关实验') $null 'hidden lectures retain independent related laboratory facts' | Out-Null
    Press $window '恢复到课表' 'restore the hidden public course'
    Press $window '自定义课程' 'add a personal course through the same course manager'
    Fill $window { param($e) $e.Current.Name -eq '课程名称' } 'SmokeCourse' 'name a personal course'
    Fill $window { param($e) $e.Current.Name -eq '地点' } 'SmokeRoom' 'set its place'
    Fill $window { param($e) $e.Current.Name -eq '教师' } 'SmokeTeacher' 'set its teacher'
    Press $window '添加课程' 'save the new personal course'
    $personalBefore = (Get-Content -LiteralPath (Join-Path $home_ 'preferences.json') -Raw | ConvertFrom-Json).timetable.($release.teaching).custom | Where-Object name -EQ 'SmokeCourse'
    if (@($personalBefore).Count -ne 1) { throw 'adding the personal course did not create exactly one course' }
    Press $window 'SmokeCourse' 'open the personal course details'
    Find $window (Is $A::NameProperty 'SmokeTeacher') $null 'the personal teacher is visible in details' | Out-Null
    Find $window (Is $A::ControlTypeProperty ([System.Windows.Automation.ControlType]::Text)) { param($e) $e.Current.Name -like '*SmokeRoom*' } 'the personal place is visible in details' | Out-Null
    Press $window '编辑课程' 'edit the same personal course'
    Fill $window { param($e) $e.Current.Name -eq '课程名称' } 'SmokeEdited' 'edit its name'
    Fill $window { param($e) $e.Current.Name -eq '地点' } 'SmokeRoom2' 'edit its place'
    Press $window '保存修改' 'save personal course changes'
    $personalAfter = (Get-Content -LiteralPath (Join-Path $home_ 'preferences.json') -Raw | ConvertFrom-Json).timetable.($release.teaching).custom | Where-Object id -EQ $personalBefore.id
    if (@($personalAfter).Count -ne 1 -or $personalAfter.name -cne 'SmokeEdited' -or $personalAfter.room -cne 'SmokeRoom2' -or $personalAfter.teacher -cne 'SmokeTeacher') { throw 'editing a personal course did not preserve its identity and update its fields' }
    Press $window 'SmokeEdited' 'open edited course details'
    Press $window '删除自定义课程' 'remove the personal course from this isolated test instance'
    $removed = (Get-Content -LiteralPath (Join-Path $home_ 'preferences.json') -Raw | ConvertFrom-Json).timetable.($release.teaching).custom | Where-Object id -EQ $personalBefore.id
    if ($null -ne $removed) { throw 'the removed course remains stored' }
    Press $window '返回' 'back to timetable settings'
    Press $window '实验安排' 'experiments belong to timetable settings'
    Find $window (Is $A::ControlTypeProperty ([System.Windows.Automation.ControlType]::Text)) { param($e) $e.Current.Name -match '实验与理论课分别选择' } 'independent experiment choices' | Out-Null
    Alive 'public course rename/hide/restore, independent labs and personal course create/edit/delete'
}

function ReferenceGroups() {
    Press $window { param($e) $e.Current.Name -eq '知识' -and $e.Current.AutomationId -ne 'knowledge' } 'return to the course catalog'
    Fill $window { param($e) $e.Current.Name -eq '筛选课程' } '军事理论' 'find a course with many real reference passages'
    PressText $window '军事理论' 'open the military-theory course outline'
    $military = $knowledge.topics | Where-Object id -EQ '军事理论/现代国防观' | Select-Object -First 1
    PressText $window $military.title 'open the topic with a large reference group'
    $group = $military.references | Group-Object material | Sort-Object Count -Descending | Select-Object -First 1
    $prefix = "knowledge-reference:$($group.Name)#"
    function RefCount() { @($window.FindAll($Tree::Descendants, $Pressable) | Where-Object { $_.Current.AutomationId.StartsWith($prefix, [StringComparison]::Ordinal) }).Count }
    Find $window (Both $Pressable (Is $A::NameProperty "展开全部 $($group.Count) 处")) $null 'the long reference group starts collapsed' 30 | Out-Null
    if ((RefCount) -ne 3) { throw 'the long reference group must start with three preview passages' }
    Press $window "展开全部 $($group.Count) 处" 'expand every recorded passage'
    if ((RefCount) -ne $group.Count) { throw 'the expanded group did not retain every exact reference' }
    Press $window '收起' 'collapse the large reference group again'
    if ((RefCount) -ne 3) { throw 'the reference group did not return to three previews' }
    Alive 'large reference groups expand and collapse without losing links'
}

function ExamHistory {
    Press $window '学期' 'open the personal term'
    Press $window { param($e) $e.Current.Name.StartsWith('第一学期') } 'open the published first term'
    Capture 'timetable-first-term'
    Press $window '算法与数据结构设计' 'open the real practice course details'
    Find $window (Is $A::NameProperty '不占课表格子') $null 'practice notes match the term' | Out-Null
    Find $window (Is $A::NameProperty '陈兴国 的课表') $null 'the practice teacher links to a timetable' | Out-Null
    Capture 'practice-detail'
    Press $window '关闭' 'return from practice details'
    Press $window { param($e) $e.Current.Name.StartsWith('第二学期') } 'open the published second term'
    Find $window $Pressable { param($e) $e.Current.Name.StartsWith('暑假 ·') } 'the second term has its published summer break' | Out-Null
    Capture 'timetable-second-term'
    Press $window '考试' 'open the personal exam arrangements'
    $latest = $examIndex.history[-1]
    $count = @($examChanges | Where-Object { $_.version -eq $latest.id -and $_.class -eq 'B240402' }).Count
    $impact = if ($count) { "本班 $count 门考试有变动" } else { '本次更新未影响本班' }
    Find $window (Is $A::AutomationIdProperty "exam-version:$($latest.id)") { param($e) $e.Current.Name.EndsWith("$impact · 当前版本") } 'the latest update reports the published class impact' 30 | Out-Null
    $baseline = $examIndex.history | Where-Object baseline | Select-Object -First 1
    Press $window { param($e) $e.Current.AutomationId -eq "exam-version:$($baseline.id)" } 'open the original exam baseline'
    [Owned]::ResizeForTest([Owned]::Of([uint32]$app.Id, 'StuDev')[0], 600, 880)
    [Owned]::ResizeForTest([Owned]::Of([uint32]$app.Id, 'StuDev')[0], 1280, 880)
    Find $window (Is $A::AutomationIdProperty "exam-version:$($baseline.id)") { param($e) $e.Current.HelpText -eq '已展开' } 'the selected history survives a responsive redraw' | Out-Null
    Find $window (Is $A::NameProperty '当前版本') $null 'the current version remains identified while viewing history' | Out-Null
    Capture 'exam-unaffected-baseline'

    Press $window { param($e) $e.Current.AutomationId -eq 'me' } 'open personal settings to select an affected class'
    Press $window '课表设置' 'open timetable settings'
    Press $window { param($e) $e.Current.Name.StartsWith('班级 ') } 'choose another real class'
    Fill $window { param($e) $e.Current.Name -eq '班号或专业' } $affectedExam.class 'find a real affected class'
    Press $window $affectedExam.class 'select the affected class'
    Press $window { param($e) $e.Current.AutomationId -eq 'timetable' } 'return to the affected class timetable'
    Press $window '学期' 'open the affected class term'
    Press $window { param($e) $e.Current.Name.StartsWith('考试') -and $e.Current.Name.Length -lt 8 } 'open the affected class exams'
    Press $window { param($e) $e.Current.AutomationId -eq "exam-version:$($affectedExam.version)" } 'open the real update affecting this class'
    Find $window (Is $A::ControlTypeProperty ([System.Windows.Automation.ControlType]::Text)) { param($e) $e.Current.Name.Contains($affectedExam.course.name) } 'the actual changed course is named' | Out-Null
    $sitting = if ($affectedExam.after) { $affectedExam.after[0] } else { $affectedExam.before[0] }
    Find $window (Is $A::ControlTypeProperty ([System.Windows.Automation.ControlType]::Text)) { param($e) $e.Current.Name.Contains($sitting.date) -and $e.Current.Name.Contains($sitting.start) } 'the actual added or previous sitting is explained' | Out-Null
    $version = $examIndex.history | Where-Object id -EQ $affectedExam.version | Select-Object -First 1
    Find $window (Is $A::NameProperty "本版采用的文件 · $($version.files.Count) 份") $null 'the selected version shows its files directly' | Out-Null
    foreach ($file in $version.files) { Find $window (Both $Pressable (Is $A::NameProperty ("官方附件：" + ($file.file -replace '^\d{4}-\d{2}-\d{2}-', '')))) $null 'the official file name links directly to its attachment' | Out-Null }
    $announcements = @($window.FindAll($Tree::Descendants, $Pressable) | Where-Object { $_.Current.Name.StartsWith('官方公告：') })
    if ($announcements.Count -ne @($version.files.notice | Select-Object -Unique).Count) { throw 'the same official announcement is repeated for each file' }
    Capture 'exam-affected-official-sources'
    Alive 'real exam versions, baseline, class impact and official sources'

    Press $window { param($e) $e.Current.AutomationId -eq 'me' } 'restore the personal class after exam acceptance'
    Press $window '课表设置' 'return to timetable settings'
    Press $window { param($e) $e.Current.Name.StartsWith('班级 ') } 'restore the original class'
    Fill $window { param($e) $e.Current.Name -eq '班号或专业' } 'B240402' 'find the original class'
    Press $window 'B240402' 'restore B240402'
    Press $window { param($e) $e.Current.AutomationId -eq 'timetable' } 'return to the original timetable'
}

function SearchNavigation {
    Press $window { param($e) $e.Current.AutomationId -eq 'search' } 'open native entity search'
    Press $window '教务' 'scope search to campus academic entities'
    Fill $window { param($e) $e.Current.Name -eq '搜索' } 'B240402' 'search a real class'
    Press $window 'B240402' 'open the class timetable inside Windows' 45
    Find $window (Is $A::NameProperty '我的课表') $null 'the class result opened a native timetable' | Out-Null

    Press $window { param($e) $e.Current.AutomationId -eq 'search' } 'search a teacher'
    Fill $window { param($e) $e.Current.Name -eq '搜索' } $navTeacher 'search a released teacher'
    Press $window $navTeacher 'open the teacher timetable inside Windows' 45
    Find $window (Is $A::NameProperty "$navTeacher 老师") $null 'the teacher result retains its identity' | Out-Null

    Press $window { param($e) $e.Current.AutomationId -eq 'search' } 'search a course catalogue entry'
    Fill $window { param($e) $e.Current.Name -eq '搜索' } $catalogCourse.course.code 'search a released course code'
    Press $window $catalogName 'open the native course catalogue details' 45
    Find $window (Is $A::NameProperty '选择教学班') $null 'the course details are inside the app' | Out-Null
    Press $window { param($e) $e.Current.AutomationId -eq "catalog-teaching-class:$($catalogCourse.teaching_class.id)" } 'inspect a real teaching group'
    Find $window (Is $A::NameProperty '上课安排') $null 'course arrangements reuse the course manager details' | Out-Null
    Press $window '预览课表' 'preview that teaching group over the personal timetable'
    Find $window (Is $A::NameProperty "预览 · $catalogName") $null 'the preview retains its teaching group' | Out-Null
    Capture 'native-course-preview'
    Press $window '加入课表' 'add the previewed published group'
    $added = (Get-Content -LiteralPath (Join-Path $home_ 'preferences.json') -Raw | ConvertFrom-Json).timetable.($release.teaching).added
    if ($added -notcontains $catalogCourse.teaching_class.id) { throw 'the native preview did not add its teaching group' }
    Press $window { param($e) $e.Current.AutomationId -eq 'search' } 'return to the same course result'
    Press $window $catalogName 'reopen the chosen native course' 45
    Press $window { param($e) $e.Current.AutomationId -eq "catalog-teaching-class:$($catalogCourse.teaching_class.id)" } 'inspect the chosen teaching group'
    Press $window '从我的课表移除' 'restore this isolated timetable after the add test'

    Press $window { param($e) $e.Current.AutomationId -eq 'search' } 'search a real exam'
    $examName = ($navExam.course.name -replace '[（(].*?[)）]', '').Trim()
    Fill $window { param($e) $e.Current.Name -eq '搜索' } "$examName 考试 $($navExam.date)" 'search the exact course and exam date'
    Press $window "$examName 考试" 'open the exam result inside Windows' 45
    Press $window $examName 'open the actual exam tile on the linked day'
    $date = [DateOnly]::ParseExact($navExam.date, 'yyyy-MM-dd')
    $dateSaid = "$($date.Month)月$($date.Day)日"
    Find $window (Is $A::ControlTypeProperty ([System.Windows.Automation.ControlType]::Text)) { param($e) $e.Current.Name.Contains($dateSaid) -and $e.Current.Name.Contains($navExam.start) } 'the exam link preserved its actual day and time' | Out-Null
    Capture 'native-exam-search-link'
    Press $window '关闭' 'close the native exam details'
    Press $window '我的课表' 'return from the course timetable to the personal timetable'
    Alive 'class, teacher, course, preview/add/remove and exam search results remain native'
}


try {
    for ($i = 0; -not ($window = Main) -and $i -lt 120; $i++) { Start-Sleep -Milliseconds 250 }
    if (-not $window) { throw 'the main window never appeared' }
    [Owned]::ResizeForTest([Owned]::Of([uint32]$app.Id, 'StuDev')[0], 600, 880)
    Alive 'open the app'
    if ($RoutesOnly) {
        Press $window 'AI' 'open the saved route links'
        foreach ($case in @(@('楼内位置','1 层 · 教1-101'), @('楼内跨层','2 层 · 教1-201'), @('同一教室','1 层 · 教1-101'))) {
            PressText $window $case[0] 'follow a public route link'
            Find $window (Is $A::NameProperty '同在教1') $null 'same building access presents locations' 30 | Out-Null
            Find $window (Is $A::NameProperty "目的地：$($case[1])") $null 'the requested room remains the destination' | Out-Null
            if ($window.FindFirst($Tree::Descendants, (Both (Is $A::ControlTypeProperty ([System.Windows.Automation.ControlType]::Text)) (Is $A::NameProperty '0 米')))) { throw 'indoor location produced a zero-metre road' }
            Capture $case[0]
            Press $window 'AI' 'return to the same saved route links'
        }
        PressText $window '查看二层' 'follow a floor entity link'
        Press $window '查看楼层' 'open the requested floor'
        Find $window (Is $A::NameProperty '教1 2 层') $null 'the floor link selects floor two' 30 | Out-Null
        Capture 'route-floor'
        Press $window 'AI' 'return to route links'
        PressText $window '错误起点' 'follow an invalid explicit origin'
        Find $window (Is $A::NameProperty '没有找到出发地。') $null 'invalid explicit origin does not use GPS' | Out-Null
        Press $window 'AI' 'return to route links'
        PressText $window '跨楼骑行' 'follow the cycling route'
        Find $window (Is $A::NameProperty '道路路线到教2入口') $null 'road guidance ends at the real entrance' 30 | Out-Null
        Find $window (Is $A::ControlTypeProperty ([System.Windows.Automation.ControlType]::Text)) { param($e) $e.Current.Name -match '^骑行 (?:不到 1|\d+) 分钟 · [1-9]' } 'the URL retains cycling and a positive measured road distance' | Out-Null
        Find $window (Is $A::NameProperty '进入教2后，前往1 层 · 教2-101') $null 'the indoor target follows the measured road leg' | Out-Null
        Capture 'route-entrance'
        Write-Output 'Windows room/building/road routing acceptance passed'
        return
    }
    # The picker asks once the campus data is in, which a first run fetches.
    Find $window (Is $A::NameProperty '你在哪个班？') $null 'the class picker' 90 | Out-Null
    Fill $window $null 'B240402' 'search a class'
    InWindow (Find $window $Editable $null 'the class input') 'the class picker input fits the compact window'
    Capture 'compact-class-picker'
    Press $window 'B240402' 'choose B240402' 30
    foreach ($scale in '周', '学期', '任务', '天') {
        Press $window $scale "the $scale view" 30
        if ($scale -eq '学期') {
            $dates_ = @($window.FindAll($Tree::Descendants, $Pressable) | Where-Object { $_.Current.Name -match '^\d+月\d+日' -and -not $_.Current.IsOffscreen })
            if ($dates_.Count -lt 7) { throw 'the compact term calendar has no visible week' }
            $left_ = ($dates_ | ForEach-Object { $_.Current.BoundingRectangle.Left } | Measure-Object -Minimum).Minimum
            $right_ = ($dates_ | ForEach-Object { $_.Current.BoundingRectangle.Right } | Measure-Object -Maximum).Maximum
            $windowBounds_ = $window.Current.BoundingRectangle
            if ($left_ -lt $windowBounds_.Left -or $right_ -gt $windowBounds_.Right -or $right_ - $left_ -lt $windowBounds_.Width * .7) { throw 'the compact term calendar is clipped or squeezed beside its secondary panel' }
            Capture 'compact-term-calendar'
            Alive 'the compact term calendar has room for all seven weekdays'
        }
        if ($scale -eq '任务') {
            Fill $window { param($e) $e.Current.Name -eq '添加任务' } 'Smoke task' 'type in the compact task input'
            InWindow (Find $window $Editable { param($e) $e.Current.Name -eq '添加任务' } 'the task input') 'the compact task input is fully visible'
            InWindow (Find $window (Both $Pressable (Is $A::NameProperty '添加')) $null 'the add-task action') 'the add-task action fits beside the input'
            Capture 'compact-task-input'
            Fill $window { param($e) $e.Current.Name -eq '添加任务' } '' 'clear the isolated task draft'
        }
    }
    SearchNavigation
    ExamHistory
    ManagedCourses
    [Owned]::ResizeForTest([Owned]::Of([uint32]$app.Id, 'StuDev')[0], 600, 880)
    Press $window '地图' 'the map'
    Find $window (Both $Pressable (Is $A::NameProperty $building.names[0])) { param($e) -not $e.Current.IsOffscreen } 'a real building projected over a rendered map frame' 60 | Out-Null
    MapHealthy
    Alive 'the map, drawn with its released building label'
    Capture 'map-campus'
    Press $window $building.names[0] 'select the building on the map'
    Find $window (Both $Pressable (Is $A::NameProperty '1 层')) $null 'the building floor controls' 30 | Out-Null
    Press $window '1 层' 'open the first floor'
    MapHealthy
    Find $window (Is $A::NameProperty "$($building.names[0]) 1 层") $null 'the selected floor in a narrow window' 30 | Out-Null
    Capture 'map-narrow-floor'
    [Owned]::ResizeForTest([Owned]::Of([uint32]$app.Id, 'StuDev')[0], 1280, 880)
    Find $window (Both $Pressable (Is $A::NameProperty '1 层')) { param($e) -not $e.Current.IsOffscreen } 'the same floor controls after widening the window' 30 | Out-Null
    Capture 'map-wide-floor'
    Alive 'the map and floor controls work in both narrow and wide windows'
    Press $window '去这里' 'navigate to the selected building'
    Fill $window { param($e) $e.Current.Name -eq '出发地' } $origin.names[0] 'choose a route origin by place name'
    $from = Find $window $Editable { param($e) $e.Current.Name -eq '出发地' } 'the route origin'
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $routePanel = $walker.GetParent($from)
    Press $routePanel $origin.names[0] 'select the route origin'
    foreach ($travel in '步行', '骑行') {
        if ($travel -eq '骑行') { Press $window $travel 'switch to a bicycle route' }
        Find $window (Is $A::ControlTypeProperty ([System.Windows.Automation.ControlType]::Text)) { param($e) $e.Current.Name -match "^$travel [1-9][0-9]* 分钟 · ([0-9.]+ 公里|[0-9]+ 米)$" } "a computed $travel duration and distance" 30 | Out-Null
        MapHealthy
        Alive "the $travel route has a distance, duration and guidance"
    }
    Press $window '结束导航' 'finish navigation'
    [Owned]::ResizeForTest([Owned]::Of([uint32]$app.Id, 'StuDev')[0], 600, 880)
    Press $window '搜索' 'the search board'
    Fill $window { param($e) $e.Current.Name -eq '搜索' } '计算机' 'search 计算机'
    Find $window (Is $A::ControlTypeProperty ([System.Windows.Automation.ControlType]::Text)) { param($e) $e.Current.Name -match '条结果' } 'search results (the search kernel)' 30 | Out-Null
    Alive 'search results'
    Fill $window { param($e) $e.Current.Name -eq '搜索' } '' 'browse community without a query'
    Press $window '社区' 'open the shared community search scope'
    $sources = Find $window (Is $A::NameProperty '来源') { param($e) $e.Current.ControlType -eq [System.Windows.Automation.ControlType]::ComboBox } 'the community sources'
    $sources.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand()
    Find $A::RootElement (Is $A::NameProperty '南邮历年资料') { param($e) $e.Current.ProcessId -eq $app.Id } 'the exam archive source has its published name' | Out-Null
    Find $A::RootElement (Is $A::NameProperty '南邮生存手册') { param($e) $e.Current.ProcessId -eq $app.Id } 'the survival guide source has its published name' | Out-Null
    $sources.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Collapse()
    Press $window '知识' 'the knowledge board'
    FilterSheet
    $input = Find $window $Editable { param($e) $e.Current.Name -eq '筛选课程' } 'the course input' 60
    $identity = [string]::Join(',', $input.GetRuntimeId())
    $code = [string]$course.codes[0]
    foreach ($value in @($code.Substring(0, 1), $code.Substring(0, 2), $code.Substring(0, 5), $code, '数据', $course.name, '', $code)) {
        SetValue $input $value
        Start-Sleep -Milliseconds 250
        $current = Find $window $Editable { param($e) $e.Current.Name -eq '筛选课程' } 'the same course input'
        if ([string]::Join(',', $current.GetRuntimeId()) -ne $identity) { throw "course input recreated after '$value'" }
        if ($current.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value -cne $value) { throw "course query changed after '$value'" }
    }
    Alive 'the course input survives incremental typing, replacement and clearing'
    Capture 'knowledge-catalog'
    PressText $window $course.name 'open the course outline'
    PressText $window $topic.title 'open a topic from the outline'
    Find $window (Is $A::NameProperty '关联资料') $null 'the topic references' 30 | Out-Null
    Press $window { param($e) $e.Current.AutomationId -eq "knowledge-reference:$($reference.material)#$($reference.anchor)" } 'open the exact referenced material passage'
    $heading = Find $window (Is $A::ControlTypeProperty ([System.Windows.Automation.ControlType]::Text)) { param($e) $e.Current.Name.Trim() -eq $reference.heading -and -not $e.Current.IsOffscreen } 'the referenced passage scrolled into view' 30
    Alive 'read a linked knowledge passage'
    $count = @($topic.references | Where-Object material -EQ $reference.material).Count
    PressText $window "$($topic.title) · $count 处" 'return through the material topic backlink'
    Find $window (Is $A::NameProperty '关联资料') $null 'the returned topic references' 30 | Out-Null
    Alive 'course to topic to material and back to topic'
    ReferenceGroups
    [Owned]::ResizeForTest([Owned]::Of([uint32]$app.Id, 'StuDev')[0], 1280, 880)
    Press $window 'AI' 'the AI board'
    $traceHeadId = 'ai-steps:ai-replay-message-0'
    $traceHead = Find $window (Is $A::AutomationIdProperty $traceHeadId) $null 'the recorded AI tool calls'
    if ($traceHead.Current.Name -notmatch '读原文') { throw 'the real AI trace summary omits the recorded reads' }
    Press $window { param($e) $e.Current.AutomationId -eq $traceHeadId } 'expand the real AI tool-call record'
    $shownCalls = @($window.FindAll($Tree::Descendants, $Pressable) | Where-Object { $_.Current.AutomationId.StartsWith('ai-call:') })
    if ($shownCalls.Count -ne $traceCalls.Count) { throw "the AI trace shows $($shownCalls.Count) calls instead of all $($traceCalls.Count)" }
    $traceReadId = "ai-call:$($traceRead.id)"
    Press $window { param($e) $e.Current.AutomationId -eq $traceReadId } 'inspect the exact arguments and result of an original-text read'
    $traceBody = Find $window (Is $A::ControlTypeProperty ([System.Windows.Automation.ControlType]::Text)) { param($e) $e.Current.Name.Contains('调用参数') -and $e.Current.Name.Contains('调用结果') } 'the complete AI call details'
    $readArgument = ($traceRead.function.arguments | ConvertFrom-Json).id
    if (-not $traceBody.Current.Name.Contains($readArgument) -or -not $traceBody.Current.Name.Contains('TCP')) { throw 'the AI call details lost their original reference or text result' }
    Capture 'ai-call-details'
    Press $window '关闭' 'close the AI call details'
    Press $window { param($e) $e.Current.AutomationId -eq $traceHeadId } 'collapse the AI tool-call record'
    Alive 'the complete recorded AI calls and their raw JSON details remain inspectable'
    Press $window { param($e) $e.Current.AutomationId -eq 'me' } 'the me board'
    Press $window '成员' 'the public member directory remains inside the app'
    Find $window (Is $A::NameProperty '登录后查看成员') $null 'member browsing asks a visitor to sign in' | Out-Null
    Capture 'members-sign-in'
    Press $window '返回' 'return from members to personal settings'
    Press $window '桌面小组件' 'the widgets sheet'
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
} catch {
    try { Capture 'failure' } catch { }
    throw
} finally {
    if (-not $app.HasExited) { $app.Kill(); $app.WaitForExit(5000) | Out-Null }
    $resolvedHome = (Resolve-Path -LiteralPath $home_).Path
    if (-not $resolvedHome.StartsWith($tempBase + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Unexpected smoke directory: $resolvedHome" }
    if ($KeepData) { Write-Output "Smoke data retained at $resolvedHome" }
    else { Remove-Item -LiteralPath $resolvedHome -Recurse -Force }
}
