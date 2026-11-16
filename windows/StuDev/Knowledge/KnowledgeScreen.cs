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
    private string majorFilter = "全部专业";
    private string cohortFilter = "";

    public KnowledgeScreen()
    {
        Children.Add(host);
        Paint.Turned += Render;
        campus.Changed += () => DispatcherQueue.TryEnqueue(() => { if (!ReferenceEquals(repository, campus.Repository)) _ = Load(); });
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
            host.Children.Add(Pages.Frame(Pages.Empty("知识暂时无法加载", Kit.Action("重试", () => _ = Load(), go: true))));
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
        var planYear = cohortFilter.Length > 0 ? cohortFilter : cohorts.FirstOrDefault() ?? "";
        bool InPlan(CurriculumEntry p) => p.Grade == planYear && (majorFilter == "全部专业" || p.Major == majorFilter)
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
        var allMajors = new List<string> { "全部专业" };
        var foundMajors = curriculum.SelectMany(c => c.Plans.Select(p => p.Major)).Distinct().ToList();
        allMajors.AddRange(preferredMajors.Where(foundMajors.Contains));
        allMajors.AddRange(foundMajors.Where(m => !preferredMajors.Contains(m)));

        var rootCol = new StackPanel { Spacing = 14 };
        var results = new StackPanel { Spacing = 14 };
        rootCol.Children.Add(Pages.Header("知识", "按培养方案与学期组织的知识体系，每门课连着先修依赖、课程资料。"));

        var topRow = new Grid { ColumnSpacing = 12 };
        topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star), MaxWidth = 380 });
        topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var searchBox = Kit.Field(query, "筛选课程名称、课程代码或章节…", "筛选课程");
        searchBox.TextChanged += (_, _) => { query = searchBox.Text; RenderResults(); };
        topRow.Children.Add(searchBox);
        var modeSwitch = Kit.Choice([("list", "按学期看"), ("graph", "培养方案依赖图")], homeView, v => { homeView = v; Render(); });
        Grid.SetColumn(modeSwitch, 1);
        topRow.Children.Add(modeSwitch);
        rootCol.Children.Add(topRow);

        var filterWrap = new WrapRow { Gap = 8 };
        var cohortBox = new ComboBox { ItemsSource = cohorts, SelectedItem = planYear, Header = "培养方案入学年份" };
        cohortBox.SelectionChanged += (_, _) => { if (cohortBox.SelectedItem is string year && year != planYear) { cohortFilter = year; Render(); } };
        filterWrap.Children.Add(cohortBox);
        foreach (var (gVal, gLabel) in new[] { ("全部", "全部年级"), ("大一", "大一"), ("大二", "大二"), ("大三", "大三"), ("大四", "大四") })
            filterWrap.Children.Add(Kit.Pick(gLabel, gradeFilter == gVal, () => { gradeFilter = gVal; Render(); }, 30));
        foreach (var cat in new[] { "全部", "专业基础课", "专业课", "通识教育课" })
            filterWrap.Children.Add(Kit.Pick(cat, categoryFilter == cat, () => { categoryFilter = cat; Render(); }, 30));
        foreach (var (val, label) in new[] { ("全部", "全部性质"), ("必修", "必修"), ("限选", "限选") })
            filterWrap.Children.Add(Kit.Pick(label, natureFilter == val, () => { natureFilter = val; Render(); }, 30));
        var majorBox = new ComboBox { ItemsSource = allMajors, SelectedItem = majorFilter, Height = 30 };
        majorBox.SelectionChanged += (_, _) => { if (majorBox.SelectedItem is string s && s != majorFilter) { majorFilter = s; Render(); } };
        filterWrap.Children.Add(majorBox);
        rootCol.Children.Add(filterWrap);

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
                if (majorFilter != "全部专业" && !meta.Majs.Contains(majorFilter)) return false;
                if (gradeNum > 0 && !meta.Terms.Any(t => (t + 1) / 2 == gradeNum)) return false;
                if (q.Length == 0) return true;
                return c.Name.ToLowerInvariant().Contains(q)
                    || c.Codes.Any(code => code.ToLowerInvariant().Contains(q))
                    || c.Chapters.Any(ch => ch.Title.ToLowerInvariant().Contains(q));
            }).ToList();

            if (homeView == "graph")
            {
                var scoped = curriculum.Where(item => item.Plans.Any(InPlan)).ToList();
                var scopedCodes = scoped.Select(i => i.Code).ToHashSet();
                var nodes = scoped.Where(item => (q.Length == 0 || item.Name.ToLowerInvariant().Contains(q) || item.Code.ToLowerInvariant().Contains(q))).ToList();
                var nodeSet = nodes.Select(n => n.Code).ToHashSet();
                foreach (var n in nodes.ToList())
                    foreach (var r in n.Requires)
                        if (scopedCodes.Contains(r) && !nodeSet.Contains(r) && byCode.TryGetValue(r, out var reqCourse)) { nodes.Add(reqCourse); nodeSet.Add(r); }

                var md = new StringBuilder();
                md.AppendLine("```mermaid");
                md.AppendLine("flowchart LR");
                List<KnowledgeCourse> linkedCourses;
                {
                    var idOf = nodes.Select((n, i) => (n.Code, Id: $"P{i}")).ToDictionary(x => x.Code, x => x.Id);
                    foreach (var n in nodes) md.AppendLine($"  {idOf[n.Code]}[\"{SafeMermaidLabel(n.Name)}\"]");
                    foreach (var n in nodes) foreach (var req in n.Requires) if (idOf.TryGetValue(req, out var fromId)) md.AppendLine($"  {fromId} --> {idOf[n.Code]}");
                    linkedCourses = nodes.Select(n => compiledByCode.GetValueOrDefault(n.Code)).Where(c => c is not null).Cast<KnowledgeCourse>().DistinctBy(c => c.Id).ToList();
                }
                md.AppendLine("```");

                var card = new Border { Background = Paint.Brush("paper"), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12), Padding = new Thickness(18) };
                var graphStack = new StackPanel { Spacing = 14 };
                graphStack.Children.Add(Doc.Make(Doc.Read(nodes.Count > 0 ? md.ToString() : "当前筛选没有培养方案课程。")));
                if (linkedCourses.Count > 0)
                {
                    graphStack.Children.Add(Kit.Hairline());
                    graphStack.Children.Add(Kit.Text("图中有已编译资料的课程（点击进入）", Role.Caption, "muted"));
                    var pills = new WrapRow { Gap = 8 };
                    foreach (var c in linkedCourses)
                    {
                        var t = ToneOf(c.Id);
                        var pill = new Tap(Paint.Tone(t, "bg"), Paint.ToneFaded(t, "bg", .85))
                        {
                            CornerRadius = new CornerRadius(8), BorderBrush = Paint.Tone(t, "border"), BorderThickness = new Thickness(1),
                            Padding = new Thickness(11, 5, 11, 5), Content = Kit.Text(c.Name, Role.Label),
                        };
                        ((TextBlock)pill.Content).Foreground = Paint.Tone(t, "fg");
                        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(pill, c.Name);
                        pill.Click += (_, _) => Open(course: c.Id);
                        pills.Children.Add(pill);
                    }
                    graphStack.Children.Add(pills);
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
                            CornerRadius = new CornerRadius(10), BorderBrush = Paint.Tone(t, "border"), BorderThickness = new Thickness(4, 1, 1, 1),
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
        var layout = new Grid { MaxWidth = 1440, HorizontalAlignment = HorizontalAlignment.Stretch, ColumnSpacing = 28, Padding = new Thickness(24, 16, 24, 32) };
        layout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(250) });
        layout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star), MaxWidth = 780 });
        layout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(260) });

        // Left: Course knowledge tree
        var leftTree = new StackPanel { Spacing = 12 };
        var courseHead = new Tap(topic is null && material is null ? Paint.Tone(t, "bg") : Paint.Clear, Paint.Brush("surface")) { CornerRadius = new CornerRadius(6), Padding = new Thickness(10, 7, 10, 7) };
        var courseTitle = Kit.Text(course.Name, Role.Body, bold: true); courseTitle.Foreground = Paint.Tone(t, "fg");
        courseHead.Content = courseTitle;
        courseHead.Click += (_, _) => Open(course: course.Id);
        leftTree.Children.Add(courseHead);

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
                btn.Click += (_, _) => Open(course: course.Id, topic: tid);
                sec.Children.Add(btn);
            }
            leftTree.Children.Add(sec);
        }
        var courseMats = idx.Materials.Where(m => m.Course == course.idOrEmpty()).ToList();
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
                btn.Click += (_, _) => Open(course: course.Id, material: m.Path);
                msec.Children.Add(btn);
            }
            leftTree.Children.Add(msec);
        }
        var leftScroll = new ScrollViewer { Content = leftTree, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        layout.Children.Add(leftScroll);

        // Middle: Main content + below tested questions
        var midStack = new StackPanel { Spacing = 14 };
        var backBtn = Kit.Button("知识", () => Open(), Icons.Back);
        backBtn.HorizontalAlignment = HorizontalAlignment.Left;
        midStack.Children.Add(backBtn);

        var contentHost = new StackPanel { Spacing = 14 };
        midStack.Children.Add(contentHost);
        var relPath = topic?.Path ?? material?.Path ?? course.Path;
        _ = LoadDocument(contentHost, idx, course, topic, material, relPath, t);
        var midScroll = new ScrollViewer { Content = midStack, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        Grid.SetColumn(midScroll, 1);
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
                var rHead = Kit.Text("知识图谱关系", Role.Caption); rHead.Foreground = Paint.Tone(t, "fg");
                rightStack.Children.Add(rHead);
                var gCard = new Border { Background = Paint.Brush("paper"), BorderBrush = Paint.Brush("line"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(10), Padding = new Thickness(8) };
                gCard.Child = Doc.Make(Doc.Read(mini.ToString()));
                rightStack.Children.Add(gCard);
            }
            if (topic.Requires.Count > 0)
            {
                var rHead = Kit.Text("先要懂", Role.Caption); rHead.Foreground = Paint.Tone(t, "fg");
                rightStack.Children.Add(rHead);
                foreach (var id in topic.Requires) rightStack.Children.Add(RelLink(idx.Topics.FirstOrDefault(x => x.Id == id)?.Title ?? id, () => Open(course: course.Id, topic: id)));
            }
            if (topic.LeadsTo.Count > 0)
            {
                var rHead = Kit.Text("用到它的", Role.Caption); rHead.Foreground = Paint.Tone(t, "fg");
                rightStack.Children.Add(rHead);
                foreach (var id in topic.LeadsTo) rightStack.Children.Add(RelLink(idx.Topics.FirstOrDefault(x => x.Id == id)?.Title ?? id, () => Open(course: course.Id, topic: id)));
            }
            if (topic.Requires.Count == 0 && topic.LeadsTo.Count == 0)
            {
                var rHead = Kit.Text("知识图谱关系", Role.Caption); rHead.Foreground = Paint.Tone(t, "fg");
                rightStack.Children.Add(rHead);
                rightStack.Children.Add(Kit.Text("本知识点暂无前后置关联", Role.Label, "muted"));
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
        var rightScroll = new ScrollViewer { Content = rightStack, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        Grid.SetColumn(rightScroll, 2);
        layout.Children.Add(rightScroll);

        host.Children.Add(layout);
    }

    private static Tap RelLink(string label, Action act)
    {
        var tap = new Tap(Paint.Clear, Paint.Brush("surface")) { CornerRadius = new CornerRadius(6), Padding = new Thickness(8, 5, 8, 5), Content = Kit.Text(label, Role.Label, wrap: true) };
        tap.Click += (_, _) => act();
        return tap;
    }

    private async Task LoadDocument(StackPanel container, KnowledgeIndex idx, KnowledgeCourse course, KnowledgeTopic? topic, KnowledgeMaterial? material, string relPath, int toneIdx)
    {
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
            if (Current()) { container.Children.Clear(); container.Children.Add(Kit.Text("这篇内容没能加载，请稍后重试。", Role.Body, "muted")); }
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
                    var matTitle = idx.Materials.FirstOrDefault(m => m.Path == g.Key)?.Title ?? g.Key;
                    container.Children.Add(Kit.Text(matTitle, Role.Caption, "ink", bold: true, wrap: true));
                    var row = new WrapRow { Gap = 8 };
                    foreach (var qref in g)
                    {
                        var pill = new Tap(Paint.Tone(toneIdx, "bg"), Paint.ToneFaded(toneIdx, "bg", .85))
                        {
                            CornerRadius = new CornerRadius(8), BorderBrush = Paint.Tone(toneIdx, "border"), BorderThickness = new Thickness(1),
                            Padding = new Thickness(10, 5, 10, 5), Content = Kit.Text(qref.Heading, Role.Label),
                        };
                        ((TextBlock)pill.Content).Foreground = Paint.Tone(toneIdx, "fg");
                        pill.Click += (_, _) => Open(course: course.Id, material: g.Key, anchor: qref.Anchor);
                        row.Children.Add(pill);
                    }
                    container.Children.Add(row);
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
