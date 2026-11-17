using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using StuDev.Ai;
using StuDev.Data;
using StuDev.Ui;
using StuDev.World;

namespace StuDev.Knowledge;

public sealed partial class KnowledgeScreen : Screen
{
    private readonly Campus campus = Campus.Shared;
    private readonly Grid host = new();
    private Repository? repository;
    private KnowledgeIndex? knowledge;
    private List<CurriculumCourse> curriculum = [];
    private int loadGeneration;
    private int renderGeneration;
    private bool loading;
    private bool failed;

    private string? activeCourse;
    private string? activeTopic;
    private string? activeMaterial;
    private string? activeAnchor;

    private string query = "";
    private string homeView = "list";
    private string categoryFilter = "全部";
    private string natureFilter = "全部";
    private string gradeFilter = "全部";
    private string majorFilter = "";
    private string cohortFilter = "";
    private string relationFocus = "all";
    private string? personalClass;

    public KnowledgeScreen()
    {
        Children.Add(host);
        Paint.Turned += Render;
        personalClass = campus.Preferences.Class;
        campus.Changed += () => DispatcherQueue.TryEnqueue(() => {
            if (!ReferenceEquals(repository, campus.Repository)) _ = Load();
            else if (personalClass != campus.Preferences.Class) { personalClass = campus.Preferences.Class; Render(); }
        });
        _ = Load();
    }

    public override void Shown(object? argument)
    {
        if (!ReferenceEquals(repository, campus.Repository) || knowledge is null && !loading) _ = Load();
        if (argument is string url && url.StartsWith("/knowledge/", StringComparison.Ordinal))
        {
            OpenUrl(url);
            return;
        }
        Render();
    }

    private void OpenUrl(string url)
    {
        var hash = "";
        var main = url;
        var hashAt = url.IndexOf('#');
        if (hashAt >= 0) { hash = Uri.UnescapeDataString(url[(hashAt + 1)..]); main = url[..hashAt]; }
        var qAt = main.IndexOf('?');
        string? c = null, t = null, m = null;
        query = ""; homeView = "list"; categoryFilter = "全部"; natureFilter = "全部"; gradeFilter = "全部";
        majorFilter = ""; cohortFilter = ""; relationFocus = "all";
        if (qAt >= 0)
        {
            foreach (var part in main[(qAt + 1)..].Split('&', StringSplitOptions.RemoveEmptyEntries))
            {
                var eq = part.IndexOf('=');
                if (eq <= 0) continue;
                var k = part[..eq];
                var v = Uri.UnescapeDataString(part[(eq + 1)..].Replace('+', ' '));
                if (k == "course") c = v;
                else if (k == "topic") t = v;
                else if (k == "material") m = v;
                else if (k == "cohort") cohortFilter = v;
                else if (k == "major") majorFilter = v;
                else if (k == "grade") gradeFilter = v;
                else if (k == "category") categoryFilter = v;
                else if (k == "nature") natureFilter = v;
                else if (k == "view") homeView = v == "graph" ? "graph" : "list";
                else if (k == "focus") relationFocus = v;
                else if (k == "q") query = v;
            }
        }
        Open(c, t, m, hash.Length > 0 ? hash : null);
    }

    private void Open(string? course = null, string? topic = null, string? material = null, string? anchor = null)
    {
        activeCourse = course; activeTopic = topic; activeMaterial = material; activeAnchor = anchor;
        Render();
    }

    private async Task Load()
    {
        var repo = campus.Repository;
        if (loading && ReferenceEquals(repository, repo)) return;
        repository = repo;
        var generation = ++loadGeneration;
        knowledge = null; curriculum = [];
        loading = true; failed = false; Render();
        try
        {
            if (repo is null)
            {
                await campus.Load();
                if (generation != loadGeneration) return;
                repository = repo = campus.Repository;
            }
            if (repo is null) { failed = true; return; }
            var kBytes = await repo.Bytes("knowledge/knowledge.json");
            var nextKnowledge = JsonSerializer.Deserialize(kBytes, FactsJson.Default.KnowledgeIndex) ?? throw new JsonException("Empty knowledge index");
            var cBytes = await repo.Bytes("curriculum/courses.json");
            var nextCurriculum = JsonSerializer.Deserialize(cBytes, FactsJson.Default.ListCurriculumCourse) ?? throw new JsonException("Empty curriculum");
            if (generation != loadGeneration || !ReferenceEquals(repo, campus.Repository)) return;
            knowledge = nextKnowledge; curriculum = nextCurriculum;
        }
        catch (Exception error) when (error is HttpRequestException or IOException or JsonException or OperationCanceledException)
        {
            System.Diagnostics.Trace.TraceError("Knowledge release {0}: {1}", repo?.Release.Version, error);
            if (generation == loadGeneration && ReferenceEquals(repo, campus.Repository)) failed = true;
        }
        finally
        {
            if (generation == loadGeneration)
            {
                loading = false;
                if (ReferenceEquals(repo, campus.Repository)) Render();
            }
        }
    }

    private static int ToneOf(string id)
    {
        uint hash = 0;
        foreach (var rune in id.EnumerateRunes()) hash = unchecked(hash * 31u + (uint)rune.Value);
        return (int)(hash % (uint)Paint.ToneCount);
    }

    private static string SafeMermaidLabel(string text)
    {
        var clean = Regex.Replace(text.Replace("\"", "").Replace("[", "").Replace("]", "").Replace("{", "").Replace("}", ""), "[（(][^）)]*[）)]", "").Trim();
        return clean.Length > 0 ? clean : text.Replace("\"", "").Trim();
    }

    private void Render()
    {
        renderGeneration++;
        host.Children.Clear();
        if (failed)
        {
            host.Children.Add(Pages.Frame(Pages.Empty("知识暂时无法加载", Kit.TextAction("重试", () => _ = Load(), Icons.Again))));
            return;
        }
        if (knowledge is null)
        {
            host.Children.Add(Pages.Frame(Pages.Empty("正在打开知识…")));
            return;
        }

        var topic = activeTopic is null ? null : knowledge.Topics.FirstOrDefault(t => t.Id == activeTopic);
        var material = activeMaterial is null ? null : knowledge.Materials.FirstOrDefault(m => m.Path == activeMaterial);
        var cid = activeCourse ?? topic?.TaughtBy.FirstOrDefault() ?? material?.Course;
        var course = cid is null ? null : knowledge.Courses.FirstOrDefault(c => c.Id == cid);

        if (course is null) RenderHome(knowledge);
        else RenderDetail(knowledge, course, topic, material);
    }

    private void RenderHome(KnowledgeIndex idx)
    {
        var byCode = curriculum.ToDictionary(c => c.Code);
        var cohorts = curriculum.SelectMany(c => c.Plans.Select(p => p.Grade)).Distinct().OrderDescending().ToList();
        var person = campus.Classes.FirstOrDefault(item => item.Id == campus.Preferences.Class);
        var planYear = cohorts.Contains(cohortFilter) ? cohortFilter : person?.Grade is { } year && cohorts.Contains(year) ? year : cohorts.FirstOrDefault() ?? "";
        var majorsInPlan = curriculum.SelectMany(course => course.Plans.Where(plan => plan.Grade == planYear).Select(plan => plan.Major)).Distinct().ToList();
        var wantedMajor = majorFilter.Length > 0 ? majorFilter : person?.Major;
        var major = wantedMajor is not null && majorsInPlan.Contains(wantedMajor) ? wantedMajor : "全部专业";
        bool InPlan(CurriculumEntry p) => p.Grade == planYear && (major == "全部专业" || p.Major == major)
            && (categoryFilter == "全部" || p.Category == categoryFilter) && (natureFilter == "全部" || p.Nature == natureFilter);
        var compiledByCode = new Dictionary<string, KnowledgeCourse>();
        foreach (var c in idx.Courses) foreach (var code in c.Codes.Concat(c.Former)) compiledByCode.TryAdd(code, c);

        var metaMap = new Dictionary<string, (List<string> Cats, List<string> Nats, List<string> Majs, string? Cred, List<int> Terms)>();
        foreach (var c in idx.Courses)
        {
            var matched = c.Codes.Concat(c.Former).Select(code => byCode.GetValueOrDefault(code)).Where(m => m is not null).Cast<CurriculumCourse>().DistinctBy(m => m.Code).SelectMany(m => m.Plans).Where(InPlan).ToList();
            metaMap[c.Id] = (
                matched.Select(m => m.Category).Where(s => s.Length > 0).Distinct().ToList(),
                matched.Select(m => m.Nature).Where(s => s.Length > 0).Distinct().ToList(),
                matched.Select(m => m.Major).Where(s => s.Length > 0).Distinct().ToList(),
                matched.Where(m => m.Credits > 0).Select(m => m.Credits!.Value).Distinct().Order().ToList() is { Count: > 0 } credits ? string.Join("/", credits) : null,
                matched.Where(m => m.Term.HasValue).Select(m => m.Term!.Value).Where(t => t is >= 1 and <= 8).Distinct().OrderBy(t => t).ToList()
            );
        }

        var preferredMajors = new[] { "计算机科学与技术", "软件工程", "信息安全", "计算机科学与技术(创新班)" };
        List<string> MajorsFor(string cohortYear)
        {
            var found = curriculum.SelectMany(course => course.Plans.Where(plan => plan.Grade == cohortYear).Select(plan => plan.Major)).Distinct().ToList();
            return ["全部专业", .. preferredMajors.Where(found.Contains), .. found.Where(item => !preferredMajors.Contains(item))];
        }

        var rootCol = new StackPanel { Spacing = 14 };
        var results = new StackPanel { Spacing = 14 };
        rootCol.Children.Add(Pages.Header("知识", ""));

        var topRow = new Grid { ColumnSpacing = 12 };
        topRow.ColumnDefinitions.Add(new ColumnDefinition());
        topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var searchBox = Kit.Field(query, homeView == "graph" ? "搜索课程或代码" : "搜索课程、代码或章节", "筛选课程");
        searchBox.TextChanged += (_, _) => { query = searchBox.Text; RenderResults(); };
        rootCol.Children.Add(Kit.SearchField(searchBox));
        var modeSwitch = Kit.Choice([("list", "课程目录"), ("graph", "课程关系")], homeView, v => { homeView = v; Render(); });
        topRow.Children.Add(modeSwitch);
        var filterButton = Kit.TextAction("筛选", ShowFilters);
        Grid.SetColumn(filterButton, 1); topRow.Children.Add(filterButton);
        rootCol.Children.Add(topRow);
        var filterCount = new[] { gradeFilter, categoryFilter, natureFilter }.Count(value => value != "全部");
        rootCol.Children.Add(Kit.Text($"{planYear}级 · {major}{(filterCount > 0 ? $" · {filterCount}项筛选" : "")}", Role.Caption, "muted", wrap: true));

        void ShowFilters()
        {
            var draftCohort = planYear; var draftMajor = major;
            var draftGrade = gradeFilter; var draftCategory = categoryFilter; var draftNature = natureFilter;
            var inheritCohort = cohortFilter.Length == 0; var inheritMajor = majorFilter.Length == 0;
            var updating = false;
            var body = new StackPanel { Padding = new Thickness(20, 18, 20, 22), Spacing = 14 };
            body.Children.Add(Pages.SheetHead(Pages.SheetTitle("筛选课程"), () => App.Window?.Close()));
            ComboBox Field(string label, List<string> items, string selected)
            {
                var box = new ComboBox { Header = label, ItemsSource = items, SelectedItem = selected, HorizontalAlignment = HorizontalAlignment.Stretch };
                Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(box, label);
                body.Children.Add(box); return box;
            }
            var cohortBox = Field("入学年份", cohorts, draftCohort);
            var majorBox = Field("专业", MajorsFor(draftCohort), draftMajor);
            var gradeBox = Field("学年", ["全部", "大一", "大二", "大三", "大四"], draftGrade);
            var categoryBox = Field("课程类别", ["全部", "专业基础课", "专业课", "通识教育课"], draftCategory);
            var natureBox = Field("修读要求", ["全部", "必修", "限选"], draftNature);
            void UpdateMajors()
            {
                var options = MajorsFor(draftCohort);
                var wanted = inheritMajor ? person?.Major : draftMajor;
                draftMajor = wanted is not null && options.Contains(wanted) ? wanted : "全部专业";
                majorBox.ItemsSource = options; majorBox.SelectedItem = draftMajor;
            }
            cohortBox.SelectionChanged += (_, _) => {
                if (updating || cohortBox.SelectedItem is not string value || value == draftCohort) return;
                draftCohort = value; inheritCohort = false;
                updating = true; UpdateMajors(); updating = false;
            };
            majorBox.SelectionChanged += (_, _) => { if (!updating && majorBox.SelectedItem is string value) { draftMajor = value; inheritMajor = false; } };
            gradeBox.SelectionChanged += (_, _) => { if (!updating && gradeBox.SelectedItem is string value) draftGrade = value; };
            categoryBox.SelectionChanged += (_, _) => { if (!updating && categoryBox.SelectedItem is string value) draftCategory = value; };
            natureBox.SelectionChanged += (_, _) => { if (!updating && natureBox.SelectedItem is string value) draftNature = value; };
            var footer = new Grid { ColumnSpacing = 14, Margin = new Thickness(0, 8, 0, 0) };
            footer.ColumnDefinitions.Add(new ColumnDefinition()); footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var reset = Kit.TextAction("重置", () => {
                updating = true; inheritCohort = true; inheritMajor = true;
                draftCohort = person?.Grade is { } defaultYear && cohorts.Contains(defaultYear) ? defaultYear : cohorts.FirstOrDefault() ?? "";
                cohortBox.SelectedItem = draftCohort; UpdateMajors();
                draftGrade = draftCategory = draftNature = "全部";
                gradeBox.SelectedItem = draftGrade; categoryBox.SelectedItem = draftCategory; natureBox.SelectedItem = draftNature;
                updating = false;
            }, colour: "muted");
            reset.HorizontalAlignment = HorizontalAlignment.Left; footer.Children.Add(reset);
            var actions = Kit.Line(14, Kit.TextAction("取消", () => App.Window?.Close(), colour: "muted"), Kit.Action("应用筛选", () => {
                cohortFilter = inheritCohort ? "" : draftCohort; majorFilter = inheritMajor ? "" : draftMajor;
                gradeFilter = draftGrade; categoryFilter = draftCategory; natureFilter = draftNature;
                relationFocus = "all"; App.Window?.Close(); Render();
            }, go: true));
            Grid.SetColumn(actions, 1); footer.Children.Add(actions); body.Children.Add(footer);
            App.Window?.Sheet(body, 520);
        }

        void RenderResults()
        {
            results.Children.Clear();
            var gradeNum = gradeFilter switch { "大一" => 1, "大二" => 2, "大三" => 3, "大四" => 4, _ => 0 };
            var q = query.Trim().ToLowerInvariant();
            var filtered = idx.Courses.Where(c =>
            {
                var meta = metaMap[c.Id];
                if (categoryFilter != "全部" && !meta.Cats.Contains(categoryFilter)) return false;
                if (natureFilter != "全部" && !meta.Nats.Contains(natureFilter)) return false;
                if (major != "全部专业" && !meta.Majs.Contains(major)) return false;
                if (gradeNum > 0 && !meta.Terms.Any(t => (t + 1) / 2 == gradeNum)) return false;
                if (q.Length == 0) return true;
                return c.Name.ToLowerInvariant().Contains(q)
                    || c.Codes.Any(code => code.ToLowerInvariant().Contains(q))
                    || c.Chapters.Any(ch => ch.Title.ToLowerInvariant().Contains(q));
            }).ToList();

            if (homeView == "graph")
            {
                var selected = curriculum.Where(item => item.Plans.Any(p => InPlan(p) && (gradeNum == 0 || p.Term.HasValue && (p.Term.Value + 1) / 2 == gradeNum))
                    && (q.Length == 0 || item.Name.Contains(q, StringComparison.OrdinalIgnoreCase) || item.Code.Contains(q, StringComparison.OrdinalIgnoreCase))).ToList();
                var selectedCodes = selected.Select(course => course.Code).ToHashSet();
                var edges = curriculum.SelectMany(course => course.Requires.Where(byCode.ContainsKey).Select(code => (From: code, To: course.Code)))
                    .Where(edge => selectedCodes.Contains(edge.From) || selectedCodes.Contains(edge.To)).ToList();
                var connected = edges.SelectMany(edge => new[] { edge.From, edge.To }).ToHashSet();
                var choices = selected.Where(course => connected.Contains(course.Code)).ToList();
                var focus = choices.Any(course => course.Code == relationFocus) ? relationFocus : "all";
                var focusBox = new ComboBox { Header = "查看课程", MinWidth = 220 };
                focusBox.Items.Add(new ComboBoxItem { Content = "全部关系", Tag = "all" });
                foreach (var c in choices) focusBox.Items.Add(new ComboBoxItem { Content = c.Name, Tag = c.Code });
                focusBox.SelectedItem = focusBox.Items.Cast<ComboBoxItem>().First(item => (string)item.Tag == focus);
                focusBox.SelectionChanged += (_, _) => { if (focusBox.SelectedItem is ComboBoxItem { Tag: string code } && code != focus) { relationFocus = code; RenderResults(); } };
                results.Children.Add(focusBox);
                var shown = focus == "all" ? edges : edges.Where(edge => edge.From == focus || edge.To == focus).ToList();
                var nodeSet = shown.SelectMany(edge => new[] { edge.From, edge.To }).ToHashSet();
                var nodes = curriculum.Where(course => nodeSet.Contains(course.Code)).ToList();
                var md = new StringBuilder();
                md.AppendLine("```mermaid");
                md.AppendLine("flowchart LR");
                var idOf = nodes.Select((n, i) => (n.Code, Id: $"P{i}")).ToDictionary(x => x.Code, x => x.Id);
                foreach (var n in nodes) md.AppendLine($"  {idOf[n.Code]}[\"{SafeMermaidLabel(n.Name)}\"]");
                foreach (var edge in shown) md.AppendLine($"  {idOf[edge.From]} --> {idOf[edge.To]}");
                var linkedCourses = nodes.Select(n => compiledByCode.GetValueOrDefault(n.Code)).Where(c => c is not null).Cast<KnowledgeCourse>().DistinctBy(c => c.Id).ToList();
                md.AppendLine("```");

                var card = new Border { Background = Paint.Brush("paper"), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(Paint.Number("radius", "card")), Padding = new Thickness(18) };
                var graphStack = new StackPanel { Spacing = 14 };
                graphStack.Children.Add(Kit.Text("箭头表示作者整理的建议先修顺序，学期安排以培养方案为准。", Role.Caption, "muted", wrap: true));
                graphStack.Children.Add(Doc.Make(Doc.Read(shown.Count > 0 ? md.ToString() : "当前筛选暂无已收录的先修关系。课程仍可在课程目录查看。")));
                if (selected.Any(course => !connected.Contains(course.Code)) && shown.Count > 0) graphStack.Children.Add(Kit.Text("仅显示已收录的关系，未连线课程仍可在课程目录查看。", Role.Caption, "muted", wrap: true));
                if (linkedCourses.Count > 0)
                {
                    graphStack.Children.Add(Kit.Hairline());
                    graphStack.Children.Add(Kit.Text("查看课程内容", Role.Caption, "muted"));
                    var pills = new WrapRow { Gap = 8 };
                    foreach (var c in linkedCourses)
                    {
                        var t = ToneOf(c.Id);
                        var pill = new Tap(Paint.Tone(t, "bg"), Paint.ToneFaded(t, "bg", .85))
                        {
                            MinHeight = 32, CornerRadius = Kit.Capsule(32), BorderBrush = Paint.Tone(t, "border"), BorderThickness = new Thickness(1),
                            Padding = new Thickness(11, 5, 11, 5), Content = Kit.Text(c.Name, Role.Label),
                        };
                        ((TextBlock)pill.Content).Foreground = Paint.Tone(t, "fg");
                        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(pill, c.Name);
                        pill.Click += (_, _) => Open(course: c.Id);
                        pills.Children.Add(pill);
                    }
                    graphStack.Children.Add(pills);
                }
                var planned = nodes.Where(node => !compiledByCode.ContainsKey(node.Code)).ToList();
                if (planned.Count > 0)
                {
                    var unavailable = new Expander { Header = $"{planned.Count} 门课程暂未收录内容", Content = Kit.Text(string.Join("、", planned.Select(node => node.Name)), Role.Label, "muted", wrap: true), HorizontalAlignment = HorizontalAlignment.Stretch };
                    graphStack.Children.Add(unavailable);
                }
                card.Child = graphStack;
                results.Children.Add(card);
            }
            else
            {
                var termTitles = new[] { "", "大一上", "大一下", "大二上", "大二下", "大三上", "大三下", "大四上", "大四下" };
                var grouped = filtered.SelectMany(c => {
                    var terms = metaMap[c.Id].Terms.Where(t => gradeNum == 0 || (t + 1) / 2 == gradeNum).ToList();
                    return (terms.Count > 0 ? terms : [99]).Select(term => (Term: term, Course: c));
                }).GroupBy(item => item.Term, item => item.Course).OrderBy(g => g.Key).ToList();

                if (grouped.Count == 0) results.Children.Add(Pages.Empty("没有符合当前筛选条件的课程"));
                foreach (var group in grouped)
                {
                    var termTitle = group.Key is >= 1 and <= 8 ? termTitles[group.Key] : "其他与通识课程";
                    var termSub = group.Key is >= 1 and <= 8 ? $"第 {group.Key} 学期 · {group.Count()} 门" : $"{group.Count()} 门";
                    var head = new Grid { Padding = new Thickness(0, 8, 0, 4), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(0, 0, 0, 1) };
                    head.ColumnDefinitions.Add(new ColumnDefinition()); head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                    var hTitle = Kit.Text(termTitle, Role.Heading); hTitle.FontSize = 17; head.Children.Add(hTitle);
                    var hSub = Kit.Text(termSub, Role.Caption, "muted"); hSub.VerticalAlignment = VerticalAlignment.Bottom; Grid.SetColumn(hSub, 1); head.Children.Add(hSub);
                    results.Children.Add(head);

                    var grid = new WrapRow { Gap = 12 };
                    foreach (var c in group)
                    {
                        var t = ToneOf(c.Id);
                        var topicsCount = c.chaptersCountTopics(out var chCount);
                        var matsCount = idx.Materials.Count(m => m.Course == c.Id);
                        var meta = metaMap[c.Id];
                        var codeLabel = c.Codes.Count > 1 ? $"{c.Codes[0]} +{c.Codes.Count - 1}" : c.Codes.FirstOrDefault() ?? "培养方案课程";
                        var sub = string.Join(" · ", new[] { codeLabel, meta.Cats.FirstOrDefault(), meta.Nats.Count > 0 ? string.Join("/", meta.Nats) : null, meta.Cred is { } cr ? $"{cr} 学分" : null }.Where(s => !string.IsNullOrEmpty(s)));
                        var stack = new StackPanel { Spacing = 4, Width = 310 };
                        var title = Kit.Text(c.Name, Role.Body, bold: true); title.Foreground = Paint.Tone(t, "fg");
                        stack.Children.Add(title);
                        stack.Children.Add(Kit.Text(sub, Role.Caption, "muted", wrap: true));
                        stack.Children.Add(Kit.Text($"{chCount} 章 · {topicsCount} 个知识点 · {matsCount} 份资料", Role.Caption, "muted"));
                        var tap = new Tap(Paint.Brush("paper"), Paint.Brush("surfaceSunken"))
                        {
                            CornerRadius = new CornerRadius(Paint.Number("radius", "card")), BorderBrush = Paint.Tone(t, "border"), BorderThickness = new Thickness(4, 1, 1, 1),
                            Padding = new Thickness(16, 14, 16, 14), Content = stack,
                        };
                        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(tap, c.Name);
                        tap.Click += (_, _) => Open(course: c.Id);
                        grid.Children.Add(tap);
                    }
                    results.Children.Add(grid);
                }
            }
        }

        rootCol.Children.Add(results);
        RenderResults();
        host.Children.Add(Pages.Frame(rootCol, 1160));
    }

    private void RenderDetail(KnowledgeIndex idx, KnowledgeCourse course, KnowledgeTopic? topic, KnowledgeMaterial? material)
    {
        var t = ToneOf(course.Id);
        var courseHome = topic is null && material is null;
        var layout = new Grid { MaxWidth = 1440, HorizontalAlignment = HorizontalAlignment.Stretch, ColumnSpacing = 28, Padding = new Thickness(24, 16, 24, 32) };
        var outlineColumn = courseHome ? null : new ColumnDefinition { Width = new GridLength(250) };
        if (outlineColumn is not null) layout.ColumnDefinitions.Add(outlineColumn);
        layout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star), MaxWidth = 780 });
        var relatedColumn = new ColumnDefinition { Width = new GridLength(260) };
        layout.ColumnDefinitions.Add(relatedColumn);
        var courseMats = idx.Materials.Where(m => m.Course == course.idOrEmpty()).ToList();

        // The same course tree is a sidebar where it fits, or opened from the course name while reading.
        StackPanel Outline(bool inSheet = false)
        {
            void Navigate(Action open) { if (inSheet) App.Window?.Close(); open(); }
            var tree = new StackPanel { Spacing = 12 };
            var courseHead = new Tap(courseHome ? Paint.Tone(t, "bg") : Paint.Clear, Paint.Brush("surface")) { CornerRadius = new CornerRadius(6), Padding = new Thickness(10, 7, 10, 7) };
            var courseTitle = Kit.Text(course.Name, Role.Body, bold: true); courseTitle.Foreground = Paint.Tone(t, "fg");
            courseHead.Content = courseTitle;
            courseHead.Click += (_, _) => Navigate(() => Open(course: course.Id));
            tree.Children.Add(courseHead);

            foreach (var ch in course.Chapters)
            {
                var sec = new StackPanel { Spacing = 2 };
                var chHead = Kit.Text(ch.Title, Role.Caption); chHead.Foreground = Paint.Tone(t, "fg");
                sec.Children.Add(chHead);
                foreach (var tid in ch.Topics)
                {
                    var label = idx.Topics.FirstOrDefault(x => x.Id == tid)?.Title ?? tid;
                    var on = topic?.Id == tid;
                    var btn = new Tap(on ? Paint.Tone(t, "bg") : Paint.Clear, Paint.Brush("surface")) { CornerRadius = new CornerRadius(6), Padding = new Thickness(8, 5, 8, 5) };
                    var tb = Kit.Text(label, Role.Label, bold: on, wrap: true); if (on) tb.Foreground = Paint.Tone(t, "fg");
                    btn.Content = tb;
                    btn.Click += (_, _) => Navigate(() => Open(course: course.Id, topic: tid));
                    sec.Children.Add(btn);
                }
                tree.Children.Add(sec);
            }
            if (courseMats.Count > 0)
            {
                var msec = new StackPanel { Spacing = 2 };
                var mHead = Kit.Text("资料", Role.Caption); mHead.Foreground = Paint.Tone(t, "fg");
                msec.Children.Add(mHead);
                foreach (var m in courseMats)
                {
                    var on = material?.Path == m.Path;
                    var btn = new Tap(on ? Paint.Tone(t, "bg") : Paint.Clear, Paint.Brush("surface")) { CornerRadius = new CornerRadius(6), Padding = new Thickness(8, 5, 8, 5) };
                    var tb = Kit.Text(m.Title, Role.Label, bold: on, wrap: true); if (on) tb.Foreground = Paint.Tone(t, "fg");
                    btn.Content = tb;
                    btn.Click += (_, _) => Navigate(() => Open(course: course.Id, material: m.Path));
                    msec.Children.Add(btn);
                }
                tree.Children.Add(msec);
            }
            return tree;
        }
        var leftScroll = new ScrollViewer { Content = courseHome ? null : Outline(), VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollMode = ScrollMode.Disabled };
        if (topic is not null || material is not null) layout.Children.Add(leftScroll);

        // Middle: Main content + below tested questions
        var midStack = new StackPanel { Spacing = 14 };
        var backBtn = Kit.TextAction("知识", () => Open(), Icons.Back);
        backBtn.HorizontalAlignment = HorizontalAlignment.Left;
        var detailHead = new Grid { ColumnSpacing = 12 };
        detailHead.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        detailHead.ColumnDefinitions.Add(new ColumnDefinition());
        detailHead.Children.Add(backBtn);
        var outlineWords = Kit.Text(course.Name, Role.Label, bold: true); outlineWords.Foreground = Paint.Tone(t, "fg");
        var outlineContent = new Grid { ColumnSpacing = 5, VerticalAlignment = VerticalAlignment.Center };
        outlineContent.ColumnDefinitions.Add(new ColumnDefinition()); outlineContent.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        outlineContent.Children.Add(outlineWords);
        var arrow = Kit.Icon("M3.5,6 L8,10.5 L12.5,6", 14, "muted"); arrow.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(arrow, 1); outlineContent.Children.Add(arrow);
        var outlineButton = new Tap(Paint.Clear, Paint.Brush("surfaceSunken")) { Content = outlineContent, MinHeight = Paint.Number("size", "control"), CornerRadius = Kit.Capsule(Paint.Number("size", "control")), Padding = new Thickness(8, 4, 8, 4), HorizontalAlignment = HorizontalAlignment.Left, Visibility = Visibility.Collapsed };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(outlineButton, $"{course.Name}，课程目录");
        outlineButton.Click += (_, _) => {
            var body = new StackPanel { Padding = new Thickness(20, 18, 20, 22), Spacing = 14 };
            body.Children.Add(Pages.SheetHead(Pages.SheetTitle(course.Name), () => App.Window?.Close()));
            body.Children.Add(Outline(inSheet: true));
            App.Window?.Sheet(body, Math.Min(520, Math.Max(280, host.ActualWidth - 32)));
        };
        Grid.SetColumn(outlineButton, 1); detailHead.Children.Add(outlineButton);
        midStack.Children.Add(detailHead);

        var contentHost = new StackPanel { Spacing = 14 };
        midStack.Children.Add(contentHost);
        var relPath = topic?.Path ?? material?.Path ?? course.Path;
        _ = LoadDocument(contentHost, idx, course, topic, material, relPath, t);
        var midScroll = new ScrollViewer { Content = midStack, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollMode = ScrollMode.Disabled };
        Grid.SetColumn(midScroll, courseHome ? 0 : 1);
        layout.Children.Add(midScroll);

        // Right: Knowledge graph relations (or material/course sidebar)
        var rightStack = new StackPanel { Spacing = 16 };
        if (topic is not null)
        {
            if (topic.Requires.Count > 0 || topic.LeadsTo.Count > 0)
            {
                var mini = new StringBuilder();
                mini.AppendLine("```mermaid");
                mini.AppendLine("flowchart TB");
                mini.AppendLine($"  CUR[\"{SafeMermaidLabel(topic.Title)}\"]");
                for (var i = 0; i < Math.Min(5, topic.Requires.Count); i++)
                {
                    var rt = idx.Topics.FirstOrDefault(x => x.Id == topic.Requires[i])?.Title ?? topic.Requires[i];
                    mini.AppendLine($"  R{i}[\"{SafeMermaidLabel(rt)}\"]");
                    mini.AppendLine($"  R{i} --> CUR");
                }
                for (var i = 0; i < Math.Min(5, topic.LeadsTo.Count); i++)
                {
                    var lt = idx.Topics.FirstOrDefault(x => x.Id == topic.LeadsTo[i])?.Title ?? topic.LeadsTo[i];
                    mini.AppendLine($"  L{i}[\"{SafeMermaidLabel(lt)}\"]");
                    mini.AppendLine($"  CUR --> L{i}");
                }
                mini.AppendLine("```");
                var rHead = Kit.Text("相关知识点", Role.Caption); rHead.Foreground = Paint.Tone(t, "fg");
                rightStack.Children.Add(rHead);
                var gCard = new Border { Background = Paint.Brush("paper"), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(Paint.Number("radius", "card")), Padding = new Thickness(8) };
                gCard.Child = Doc.Make(Doc.Read(mini.ToString()));
                rightStack.Children.Add(gCard);
            }
            void Related(string label, List<string> ids)
            {
                if (ids.Count == 0) return;
                var section = new StackPanel { Spacing = 3 };
                var heading = Kit.Text(label, Role.Caption); heading.Foreground = Paint.Tone(t, "fg"); section.Children.Add(heading);
                var links = new StackPanel(); section.Children.Add(links);
                var expanded = false;
                Tap? toggle = null;
                void DrawLinks()
                {
                    links.Children.Clear();
                    foreach (var id in expanded ? ids : ids.Take(5)) links.Children.Add(RelLink(idx.Topics.FirstOrDefault(x => x.Id == id)?.Title ?? id, () => Open(course: course.Id, topic: id)));
                    if (toggle is not null) {
                        var label = expanded ? "收起" : $"展开全部 {ids.Count} 个";
                        toggle.Content = Kit.Text(label, Role.Label);
                        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(toggle, label);
                    }
                }
                if (ids.Count > 5) { toggle = Kit.Button($"展开全部 {ids.Count} 个", () => { expanded = !expanded; DrawLinks(); }); toggle.HorizontalAlignment = HorizontalAlignment.Left; section.Children.Add(toggle); }
                DrawLinks(); rightStack.Children.Add(section);
            }
            Related("先要懂", topic.Requires);
            Related("用到它的", topic.LeadsTo);
            if (topic.Requires.Count == 0 && topic.LeadsTo.Count == 0)
            {
                var rHead = Kit.Text("相关知识点", Role.Caption); rHead.Foreground = Paint.Tone(t, "fg");
                rightStack.Children.Add(rHead);
                rightStack.Children.Add(Kit.Text("暂未收录相关知识点", Role.Label, "muted"));
            }
        }
        else if (material is not null)
        {
            var rHead = Kit.Text("这份资料关联的知识点", Role.Caption); rHead.Foreground = Paint.Tone(t, "fg");
            rightStack.Children.Add(rHead);
            var counts = idx.Topics.Select(tp => (Topic: tp, N: tp.References.Count(r => r.Material == material.Path))).Where(x => x.N > 0).OrderByDescending(x => x.N).ToList();
            foreach (var (tp, n) in counts) rightStack.Children.Add(RelLink($"{tp.Title} · {n} 处", () => Open(course: course.Id, topic: tp.Id)));
        }
        else
        {
            var rHead = Kit.Text("资料", Role.Caption); rHead.Foreground = Paint.Tone(t, "fg");
            rightStack.Children.Add(rHead);
            foreach (var m in courseMats) rightStack.Children.Add(RelLink($"{m.Title} ({(m.Sections > 0 ? $"{m.Sections} 处关联" : m.Kind)})", () => Open(course: course.Id, material: m.Path)));
        }
        var rightScroll = new ScrollViewer { Content = rightStack, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollMode = ScrollMode.Disabled };
        Grid.SetColumn(rightScroll, courseHome ? 1 : 2);
        layout.Children.Add(rightScroll);

        // Fixed sidebars must never consume the document's reading width. Resizing moves
        // related knowledge below the same document without rebuilding it or its anchor scroller.
        var detailHost = new Grid(); detailHost.Children.Add(layout);
        var relatedDivider = Kit.Hairline();
        bool? compactLayout = null;
        void Reflow(double width)
        {
            var compact = width < (courseHome ? 900 : 1100);
            if (compactLayout == compact) return;
            compactLayout = compact;
            layout.MaxWidth = compact ? 828 : 1440;
            layout.ColumnSpacing = compact ? 0 : 28;
            if (outlineColumn is not null) outlineColumn.Width = new GridLength(compact ? 0 : 250);
            relatedColumn.Width = new GridLength(compact ? 0 : 260);
            leftScroll.Visibility = compact ? Visibility.Collapsed : Visibility.Visible;
            rightScroll.Visibility = compact ? Visibility.Collapsed : Visibility.Visible;
            outlineButton.Visibility = compact && !courseHome ? Visibility.Visible : Visibility.Collapsed;
            if (compact)
            {
                rightScroll.Content = null;
                midStack.Children.Add(relatedDivider);
                midStack.Children.Add(rightStack);
            }
            else
            {
                midStack.Children.Remove(rightStack);
                midStack.Children.Remove(relatedDivider);
                rightScroll.Content = rightStack;
            }
        }
        detailHost.SizeChanged += (_, e) => Reflow(e.NewSize.Width);
        detailHost.Loaded += (_, _) => Reflow(detailHost.ActualWidth);
        host.Children.Add(detailHost);
    }

    private static Tap RelLink(string label, Action act)
    {
        var tap = new Tap(Paint.Clear, Paint.Brush("surface")) { CornerRadius = new CornerRadius(6), Padding = new Thickness(8, 5, 8, 5), Content = Kit.Text(label, Role.Label, wrap: true) };
        tap.Click += (_, _) => act();
        return tap;
    }

    private sealed class ReferencePreview(string title, string context)
    {
        public string Title { get; } = title;
        public string Context { get; } = context;
        public string Excerpt { get; set; } = "";
    }

    private static Dictionary<string, ReferencePreview> ReferencePreviews(List<JsonObject> blocks)
    {
        static string Plain(JsonArray? inlines) => inlines is null ? "" : string.Concat(inlines.Select(inline => inline is null ? "" :
            (string?)inline["type"] is "text" or "code" ? (string?)inline["text"] ?? "" : (string?)inline["type"] == "math" ? (string?)inline["tex"] ?? "" : Plain(inline["children"] as JsonArray)));
        var found = new Dictionary<string, ReferencePreview>();
        var headings = new List<(int Level, string Title)>();
        ReferencePreview? current = null;
        foreach (var keyed in blocks)
        {
            if (keyed["block"] is not JsonObject block) continue;
            if ((string?)block["type"] == "heading")
            {
                var level = (int?)block["level"] ?? 1;
                while (headings.Count > 0 && headings[^1].Level >= level) headings.RemoveAt(headings.Count - 1);
                var title = Plain(block["inlines"] as JsonArray);
                current = new(title, string.Join(" › ", headings.Where(heading => heading.Level > 1).Select(heading => heading.Title)));
                found[(string)block["anchor"]!] = current;
                headings.Add((level, title));
            }
            else if ((string?)block["type"] == "paragraph" && current is { Excerpt.Length: 0 })
            {
                var text = Plain(block["inlines"] as JsonArray).Trim();
                if (Regex.IsMatch(text, "^(?:答案|参考解答|订正|补充|知识点)(?:[：:（(]|$)")) current = null;
                else if (text.Length > 0)
                {
                    text = Regex.Replace(text, "^题干[：:]\\s*", "");
                    current.Excerpt = text[..Math.Min(160, text.Length)];
                }
            }
        }
        return found;
    }

    private UIElement ReferenceGroup(Repository repo, string path, List<MaterialRef> refs, string title, string course, int tone, Func<bool> current)
    {
        var group = new StackPanel { Spacing = 6 };
        var header = new Grid { ColumnSpacing = 12 };
        header.ColumnDefinitions.Add(new ColumnDefinition()); header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.Children.Add(Kit.Text(title, Role.Label, bold: true, wrap: true));
        var count = Kit.Text($"{refs.Count} 处", Role.Caption, "muted"); Grid.SetColumn(count, 1); header.Children.Add(count);
        group.Children.Add(header);
        var previewStatus = new StackPanel { Spacing = 4 }; group.Children.Add(previewStatus);
        var rows = new StackPanel { Spacing = 2 };
        group.Children.Add(rows);
        var expanded = false;
        var previews = new Dictionary<string, ReferencePreview>();
        Tap? toggle = null;
        void DrawRows()
        {
            rows.Children.Clear();
            foreach (var reference in expanded ? refs : refs.Take(3))
            {
                previews.TryGetValue(reference.Anchor, out var preview);
                var name = preview is null ? reference.Heading : string.Join(" · ", new[] { preview.Context, preview.Title }.Where(value => value.Length > 0));
                var content = new StackPanel { Spacing = 4 };
                var heading = Kit.Text(name, Role.Label, wrap: true); heading.Foreground = Paint.Tone(tone, "fg"); content.Children.Add(heading);
                if (preview?.Excerpt is { Length: > 0 } excerpt) content.Children.Add(Kit.Text(excerpt, Role.Caption, "muted", wrap: true));
                var row = new Tap(Paint.Clear, Paint.Brush("surface")) { Padding = new Thickness(8, 8, 8, 8), CornerRadius = new CornerRadius(6), Content = content };
                Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(row, $"{name}{(preview?.Excerpt is { Length: > 0 } brief ? $" · {brief}" : "")}");
                Microsoft.UI.Xaml.Automation.AutomationProperties.SetAutomationId(row, $"knowledge-reference:{path}#{reference.Anchor}");
                row.Click += (_, _) => Open(course: course, material: path, anchor: reference.Anchor);
                rows.Children.Add(row);
            }
            if (toggle is not null) {
                var label = expanded ? "收起" : $"展开全部 {refs.Count} 处";
                toggle.Content = Kit.Text(label, Role.Label);
                Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(toggle, label);
            }
        }
        if (refs.Count > 3)
        {
            toggle = Kit.Button($"展开全部 {refs.Count} 处", () => { expanded = !expanded; DrawRows(); });
            toggle.HorizontalAlignment = HorizontalAlignment.Left; group.Children.Insert(1, toggle);
        }
        DrawRows();
        _ = LoadPreviews();
        async Task LoadPreviews()
        {
            previewStatus.Children.Clear();
            try
            {
                var text = Encoding.UTF8.GetString(await repo.Bytes($"knowledge/{path}"));
                if (!current()) return;
                previews = ReferencePreviews(Doc.Read(text));
                DrawRows();
            }
            catch (Exception error) when (error is HttpRequestException or IOException or OperationCanceledException) {
                if (!current()) return;
                System.Diagnostics.Trace.TraceError("Knowledge preview {0}: {1}", path, error);
                previewStatus.Children.Add(Kit.Text("题干预览暂时无法加载", Role.Caption, "muted"));
                previewStatus.Children.Add(Kit.TextAction("重试", () => _ = LoadPreviews(), Icons.Again));
            }
        }
        return group;
    }

    private async Task LoadDocument(StackPanel container, KnowledgeIndex idx, KnowledgeCourse course, KnowledgeTopic? topic, KnowledgeMaterial? material, string relPath, int toneIdx)
    {
        var documentTitle = topic?.Title ?? material?.Title ?? course.Name;
        container.Children.Add(Kit.Text(documentTitle, Role.Title, bold: true));
        container.Children.Add(Kit.Text("正在打开…", Role.Body, "muted"));
        var repo = repository;
        var generation = renderGeneration;
        var documentAnchor = activeAnchor;
        bool Current() => generation == renderGeneration && ReferenceEquals(repo, campus.Repository) && ReferenceEquals(idx, knowledge);
        if (repo is null || !Current()) return;
        string md;
        try { md = Encoding.UTF8.GetString(await repo.Bytes($"knowledge/{relPath}")); }
        catch (Exception error) when (error is HttpRequestException or IOException or OperationCanceledException)
        {
            if (Current()) { container.Children.Clear(); container.Children.Add(Kit.Text(documentTitle, Role.Title, bold: true)); container.Children.Add(Kit.Text("内容暂时无法加载", Role.Body, "muted")); container.Children.Add(Kit.TextAction("重试", () => { container.Children.Clear(); _ = LoadDocument(container, idx, course, topic, material, relPath, toneIdx); }, Icons.Again)); }
            return;
        }
        if (!Current()) return;

        container.Children.Clear();
        Action<string> onLink = href =>
        {
            var raw = href.Split('#')[0];
            var decoded = Uri.UnescapeDataString(raw);
            var anchor = href.Contains('#') ? Uri.UnescapeDataString(href.Split('#', 2)[1]) : null;
            if (decoded.StartsWith("topics/") && decoded.EndsWith(".md")) Open(course: course.Id, topic: decoded["topics/".Length..^3]);
            else if (decoded.StartsWith("courses/") && decoded.EndsWith(".md")) Open(course: decoded["courses/".Length..^3]);
            else if (decoded.StartsWith("materials/") && decoded.EndsWith(".md")) Open(course: course.Id, material: decoded, anchor: anchor);
        };
        // Pictures are named by full address on the knowledge's own static hosts.
        Func<string, Task<byte[]?>> imgLoader = src => Repository.Media(src, idx.Media);

        var blocks = Doc.Read(md);
        if (topic is not null)
        {
            var matCount = topic.References.Select(r => r.Material).Distinct().Count();
            var info = Kit.Text(topic.References.Count > 0 ? $"关联 {topic.References.Count} 处 · 出现在 {matCount} 份资料里" : "收录的资料里还没有与它关联的片段", Role.Label);
            info.Foreground = Paint.Tone(toneIdx, "fg");
            container.Children.Add(info);
            container.Children.Add(Doc.Make(blocks, link: onLink, image: imgLoader));

            // Below middle explanation: tested past-exam question links
            container.Children.Add(Kit.Hairline());
            var qHead = Kit.Text("关联资料", Role.Heading); qHead.Foreground = Paint.Tone(toneIdx, "fg");
            container.Children.Add(qHead);
            var byMat = topic.References.GroupBy(r => r.Material).ToList();
            if (byMat.Count == 0)
            {
                container.Children.Add(Kit.Text("收录的资料里还没有与它关联的片段。", Role.Label, "muted"));
            }
            else
            {
                foreach (var g in byMat)
                {
                    var matTitle = idx.Materials.FirstOrDefault(m => m.Path == g.Key)?.Title ?? "课程资料";
                    container.Children.Add(ReferenceGroup(repo, g.Key, g.ToList(), matTitle, course.Id, toneIdx, Current));
                }
            }
        }
        else if (material is not null)
        {
            container.Children.Add(Kit.Text(string.Join(" · ", new[] { material.Kind, material.Term, material.Sections > 0 ? $"{material.Sections} 处关联" : null }.Where(s => !string.IsNullOrEmpty(s))), Role.Label, "muted"));
            container.Children.Add(Doc.Make(blocks, link: onLink, image: imgLoader, anchor: documentAnchor));
        }
        else
        {
            container.Children.Add(Doc.Make(blocks, link: onLink, image: imgLoader));
            var most = course.Chapters.SelectMany(ch => ch.Topics).Select(id => idx.Topics.FirstOrDefault(x => x.Id == id)).Where(x => x is not null && x.References.Count > 0).Cast<KnowledgeTopic>().OrderByDescending(x => x.References.Count).Take(6).ToList();
            if (most.Count > 0)
            {
                container.Children.Add(Kit.Hairline());
                container.Children.Add(Kit.Text("资料中的知识点", Role.Heading));
                foreach (var mt in most)
                {
                    var btn = RelLink($"{mt.Title}（{mt.References.Count} 处 · {mt.References.Select(r => r.Material).Distinct().Count()} 份资料）", () => Open(course: course.Id, topic: mt.Id));
                    container.Children.Add(btn);
                }
            }
        }
    }
}

internal static class KnowledgeExtensions
{
    public static int chaptersCountTopics(this KnowledgeCourse c, out int chapters)
    {
        chapters = c.Chapters.Count;
        return c.Chapters.SelectMany(ch => ch.Topics).Distinct().Count();
    }
    public static string idOrEmpty(this KnowledgeCourse c) => c.Id;
}
