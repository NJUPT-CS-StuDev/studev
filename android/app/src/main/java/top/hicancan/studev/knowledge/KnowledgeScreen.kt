package top.hicancan.studev.knowledge

import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.testTagsAsResourceId
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
import top.hicancan.studev.me.PersonalSettings
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
    val term: Int?, val credits: Double?, val hours: String, val weeks: String,
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

@Composable fun KnowledgeScreen(route: Route, state: AcademicState, settings: PersonalSettings) {
    val context = LocalContext.current
    val repo = state.repository
    var knowledge by remember(repo) { mutableStateOf<KnowledgeIndex?>(null) }
    var curriculum by remember(repo) { mutableStateOf<List<CurriculumCourse>>(emptyList()) }
    var failed by remember(repo) { mutableStateOf(false) }
    var loadRevision by remember(repo) { mutableIntStateOf(0) }

    LaunchedEffect(repo, loadRevision) {
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
        catch (e: IOException) {
            Log.e("Knowledge", "Could not read knowledge/knowledge.json or curriculum/courses.json from release ${repo.release.version}", e)
            failed = true
        }
        catch (e: SerializationException) {
            Log.e("Knowledge", "Could not decode knowledge/knowledge.json or curriculum/courses.json from release ${repo.release.version}", e)
            failed = true
        }
    }

    val index = knowledge
    if (failed) {
        Box(Modifier.fillMaxSize().statusBarsPadding(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Plain("知识暂时无法加载", 14.sp, Ink.muted)
                TextAction("重试", { loadRevision++ }, refresh = true)
            }
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
        KnowledgeHome(index, curriculum, route, state.classes.firstOrNull { it.id == settings.klass }) { route.knowledge(course = it) }
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
        CampusHeader(Modifier.bottomHairline(Ink.line).padding(horizontal = 14.dp)) {
            Plain("‹ 知识", 14.sp, Ink.brand, FontWeight.Medium, Modifier.clickable { route.knowledge() }.padding(vertical = 4.dp))
            if (topic != null || material != null) {
                Row(Modifier.weight(1f).heightIn(min = 44.dp).clickable { showOutline = true }.semantics { contentDescription = "课程目录：${course.name}" }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Plain(course.name, 15.sp, courseTone.fg, FontWeight.SemiBold, modifier = Modifier.weight(1f, fill = false), maxLines = 1)
                    Plain("⌄", 14.sp, Ink.muted)
                }
            }
        }

        val relPath = topic?.path ?: material?.path ?: course.path
        var text by remember(repo, relPath) { mutableStateOf<String?>(null) }
        var textErr by remember(repo, relPath) { mutableStateOf(false) }
        var textRevision by remember(repo, relPath) { mutableIntStateOf(0) }
        LaunchedEffect(repo, relPath, textRevision) {
            text = null; textErr = false
            try { text = repo?.bytes("knowledge/$relPath")?.decodeToString() ?: throw IOException("No knowledge repository") }
            catch (e: CancellationException) { throw e }
            catch (e: IOException) { Log.e("Knowledge", "Could not read $relPath", e); textErr = true }
        }

        val scrollState = rememberScrollState()
        LaunchedEffect(course.id, topic?.id, material?.path, route.knowledgeAnchor) {
            if (route.knowledgeAnchor == null) scrollState.scrollTo(0)
        }
        key(relPath) { DocAnchors(route.knowledgeAnchor.takeIf { material != null }, scrollState) { anchors ->
        Column(Modifier.weight(1f).then(anchors).verticalScroll(scrollState).padding(horizontal = 16.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            when {
                textErr -> Column(Modifier.fillMaxWidth().padding(vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { Plain(topic?.title ?: material?.title ?: course.name, 22.sp, weight = FontWeight.SemiBold); Plain("内容暂时无法加载", 14.sp, Ink.muted); TextAction("重试", { textRevision++ }, refresh = true) }
                text == null -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { Plain(topic?.title ?: material?.title ?: course.name, 22.sp, weight = FontWeight.SemiBold); Plain("正在打开…", 14.sp, Ink.muted) }
                topic != null -> TopicDetail(topic, text!!, index, course, courseTone, onDocLink, imageBytes, { path -> repo?.bytes("knowledge/$path")?.decodeToString() }) { t, m, a ->
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
private data class KnowledgeFilterDraft(val cohort: String, val major: String, val grade: String, val category: String, val nature: String, val inheritCohort: Boolean, val inheritMajor: Boolean)
private fun courseMajors(curriculum: List<CurriculumCourse>, cohort: String): List<String> {
    val preferred = listOf("计算机科学与技术", "软件工程", "信息安全", "计算机科学与技术(创新班)")
    val found = curriculum.flatMap { it.plans.filter { plan -> plan.grade == cohort }.map { plan -> plan.major } }.distinct()
    return listOf("全部专业") + preferred.filter { it in found } + found.filter { it !in preferred }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun KnowledgeHome(
    index: KnowledgeIndex,
    curriculum: List<CurriculumCourse>,
    route: Route,
    person: top.hicancan.studev.data.TeachingClass?,
    onOpen: (String) -> Unit,
) {
    val filters = route.knowledgeFilters
    fun choose(key: String, value: String) { route.knowledgeFilters = route.knowledgeFilters + (key to value) }
    val query = filters["q"].orEmpty()
    val view = filters["view"] ?: "list"
    val category = filters["category"] ?: "全部"
    val nature = filters["nature"] ?: "全部"
    val grade = filters["grade"] ?: "全部"
    val scope = catalogScope(curriculum, person?.grade, person?.major, filters["cohort"], filters["major"])
    val major = scope.second
    val planYear = scope.first
    var filterDraft by remember { mutableStateOf<KnowledgeFilterDraft?>(null) }
    val advanced = listOf(grade, category, nature).count { it != "全部" }
    val focus = filters["focus"].orEmpty()
    val cohorts = curriculum.flatMap { it.plans.map { plan -> plan.grade } }.distinct().sortedDescending()
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

    val selected = remember(curriculum, planYear, major, category, nature, targetGrade, q) {
        curriculum.filter { item -> item.plans.any { plan -> inPlan(plan) && (targetGrade == null || plan.term?.let { (it + 1) / 2 == targetGrade } == true) } &&
            (q.isEmpty() || q in item.name.lowercase() || q in item.code.lowercase()) }
    }
    val overview = remember(curriculum, selected) { courseRelations(curriculum, selected) }
    val graphFocus = if (focus == "all" || overview.choices.any { it.code == focus }) focus else overview.choices.firstOrNull()?.code ?: "all"
    val relations = remember(curriculum, selected, graphFocus) { courseRelations(curriculum, selected, graphFocus) }
    var showPlanned by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        CampusHeader { Plain("知识", 22.sp, weight = FontWeight.SemiBold) }
        SearchField(query, if (view == "graph") "搜索课程或代码" else "搜索课程、代码或章节") { choose("q", it) }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Choice(listOf("list" to "课程目录", "graph" to "课程关系"), view) { choose("view", it) }
            TextAction("筛选", { filterDraft = KnowledgeFilterDraft(planYear, major, grade, category, nature, !filters.containsKey("cohort"), !filters.containsKey("major")) }, muted = true)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Plain("${planYear}级 · $major", 12.sp, Ink.muted, modifier = Modifier.weight(1f), maxLines = 1)
            if (advanced > 0) Plain("$advanced 项筛选", 12.sp, Ink.muted)
        }
        if (view == "graph") KnowledgeSelect("查看课程", graphFocus, listOf("all" to "全部关系") + overview.choices.map { it.code to it.name }) { choose("focus", it) }

        if (view == "graph") {
            val doc = buildString {
                appendLine("```mermaid")
                appendLine("flowchart TB")
                val idOf = relations.nodes.mapIndexed { i, node -> node.code to "P$i" }.toMap()
                relations.nodes.forEach { node -> appendLine("  ${idOf[node.code]}[\"${safeMermaidLabel(node.name)}\"]") }
                relations.edges.forEach { edge -> appendLine("  ${idOf[edge.from]} --> ${idOf[edge.to]}") }
                appendLine("```")
            }
            val linked = relations.nodes.mapNotNull { compiledByCode[it.code] }.distinctBy { it.id }
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Plain("箭头表示作者整理的建议先修顺序，学期安排以培养方案为准。", 12.sp, Ink.muted)
                if (relations.edges.isEmpty()) Plain("当前筛选暂无已收录的先修关系。课程仍可在课程目录查看。", 14.sp, Ink.muted)
                else DocText(doc)
                if (relations.unlinked > 0 && relations.edges.isNotEmpty()) Plain("仅显示已收录的关系，未连线课程仍可在课程目录查看。", 12.sp, Ink.muted)
                if (linked.isNotEmpty()) {
                    Plain("查看课程内容", 12.5.sp, Ink.muted)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        linked.forEach { c ->
                            val ct = tone(toneIndex(c.id))
                            Surface({ onOpen(c.id) }, shape = RoundedCornerShape(Tokens.Radius.pill.dp), color = ct.bg, border = BorderStroke(1.dp, ct.border)) {
                                Plain(c.name, 13.sp, ct.fg, FontWeight.Medium, Modifier.padding(horizontal = 10.dp, vertical = 6.dp))
                            }
                        }
                    }
                }
                val planned = relations.nodes.filter { it.code !in compiledByCode }
                if (planned.isNotEmpty()) {
                    Plain("${planned.size} 门课程暂未收录内容 ${if (showPlanned) "▴" else "▾"}", 12.sp, Ink.muted, modifier = Modifier.clickable { showPlanned = !showPlanned }.padding(vertical = 5.dp))
                    if (showPlanned) Plain(planned.joinToString("、") { it.name }, 13.sp, Ink.muted)
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
                            shape = RoundedCornerShape(Tokens.Radius.card.dp),
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
    filterDraft?.let { draft ->
        PlainSheet("筛选课程", { filterDraft = null }) {
            Column(Modifier.verticalScroll(rememberScrollState()).weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    KnowledgeSelect("入学年份", draft.cohort, cohorts.map { it to "$it 级" }, Modifier.weight(1f)) { cohort ->
                        val validMajors = courseMajors(curriculum, cohort)
                        val nextMajor = if (draft.inheritMajor) catalogScope(curriculum, person?.grade, person?.major, cohort, null).second else draft.major.takeIf { it in validMajors } ?: "全部专业"
                        filterDraft = draft.copy(cohort = cohort, major = nextMajor, inheritCohort = false)
                    }
                    KnowledgeSelect("专业", draft.major, courseMajors(curriculum, draft.cohort).map { it to it }, Modifier.weight(1f)) { filterDraft = draft.copy(major = it, inheritMajor = false) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    KnowledgeSelect("学年", draft.grade, GRADE_OPTIONS.map { it.first to if (it.first == "全部") "全部学年" else it.first }, Modifier.weight(1f)) { filterDraft = draft.copy(grade = it) }
                    KnowledgeSelect("课程类别", draft.category, listOf("全部", "专业基础课", "专业课", "通识教育课").map { it to it }, Modifier.weight(1f)) { filterDraft = draft.copy(category = it) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    KnowledgeSelect("修读要求", draft.nature, listOf("全部", "必修", "限选").map { it to it }, Modifier.weight(1f)) { filterDraft = draft.copy(nature = it) }
                    Spacer(Modifier.weight(1f))
                }
            }
            Row(Modifier.fillMaxWidth().padding(top = 24.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                TextAction("重置", {
                    val defaults = catalogScope(curriculum, person?.grade, person?.major, null, null)
                    filterDraft = KnowledgeFilterDraft(defaults.first, defaults.second, "全部", "全部", "全部", true, true)
                }, muted = true)
                Spacer(Modifier.weight(1f))
                TextAction("取消", { filterDraft = null }, muted = true)
                ActionButton("应用筛选", go = true) {
                    val next = route.knowledgeFilters - setOf("cohort", "major", "grade", "category", "nature", "focus")
                    val scopeValues = buildMap { if (!draft.inheritCohort) put("cohort", draft.cohort); if (!draft.inheritMajor) put("major", draft.major) }
                    val advancedValues = mapOf("grade" to draft.grade, "category" to draft.category, "nature" to draft.nature).filterValues { it != "全部" }
                    route.knowledgeFilters = next + scopeValues + advancedValues
                    filterDraft = null
                }
            }
        }
    }
}

@Composable private fun KnowledgeSelect(label: String, value: String, options: List<Pair<String, String>>, modifier: Modifier = Modifier, onChange: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val selectedLabel = options.firstOrNull { it.first == value }?.second ?: value
    Column(modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Plain(label, 11.sp, Ink.muted)
        Box {
            Surface(onClick = { expanded = true }, modifier = Modifier.semantics { contentDescription = "$label：$selectedLabel" }, shape = RoundedCornerShape(Tokens.Radius.control.dp), color = Ink.paper, border = BorderStroke(1.dp, Ink.line)) {
                Row(Modifier.fillMaxWidth().heightIn(min = 40.dp).padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    Plain(selectedLabel, 13.sp, Ink.text, modifier = Modifier.weight(1f), maxLines = 1)
                    Plain("▾", 12.sp, Ink.muted)
                }
            }
            DropdownMenu(expanded, { expanded = false }, containerColor = Ink.paper) {
                options.forEach { (key, text) -> DropdownMenuItem({ Plain(text, 14.sp) }, { expanded = false; onChange(key) }) }
            }
        }
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
    readMaterial: suspend (String) -> String?,
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
            key(topic.id, path) { ReferenceGroup(path, refs, index.materials.firstOrNull { it.path == path }, ct, readMaterial) { anchor -> onOpen(null, path, anchor) } }
        }
    }

    var moreRelations by remember(topic.id) { mutableStateOf(false) }
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
        Plain("相关知识点", 16.sp, ct.fg, FontWeight.SemiBold, Modifier.padding(top = 8.dp))
        DocText(miniDoc)
        if (topic.requires.isNotEmpty()) {
            Plain("先要懂", 13.sp, Ink.muted)
            (if (moreRelations) topic.requires else topic.requires.take(5)).forEach { id -> KeyRow(null, titleOf(id), color = ct.fg, chevron = true, onClick = { onOpen(id, null, null) }) }
        }
        if (topic.leads_to.isNotEmpty()) {
            Plain("用到它的", 13.sp, Ink.muted)
            (if (moreRelations) topic.leads_to else topic.leads_to.take(5)).forEach { id -> KeyRow(null, titleOf(id), color = ct.fg, chevron = true, onClick = { onOpen(id, null, null) }) }
        }
        if (topic.requires.size > 5 || topic.leads_to.size > 5) Plain(if (moreRelations) "收起" else "展开全部相关知识点", 13.sp, Ink.brand, modifier = Modifier.clickable { moreRelations = !moreRelations }.padding(vertical = 8.dp))
    }
}

private data class ReferencePreview(val title: String, val context: String, var excerpt: String = "")

private fun referencePreviews(blocks: List<JsonObject>): Map<String, ReferencePreview> {
    val found = mutableMapOf<String, ReferencePreview>()
    val headings = mutableListOf<Pair<Int, String>>()
    var current: ReferencePreview? = null
    for (keyed in blocks) {
        val block = keyed["block"] as? JsonObject ?: continue
        when (block["type"]?.jsonPrimitive?.content) {
            "heading" -> {
                val level = block["level"]?.jsonPrimitive?.int ?: 1
                while (headings.isNotEmpty() && headings.last().first >= level) headings.removeAt(headings.lastIndex)
                val title = plainInlines(block["inlines"] as? JsonArray)
                current = ReferencePreview(title, headings.filter { it.first > 1 }.joinToString(" › ") { it.second })
                found[block.getValue("anchor").jsonPrimitive.content] = current
                headings += level to title
            }
            "paragraph" -> current?.let { preview -> if (preview.excerpt.isEmpty()) {
                val text = plainInlines(block["inlines"] as? JsonArray).trim()
                if (Regex("^(?:答案|参考解答|订正|补充|知识点)(?:[：:（(]|$)").containsMatchIn(text)) current = null
                else if (text.isNotEmpty()) preview.excerpt = text.removePrefix("题干：").removePrefix("题干:").trim().take(160)
            } }
        }
    }
    return found
}

@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
@Composable private fun ReferenceGroup(path: String, refs: List<MaterialRef>, material: KnowledgeMaterial?, ct: Tone, readMaterial: suspend (String) -> String?, onOpen: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    var previewError by remember(path) { mutableStateOf(false) }
    var attempt by remember(path) { mutableIntStateOf(0) }
    val previews by produceState<Map<String, ReferencePreview>>(emptyMap(), path, attempt) {
        previewError = false
        val source = try { readMaterial(path) } catch (e: CancellationException) { throw e } catch (_: IOException) { null }
        if (source != null) value = referencePreviews(Docs.read(source)) else previewError = true
    }
    Column(Modifier.fillMaxWidth().bottomHairline(Ink.line).padding(bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
            Plain(material?.title ?: "课程资料", 14.sp, Ink.text, FontWeight.Medium, Modifier.weight(1f))
            Plain("${refs.size} 处", 12.sp, Ink.muted)
        }
        if (refs.size > 3) Plain(if (expanded) "收起" else "展开全部 ${refs.size} 处", 13.sp, Ink.brand, modifier = Modifier.clickable { expanded = !expanded }.padding(vertical = 8.dp))
        if (previewError) KeyRow(null, "题干预览暂时无法加载", trailing = { TextAction("重试", { attempt++ }, refresh = true) })
        (if (expanded) refs else refs.take(3)).forEach { ref ->
            val preview = previews[ref.anchor]
            val title = preview?.let { listOf(it.context, it.title).filter(String::isNotBlank).joinToString(" · ") } ?: ref.heading
            Box(Modifier.semantics { testTagsAsResourceId = true }.testTag("knowledge-reference:$path#${ref.anchor}")) {
                KeyRow(null, title, preview?.excerpt?.takeIf(String::isNotBlank), color = ct.fg, chevron = true, onClick = { onOpen(ref.anchor) })
            }
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
                    shape = RoundedCornerShape(Tokens.Radius.card.dp),
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
