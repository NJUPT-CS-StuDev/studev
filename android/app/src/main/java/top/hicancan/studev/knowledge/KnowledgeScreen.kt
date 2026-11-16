package top.hicancan.studev.knowledge

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.async
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import top.hicancan.studev.app.*
import top.hicancan.studev.timetable.SearchField
import top.hicancan.studev.world.Doc
import top.hicancan.studev.world.DocAnchor
import top.hicancan.studev.world.DocAnchors
import top.hicancan.studev.world.DocText
import top.hicancan.studev.world.Docs
import java.net.URLDecoder
import java.io.IOException
import kotlin.math.abs

@Serializable data class KnowledgeChapter(val title: String, val topics: List<String>)
@Serializable data class KnowledgeCourse(val id: String, val name: String, val codes: List<String> = emptyList(), val former: List<String> = emptyList(), val chapters: List<KnowledgeChapter> = emptyList(), val path: String)
@Serializable data class MaterialRef(val material: String, val heading: String, val anchor: String)
@Serializable data class KnowledgeTopic(val id: String, val title: String, val requires: List<String> = emptyList(), val path: String, val taught_by: List<String> = emptyList(), val references: List<MaterialRef> = emptyList(), val leads_to: List<String> = emptyList())
@Serializable data class KnowledgeMaterial(val path: String, val title: String, val kind: String, val course: String, val term: String? = null, val source: String = "", val sections: Int = 0)
@Serializable data class KnowledgeIndex(val courses: List<KnowledgeCourse>, val topics: List<KnowledgeTopic>, val materials: List<KnowledgeMaterial>, val media: List<String> = emptyList())

@Serializable data class CurriculumCourse(
    val code: String,
    val name: String,
    val plans: List<CurriculumEntry>,
    val requires: List<String> = emptyList(),
    val former: List<String> = emptyList(),
)
@Serializable data class CurriculumEntry(
    val college: String, val major: String, val grade: String,
    val term: Int?, val credits: Double?, val hours: String,
    val exam_mode: String, val category: String, val nature: String,
)

private sealed interface KnowledgePlace {
    class Topic(val id: String) : KnowledgePlace
    class Course(val id: String) : KnowledgePlace
    class Material(val path: String, val anchor: String?) : KnowledgePlace
}

private fun knowledgePlace(href: String): KnowledgePlace? {
    val (rawPath, rawAnchor) = href.split('#', limit = 2).let { it[0] to it.getOrNull(1) }
    val decoded = runCatching { URLDecoder.decode(rawPath, "UTF-8") }.getOrDefault(rawPath)
    val anchor = rawAnchor?.let { runCatching { URLDecoder.decode(it, "UTF-8") }.getOrDefault(it) }
    return when {
        decoded.startsWith("topics/") && decoded.endsWith(".md") -> KnowledgePlace.Topic(decoded.removePrefix("topics/").removeSuffix(".md"))
        decoded.startsWith("courses/") && decoded.endsWith(".md") -> KnowledgePlace.Course(decoded.removePrefix("courses/").removeSuffix(".md"))
        decoded.startsWith("materials/") && decoded.endsWith(".md") -> KnowledgePlace.Material(decoded, anchor)
        else -> null
    }
}

private fun toneIndex(id: String): Int {
    var hash = 0L
    for (ch in id) hash = ((hash * 31L) + ch.code.toLong()) and 0xFFFFFFFFL
    return (hash % 12L).toInt()
}

private fun safeMermaidLabel(text: String): String {
    val clean = text.replace(Regex("[\"\n\r\\[\\]{}]"), "").replace(Regex("[（(][^）)]*[）)]"), "").trim()
    return clean.ifEmpty { text.replace(Regex("[\"\n\r\\[\\]{}]"), "").trim() }
}

private sealed interface MatPart {
    class Text(val blocks: MutableList<JsonObject>) : MatPart
    class Group(val title: String, val anchor: String, var sections: Int = 0) : MatPart
    class Section(
        val title: String,
        val anchor: String,
        val asks: MutableList<JsonObject> = mutableListOf(),
        val answer: MutableList<Pair<String, MutableList<JsonObject>>> = mutableListOf(),
        val topics: MutableList<Pair<String, String>> = mutableListOf(),
    ) : MatPart
}

private val ANSWER_LABELS = listOf("参考解答", "答案", "订正", "补充", "原文")
private fun containsAnchor(value: JsonElement, anchor: String): Boolean = when (value) {
    is JsonArray -> value.any { containsAnchor(it, anchor) }
    is JsonObject -> value["anchor"]?.jsonPrimitive?.contentOrNull == anchor || value.values.any { containsAnchor(it, anchor) }
    else -> false
}
private fun plainInlines(inlines: JsonArray?): String = inlines.orEmpty().joinToString("") { el ->
    val obj = el as? JsonObject ?: return@joinToString ""
    when (obj["type"]?.jsonPrimitive?.content) {
        "text", "code" -> obj["text"]?.jsonPrimitive?.content.orEmpty()
        "math" -> obj["tex"]?.jsonPrimitive?.content.orEmpty()
        else -> plainInlines(obj["children"] as? JsonArray)
    }
}

private fun linkInlines(inlines: JsonArray?, out: MutableList<Pair<String, String>>) {
    inlines.orEmpty().forEach { el ->
        val obj = el as? JsonObject ?: return@forEach
        if (obj["type"]?.jsonPrimitive?.content == "link") {
            out += plainInlines(obj["children"] as? JsonArray) to (obj["href"]?.jsonPrimitive?.content.orEmpty())
        } else {
            linkInlines(obj["children"] as? JsonArray, out)
        }
    }
}

private fun materialParts(blocks: List<JsonObject>): List<MatPart> {
    val parts = mutableListOf<MatPart>()
    var question: MatPart.Section? = null
    var group: MatPart.Group? = null
    for (keyed in blocks) {
        val block = keyed["block"] as? JsonObject ?: continue
        val type = block["type"]?.jsonPrimitive?.content
        if (type == "heading") {
            val level = block["level"]?.jsonPrimitive?.int ?: 1
            if (level <= 2) {
                question = null
                if (level == 1) { parts += MatPart.Text(mutableListOf(keyed)); continue }
                group = MatPart.Group(plainInlines(block["inlines"] as? JsonArray), block.getValue("anchor").jsonPrimitive.content)
                parts += group
                continue
            }
            if (level == 3) {
                val title = plainInlines(block["inlines"] as? JsonArray)
                question = MatPart.Section(title, block.getValue("anchor").jsonPrimitive.content)
                parts += question
                group?.let { it.sections++ }
                continue
            }
        }
        val currentQ = question
        if (currentQ == null) {
            val last = parts.lastOrNull()
            if (last is MatPart.Text) last.blocks += keyed else parts += MatPart.Text(mutableListOf(keyed))
            continue
        }
        val text = if (type == "paragraph") plainInlines(block["inlines"] as? JsonArray).trim() else ""
        if (text.startsWith("知识点：") && type == "paragraph") {
            linkInlines(block["inlines"] as? JsonArray, currentQ.topics)
            continue
        }
        val label = ANSWER_LABELS.firstOrNull { text.startsWith("$it：") || text.startsWith("$it（") || text == it }
        if (label != null) {
            currentQ.answer += label to mutableListOf(keyed)
            continue
        }
        if (currentQ.answer.isNotEmpty()) currentQ.answer.last().second += keyed else currentQ.asks += keyed
    }
    return parts
}

@Composable fun KnowledgeScreen(route: Route, state: AcademicState) {
    val context = LocalContext.current
    val repo = state.repository
    var knowledge by remember(repo) { mutableStateOf<KnowledgeIndex?>(null) }
    var curriculum by remember(repo) { mutableStateOf<List<CurriculumCourse>>(emptyList()) }
    var failed by remember(repo) { mutableStateOf(false) }

    LaunchedEffect(repo) {
        if (repo == null) return@LaunchedEffect
        failed = false
        try {
            coroutineScope {
                val k = async { repo.read<KnowledgeIndex>("knowledge/knowledge.json") }
                val c = async { repo.read<List<CurriculumCourse>>("curriculum/courses.json") }
                curriculum = c.await()
                knowledge = k.await()
            }
        } catch (e: CancellationException) { throw e }
        catch (_: IOException) { failed = true }
        catch (_: SerializationException) { failed = true }
    }

    val index = knowledge
    if (failed) {
        Box(Modifier.fillMaxSize().statusBarsPadding(), contentAlignment = Alignment.Center) {
            Plain("知识与培养方案没能加载，请稍后重试", 14.sp, Ink.muted)
        }
        return
    }
    if (index == null) {
        Box(Modifier.fillMaxSize().statusBarsPadding(), contentAlignment = Alignment.Center) {
            Plain("正在打开知识…", 14.sp, Ink.muted)
        }
        return
    }

    val topic = index.topics.firstOrNull { it.id == route.knowledgeTopic }
    val material = index.materials.firstOrNull { it.path == route.knowledgeMaterial }
    val courseId = route.knowledgeCourse ?: topic?.taught_by?.firstOrNull() ?: material?.course
    val course = index.courses.firstOrNull { it.id == courseId }

    BackHandler(enabled = course != null || topic != null || material != null) {
        when {
            topic != null || material != null -> route.knowledge(course = course?.id)
            course != null -> route.knowledge()
        }
    }

    if (course == null) {
        KnowledgeHome(index, curriculum) { route.knowledge(course = it) }
        return
    }

    var showOutline by remember { mutableStateOf(false) }
    val courseTone = tone(toneIndex(course.id))
    // Pictures are named by full address on the knowledge's own static hosts.
    val imageBytes: suspend (String) -> ByteArray? = { address -> repo?.media(address, index.media) }
    val onDocLink: (String) -> Unit = { href ->
        when (val to = knowledgePlace(href)) {
            is KnowledgePlace.Topic -> route.knowledge(course = course.id, topic = to.id)
            is KnowledgePlace.Course -> route.knowledge(course = to.id)
            is KnowledgePlace.Material -> route.knowledge(course = course.id, material = to.path, anchor = to.anchor)
            null -> if (!route.open(href, top.hicancan.studev.account.PLATFORM_ORIGIN) && href.startsWith("http")) {
                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(href))) }
            }
        }
    }

    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        Row(
            Modifier.fillMaxWidth().bottomHairline(Ink.line).padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Plain("‹ 知识", 14.sp, Ink.brand, FontWeight.Medium, Modifier.clickable { route.knowledge() }.padding(vertical = 4.dp))
            Box(Modifier.weight(1f)) {
                Plain(course.name, 16.sp, courseTone.fg, FontWeight.SemiBold, maxLines = 1)
            }
            Box(Modifier.padding(end = 36.dp)) {
                Chip("目录 ▾", { showOutline = true })
            }
        }

        val relPath = topic?.path ?: material?.path ?: course.path
        var text by remember(repo, relPath) { mutableStateOf<String?>(null) }
        var textErr by remember(repo, relPath) { mutableStateOf(false) }
        LaunchedEffect(repo, relPath) {
            text = null; textErr = false
            runCatching { repo?.bytes("knowledge/$relPath")?.decodeToString() }
                .onSuccess { text = it }
                .onFailure { textErr = true }
        }

        val scrollState = rememberScrollState()
        LaunchedEffect(course.id, topic?.id, material?.path, route.knowledgeAnchor) {
            if (route.knowledgeAnchor == null) scrollState.scrollTo(0)
        }
        key(relPath) { DocAnchors(route.knowledgeAnchor.takeIf { material != null }, scrollState) { anchors ->
        Column(Modifier.weight(1f).then(anchors).verticalScroll(scrollState).padding(horizontal = 16.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            when {
                textErr -> Plain("这篇内容没能加载，请稍后重试。", 14.sp, Ink.muted)
                text == null -> Plain("正在打开…", 14.sp, Ink.muted)
                topic != null -> TopicDetail(topic, text!!, index, course, courseTone, onDocLink, imageBytes) { t, m, a ->
                    route.knowledge(course = course.id, topic = t, material = m, anchor = a)
                }
                material != null -> MaterialDetail(material, text!!, index, route.knowledgeAnchor, courseTone, onDocLink, imageBytes)
                else -> CourseDetail(course, text!!, index, courseTone, onDocLink, imageBytes) { t, m ->
                    route.knowledge(course = course.id, topic = t, material = m)
                }
            }
        } } }
    }

    if (showOutline) {
        PlainSheet(course.name, { showOutline = false }, head = courseTone.bg to courseTone.fg) {
            Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                KeyRow(null, "${course.name} · 课程概览", chevron = true, onClick = { showOutline = false; route.knowledge(course = course.id) })
                course.chapters.forEach { chapter ->
                    Plain(chapter.title, 12.5.sp, courseTone.fg, FontWeight.SemiBold, Modifier.padding(top = 6.dp))
                    chapter.topics.forEach { tid ->
                        val tTitle = index.topics.firstOrNull { it.id == tid }?.title ?: tid
                        KeyRow(null, tTitle, color = if (tid == topic?.id) courseTone.fg else Ink.text, chevron = true, onClick = {
                            showOutline = false; route.knowledge(course = course.id, topic = tid)
                        })
                    }
                }
                val mats = index.materials.filter { it.course == course.id }
                if (mats.isNotEmpty()) {
                    Plain("资料", 12.5.sp, courseTone.fg, FontWeight.SemiBold, Modifier.padding(top = 6.dp))
                    mats.forEach { mat ->
                        KeyRow(mat.kind, mat.title, color = if (mat.path == material?.path) courseTone.fg else Ink.text, chevron = true, onClick = {
                            showOutline = false; route.knowledge(course = course.id, material = mat.path)
                        })
                    }
                }
            }
        }
    }
}

private val TERM_TITLES = listOf("", "大一上", "大一下", "大二上", "大二下", "大三上", "大三下", "大四上", "大四下")
private val GRADE_OPTIONS = listOf("全部" to null, "大一" to 1, "大二" to 2, "大三" to 3, "大四" to 4)
private fun primaryCodeLabel(codes: List<String>) = if (codes.size > 1) "${codes.first()} +${codes.size - 1}" else codes.firstOrNull() ?: "培养方案课程"

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun KnowledgeHome(
    index: KnowledgeIndex,
    curriculum: List<CurriculumCourse>,
    onOpen: (String) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var view by remember { mutableStateOf("list") }
    var category by remember { mutableStateOf("全部") }
    var nature by remember { mutableStateOf("全部") }
    var grade by remember { mutableStateOf("全部") }
    var major by remember { mutableStateOf("全部专业") }
    var majorMenu by remember { mutableStateOf(false) }
    var cohort by remember { mutableStateOf("") }
    var cohortMenu by remember { mutableStateOf(false) }
    val cohorts = curriculum.flatMap { it.plans.map { plan -> plan.grade } }.distinct().sortedDescending()
    val planYear = cohort.ifEmpty { cohorts.firstOrNull().orEmpty() }
    fun inPlan(plan: CurriculumEntry) = plan.grade == planYear && (major == "全部专业" || plan.major == major) &&
        (category == "全部" || plan.category == category) && (nature == "全部" || plan.nature == nature)

    val byCode = remember(curriculum) { curriculum.associateBy { it.code } }
    val compiledByCode = remember(index) {
        buildMap {
            index.courses.forEach { c -> (c.codes + c.former).forEach { code -> put(code, c) } }
        }
    }
    val metaMap = remember(index, byCode, planYear, major, category, nature) {
        index.courses.associate { c ->
            val matched = (c.codes + c.former).mapNotNull { byCode[it] }.distinctBy { it.code }.flatMap { it.plans }.filter(::inPlan)
            c.id to Triple(
                matched.map { it.category }.filter { it.isNotBlank() }.distinct(),
                matched.map { it.nature }.filter { it.isNotBlank() }.distinct(),
                matched.map { it.major }.filter { it.isNotBlank() }.distinct(),
            )
        }
    }
    val termsMap = remember(index, byCode, planYear, major, category, nature) {
        index.courses.associate { c ->
            c.id to (c.codes + c.former).mapNotNull { byCode[it] }.flatMap { it.plans }.filter(::inPlan).mapNotNull { it.term }.filter { it in 1..8 }.distinct().sorted()
        }
    }
    val creditsMap = remember(index, byCode, planYear, major, category, nature) {
        index.courses.associate { c ->
            c.id to (c.codes + c.former).mapNotNull { byCode[it] }.flatMap { it.plans }.filter(::inPlan).mapNotNull { it.credits }.filter { it > 0 }.distinct().sorted().takeIf { it.isNotEmpty() }?.joinToString("/")
        }
    }
    val majors = remember(curriculum) {
        val preferred = listOf("计算机科学与技术", "软件工程", "信息安全", "计算机科学与技术(创新班)")
        val found = curriculum.flatMap { it.plans.map { plan -> plan.major } }.distinct()
        listOf("全部专业") + preferred.filter { it in found } + found.filter { it !in preferred }
    }

    val q = query.trim().lowercase()
    val targetGrade = GRADE_OPTIONS.firstOrNull { it.first == grade }?.second
    val filtered = remember(index, metaMap, termsMap, category, nature, major, targetGrade, q) {
        index.courses.filter { c ->
            val (cats, nats, majs) = metaMap[c.id] ?: Triple(emptyList(), emptyList(), emptyList())
            val terms = termsMap[c.id].orEmpty()
            if (category != "全部" && category !in cats) return@filter false
            if (nature != "全部" && nature !in nats) return@filter false
            if (major != "全部专业" && major !in majs) return@filter false
            if (targetGrade != null && terms.none { (it + 1) / 2 == targetGrade }) return@filter false
            if (q.isEmpty()) return@filter true
            q in c.name.lowercase() || c.codes.any { q in it.lowercase() } || c.chapters.any { q in it.title.lowercase() }
        }
    }
    val groupedByTerm = remember(filtered, termsMap, targetGrade) {
        filtered.flatMap { c ->
            val terms = termsMap[c.id].orEmpty().filter { targetGrade == null || (it + 1) / 2 == targetGrade }
            terms.ifEmpty { listOf(99) }.map { it to c }
        }.groupBy({ it.first }, { it.second }).entries.sortedBy { it.key }.map { (term, list) ->
            Triple(
                term,
                if (term in 1..8) TERM_TITLES[term] else "其他与通识课程",
                if (term in 1..8) "第 $term 学期 · ${list.size} 门" else "${list.size} 门",
            ) to list
        }
    }

    Column(Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 16.dp).padding(top = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Column(Modifier.fillMaxWidth().padding(end = 40.dp)) {
            Plain("知识", 22.sp, weight = FontWeight.SemiBold)
            Plain("按学期与培养方案组织的知识点与课程资料", 13.5.sp, Ink.muted, modifier = Modifier.padding(top = 2.dp))
        }
        SearchField(query, "筛选课程名称、课程代码或章节…") { query = it }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Choice(listOf("list" to "按学期看", "graph" to "依赖关系图"), view) { view = it }
            Box {
                Chip(if (major == "全部专业") "全部专业 ▾" else "${major.take(6)} ▾", { majorMenu = true })
                DropdownMenu(majorMenu, { majorMenu = false }, containerColor = Ink.paper) {
                    majors.forEach { m -> DropdownMenuItem({ Plain(m, 14.sp) }, { majorMenu = false; major = m }) }
                }
            }
        }
        Box {
            Chip("$planYear 级培养方案 ▾", { cohortMenu = true })
            DropdownMenu(cohortMenu, { cohortMenu = false }, containerColor = Ink.paper) {
                cohorts.forEach { year -> DropdownMenuItem({ Plain("$year 级培养方案", 14.sp) }, { cohortMenu = false; cohort = year }) }
            }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            GRADE_OPTIONS.forEach { (value, _) ->
                FilterChipPill(if (value == "全部") "全部年级" else value, grade == value) { grade = value }
            }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("全部", "专业基础课", "专业课", "通识教育课").forEach { item ->
                FilterChipPill(item, category == item) { category = item }
            }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("全部" to "全部性质", "必修" to "必修", "限选" to "限选").forEach { (value, label) ->
                FilterChipPill(label, nature == value) { nature = value }
            }
        }

        if (view == "graph") {
            val (doc, linked) = remember(curriculum, major, category, nature, q, filtered, compiledByCode, planYear) {
                val scoped = curriculum.filter { item -> item.plans.any(::inPlan) }
                val scopedCodes = scoped.map { it.code }.toSet()
                val nodes = scoped.filter { (q.isEmpty() || q in it.name.lowercase() || q in it.code.lowercase()) }.toMutableList()
                val nodeCodes = nodes.map { it.code }.toMutableSet()
                for (n in nodes.toList()) {
                    for (req in n.requires) {
                        if (req in scopedCodes && req !in nodeCodes) {
                            byCode[req]?.let { nodes += it; nodeCodes += req }
                        }
                    }
                }
                run {
                    val idOf = nodes.mapIndexed { i, n -> n.code to "P$i" }.toMap()
                    val md = buildString {
                        appendLine("```mermaid")
                        appendLine("flowchart LR")
                        nodes.forEach { n -> appendLine("  ${idOf[n.code]}[\"${safeMermaidLabel(n.name)}\"]") }
                        nodes.forEach { n -> n.requires.forEach { req -> if (req in idOf) appendLine("  ${idOf[req]} --> ${idOf[n.code]}") } }
                        appendLine("```")
                    }
                    val linkedCourses = nodes.mapNotNull { compiledByCode[it.code] }.distinctBy { it.id }
                    (if (nodes.isEmpty()) "当前筛选没有培养方案课程。" else md) to linkedCourses
                }
            }
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                DocText(doc)
                if (linked.isNotEmpty()) {
                    Plain("图中有已编译资料的课程（点击进入）", 12.5.sp, Ink.muted)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        linked.forEach { c ->
                            val ct = tone(toneIndex(c.id))
                            Surface({ onOpen(c.id) }, shape = RoundedCornerShape(8.dp), color = ct.bg, border = BorderStroke(1.dp, ct.border)) {
                                Plain(c.name, 13.sp, ct.fg, FontWeight.Medium, Modifier.padding(horizontal = 10.dp, vertical = 6.dp))
                            }
                        }
                    }
                }
            }
        } else {
            LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(bottom = 16.dp)) {
                if (groupedByTerm.isEmpty()) {
                    item { Plain("没有符合当前筛选条件的课程", 14.sp, Ink.faint, modifier = Modifier.padding(vertical = 24.dp)) }
                }
                groupedByTerm.forEach { (header, groupCourses) ->
                    val (termKey, termTitle, termSub) = header
                    item(key = "h-$termKey") {
                        Row(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 2.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Plain(termTitle, 16.sp, Ink.text, FontWeight.SemiBold)
                            Plain(termSub, 12.sp, Ink.muted)
                        }
                    }
                    items(groupCourses, key = { "$termKey:${it.id}" }) { course ->
                        val ct = tone(toneIndex(course.id))
                        val topicsCount = course.chapters.flatMap { it.topics }.distinct().size
                        val materialsCount = index.materials.count { it.course == course.id }
                        val (cats, nats, _) = metaMap[course.id] ?: Triple(emptyList(), emptyList(), emptyList())
                        val credits = creditsMap[course.id]
                        val subtitle = listOfNotNull(primaryCodeLabel(course.codes), cats.firstOrNull(), nats.takeIf { it.isNotEmpty() }?.joinToString("/"), credits?.let { "$it 学分" }).joinToString(" · ")
                        Surface(
                            onClick = { onOpen(course.id) },
                            shape = RoundedCornerShape(10.dp),
                            color = Ink.paper,
                            border = BorderStroke(1.dp, ct.border),
                        ) {
                            Column(Modifier.fillMaxWidth().background(ct.bg.copy(alpha = 0.25f)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Plain(course.name, 16.sp, ct.fg, FontWeight.SemiBold)
                                Plain(subtitle, 12.5.sp, Ink.muted, maxLines = 1)
                                Plain("${course.chapters.size} 章 · $topicsCount 个知识点 · $materialsCount 份资料", 12.5.sp, Ink.muted)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable private fun FilterChipPill(label: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(999.dp),
        color = if (selected) MaterialTheme.colorScheme.primaryContainer else Ink.paper,
        border = BorderStroke(1.dp, if (selected) Ink.brand.copy(alpha = .4f) else Ink.line),
    ) {
        Plain(
            label,
            12.5.sp,
            if (selected) MaterialTheme.colorScheme.onPrimaryContainer else Ink.muted,
            if (selected) FontWeight.SemiBold else FontWeight.Normal,
            Modifier.padding(horizontal = 11.dp, vertical = 5.dp),
        )
    }
}

@Composable private fun CourseDetail(
    course: KnowledgeCourse,
    text: String,
    index: KnowledgeIndex,
    ct: Tone,
    onLink: (String) -> Unit,
    imageBytes: suspend (String) -> ByteArray?,
    onOpen: (topic: String?, material: String?) -> Unit,
) {
    DocText(text, onLink = onLink, imageBytes = imageBytes)
    val topics = course.chapters.flatMap { it.topics }.mapNotNull { id -> index.topics.firstOrNull { it.id == id } }
        .sortedByDescending { it.references.size }.filter { it.references.isNotEmpty() }.take(8)
    if (topics.isNotEmpty()) {
        Plain("资料中的知识点", 16.sp, ct.fg, FontWeight.SemiBold, Modifier.padding(top = 6.dp))
        Column {
            topics.forEach { t ->
                val mats = t.references.map { it.material }.distinct().size
                KeyRow(null, t.title, "${t.references.size} 处 · $mats 份资料", color = ct.fg, chevron = true, onClick = { onOpen(t.id, null) })
            }
        }
    }
    val mats = index.materials.filter { it.course == course.id }
    if (mats.isNotEmpty()) {
        Plain("资料", 16.sp, ct.fg, FontWeight.SemiBold, Modifier.padding(top = 6.dp))
        Column {
            mats.forEach { m ->
                KeyRow(m.kind, m.title, if (m.sections > 0) "${m.sections} 处关联" else m.term, chevron = true, onClick = { onOpen(null, m.path) })
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun TopicDetail(
    topic: KnowledgeTopic,
    text: String,
    index: KnowledgeIndex,
    course: KnowledgeCourse,
    ct: Tone,
    onLink: (String) -> Unit,
    imageBytes: suspend (String) -> ByteArray?,
    onOpen: (topic: String?, material: String?, anchor: String?) -> Unit,
) {
    val matsCount = topic.references.map { it.material }.distinct().size
    Plain(
        if (topic.references.isNotEmpty()) "关联 ${topic.references.size} 处 · 出现在 $matsCount 份资料里" else "收录的资料里还没有与它关联的片段",
        13.sp,
        ct.fg,
    )
    DocText(text, onLink = onLink, imageBytes = imageBytes)

    // Tested past-exam links directly below explanation
    Plain("关联资料", 16.sp, ct.fg, FontWeight.SemiBold, Modifier.padding(top = 8.dp))
    val byMaterial = topic.references.groupBy { it.material }
    if (byMaterial.isEmpty()) {
        Plain("收录的资料里还没有与它关联的片段。", 13.5.sp, Ink.muted)
    } else {
        byMaterial.forEach { (path, refs) ->
            val mat = index.materials.firstOrNull { it.path == path }
            Column(Modifier.fillMaxWidth().bottomHairline(Ink.line).padding(bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Plain(mat?.title ?: path, 13.sp, Ink.text, FontWeight.Medium)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    refs.forEach { ref ->
                        Surface(
                            onClick = { onOpen(null, path, ref.anchor) },
                            shape = RoundedCornerShape(8.dp),
                            color = ct.bg,
                            border = BorderStroke(1.dp, ct.border),
                        ) {
                            Plain(ref.heading, 13.sp, ct.fg, modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp))
                        }
                    }
                }
            }
        }
    }

    // Knowledge graph relations
    if (topic.requires.isNotEmpty() || topic.leads_to.isNotEmpty()) {
        val titleOf = { id: String -> index.topics.firstOrNull { it.id == id }?.title ?: id }
        val miniDoc = remember(topic.id, index.topics) {
            buildString {
                appendLine("```mermaid")
                appendLine("flowchart LR")
                appendLine("  CUR[\"${safeMermaidLabel(topic.title)}\"]")
                topic.requires.take(5).forEachIndexed { i, id ->
                    appendLine("  R$i[\"${safeMermaidLabel(titleOf(id))}\"]")
                    appendLine("  R$i --> CUR")
                }
                topic.leads_to.take(5).forEachIndexed { i, id ->
                    appendLine("  L$i[\"${safeMermaidLabel(titleOf(id))}\"]")
                    appendLine("  CUR --> L$i")
                }
                appendLine("```")
            }
        }
        Plain("知识图谱关系", 16.sp, ct.fg, FontWeight.SemiBold, Modifier.padding(top = 8.dp))
        DocText(miniDoc)
        if (topic.requires.isNotEmpty()) {
            Plain("先要懂", 13.sp, Ink.muted)
            topic.requires.forEach { id -> KeyRow(null, titleOf(id), color = ct.fg, chevron = true, onClick = { onOpen(id, null, null) }) }
        }
        if (topic.leads_to.isNotEmpty()) {
            Plain("用到它的", 13.sp, Ink.muted)
            topic.leads_to.forEach { id -> KeyRow(null, titleOf(id), color = ct.fg, chevron = true, onClick = { onOpen(id, null, null) }) }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class, androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable private fun MaterialDetail(
    material: KnowledgeMaterial,
    text: String,
    index: KnowledgeIndex,
    anchor: String?,
    ct: Tone,
    onLink: (String) -> Unit,
    imageBytes: suspend (String) -> ByteArray?,
) {
    val parts = remember(text) { materialParts(Docs.read(text)) }
    var shown by remember(material.path) { mutableStateOf(emptySet<String>()) }
    val withAnswerCount = remember(parts) { parts.count { it is MatPart.Section && it.answer.isNotEmpty() } }
    val owner = parts.filterIsInstance<MatPart.Section>().firstOrNull { part -> anchor != null && part.answer.any { (_, blocks) -> blocks.any { containsAnchor(it, anchor) } } }?.anchor
    LaunchedEffect(owner) { if (owner != null) shown = shown + owner }

    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        SmallTag(material.kind, ct.bg, ct.fg)
        val meta = listOfNotNull(material.term, material.sections.takeIf { it > 0 }?.let { "$it 处关联" }).joinToString(" · ")
        if (meta.isNotEmpty()) Plain(meta, 12.5.sp, Ink.muted)
        if (withAnswerCount > 0 && material.kind != "课件") {
            Plain(
                if (shown.isNotEmpty()) "收起全部解答" else "展开全部解答",
                13.sp,
                Ink.brand,
                modifier = Modifier.clickable {
                    shown = if (shown.isNotEmpty()) emptySet()
                    else parts.filterIsInstance<MatPart.Section>().map { it.anchor }.toSet()
                },
            )
        }
    }

    parts.forEach { part ->
        when (part) {
            is MatPart.Text -> Doc(part.blocks, onLink = onLink, imageBytes = imageBytes)
            is MatPart.Group -> DocAnchor(part.anchor) { Plain("${part.title}${if (part.sections > 0) " (${part.sections} 节)" else ""}", 17.sp, ct.fg, FontWeight.SemiBold, Modifier.padding(top = 10.dp)) }
            is MatPart.Section -> {
                val open = part.anchor in shown
                val here = anchor == part.anchor
                DocAnchor(part.anchor) { Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = Ink.paper,
                    border = BorderStroke(if (here) 1.5.dp else 1.dp, if (here) Ink.brand else ct.border),
                ) {
                    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Plain(part.title, 13.sp, ct.fg, FontWeight.SemiBold)
                        if (part.topics.isNotEmpty()) {
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                part.topics.forEach { (title, href) ->
                                    Surface(onClick = { onLink(href) }, shape = RoundedCornerShape(999.dp), color = ct.bg, border = BorderStroke(1.dp, ct.border)) {
                                        Plain(title, 12.sp, ct.fg, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp))
                                    }
                                }
                            }
                        }
                        Doc(part.asks, onLink = onLink, imageBytes = imageBytes)
                        if (part.answer.isNotEmpty()) {
                            val label = if (part.answer[0].first == "原文") (if (open) "收起原文" else "看原文") else (if (open) "收起解答" else "看解答")
                            Plain(label, 13.sp, Ink.brand, modifier = Modifier.clickable {
                                shown = if (open) shown - part.anchor else shown + part.anchor
                            })
                            if (open) {
                                Column(Modifier.fillMaxWidth().topHairline(Ink.line).padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    part.answer.forEach { (_, blocks) -> Doc(blocks, onLink = onLink, imageBytes = imageBytes) }
                                }
                            }
                        }
                    }
                } }
            }
        }
    }
}
