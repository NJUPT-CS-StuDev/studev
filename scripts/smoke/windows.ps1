# The Windows app as it ships, opened and used before it is released, in a home of its own so no one's records are
# touched: a class chosen, the four boards, a search, and a desktop widget opened on one of its lessons. After every
# step the app must still be running and must not have written a crash log. Usage: pwsh windows.ps1 -Exe <StuDev.exe>
param([Parameter(Mandatory)] [string]$Exe, [switch]$KeepData, [switch]$Online)
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
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public static class Owned {
    [StructLayout(LayoutKind.Sequential)] public struct Bounds { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Bounds bounds);
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
$traceSeed = @{ current = 'ai-replay'; chats = @(@{ id = 'ai-replay'; title = ''; updated = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); proposals = @(); thread = @{ nodes = $traceNodes; chosen = $traceChosen } }) }
New-Item -ItemType Directory -Path (Join-Path $home_ 'ai') -Force | Out-Null
$traceSeed | ConvertTo-Json -Depth 50 -Compress | Set-Content -LiteralPath (Join-Path $home_ 'ai/chats.json') -Encoding utf8NoBOM
# Before publication, exercise the exact compiled release through the normal offline cache.
# The isolated home is populated as a device that already fetched this release; app code has no test reader.
if (-not $Online) {
    $cacheRoot = Join-Path $home_ 'cache/campus'
    New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $repo "public/data/$($release.version)") -Destination $cacheRoot -Recurse
    Copy-Item -LiteralPath (Join-Path $repo 'src/data/campus-release.json') -Destination (Join-Path $cacheRoot "release-$($product.android.versionName).json")
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
function Fill($root, [scriptblock]$match, [string]$text, [string]$step) {
    $e = Find $root $Editable $match $step
    $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($text)
    Start-Sleep -Milliseconds 1200
    if ($e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value -cne $text) { throw "the input changed during: $step" }
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


try {
    for ($i = 0; -not ($window = Main) -and $i -lt 120; $i++) { Start-Sleep -Milliseconds 250 }
    if (-not $window) { throw 'the main window never appeared' }
    Alive 'open the app'
    # The picker asks once the campus data is in, which a first run fetches.
    Find $window (Is $A::NameProperty '你在哪个班？') $null 'the class picker' 90 | Out-Null
    Fill $window $null 'B240402' 'search a class'
    Press $window 'B240402' 'choose B240402' 30
    foreach ($scale in '周', '学期', '任务', '天') { Press $window $scale "the $scale view" 30 }
    ManagedCourses
    Press $window '地图' 'the map'
    Find $window (Both $Pressable (Is $A::NameProperty $building.names[0])) { param($e) -not $e.Current.IsOffscreen } 'a real building projected over a rendered map frame' 60 | Out-Null
    MapHealthy
    Alive 'the map, drawn with its released building label'
    Capture 'map-campus'
    Press $window $building.names[0] 'select the building on the map'
    Find $window (Both $Pressable (Is $A::NameProperty '1 层')) $null 'the building floor controls' 30 | Out-Null
    Press $window '1 层' 'open the first floor'
    MapHealthy
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
    Press $window '搜索' 'the search board'
    Fill $window { param($e) $e.Current.Name -eq '搜索' } '计算机' 'search 计算机'
    Find $window (Is $A::ControlTypeProperty ([System.Windows.Automation.ControlType]::Text)) { param($e) $e.Current.Name -match '条结果' } 'search results (the search kernel)' 30 | Out-Null
    Alive 'search results'
    Press $window '知识' 'the knowledge board'
    FilterSheet
    $input = Find $window $Editable { param($e) $e.Current.Name -eq '筛选课程' } 'the course input' 60
    $identity = [string]::Join(',', $input.GetRuntimeId())
    $code = [string]$course.codes[0]
    foreach ($value in @($code.Substring(0, 1), $code.Substring(0, 2), $code.Substring(0, 5), $code, '数据', $course.name, '', $code)) {
        $input.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($value)
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
