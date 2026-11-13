package top.hicancan.studev.world

import kotlinx.serialization.json.*
import java.time.LocalDate
import top.hicancan.studev.data.AcademicRepository
import top.hicancan.studev.me.TaskStore
import top.hicancan.studev.navigation.*
import top.hicancan.studev.search.NativeSearch
import top.hicancan.studev.map.Find

/** A task drafted, to be confirmed; [call] is the tool call that drafted it, so it shows in that answer. */
data class TaskProposal(val task: Task, val id: String? = null, val expected: String? = null, val key: String = java.util.UUID.randomUUID().toString(), val call: String = "")

/** Device-local tools over the same interpreters and immutable kernels as the visual entries. */
/** A building as said, as the room data writes it: 教三楼 → 教3, as buildingWord in src/campus/world/campusTools.ts. */
fun buildingWord(said: String): String = said.trim().map { c -> "一二三四五六七八九".indexOf(c).let { if (it >= 0) ('1' + it) else c } }.joinToString("").let { if (it.length > 1 && it.endsWith("楼")) it.dropLast(1) else it }

/** Where a search looks, by the name a person gives it: the search page's channels, src/campus/world/channels.json. */
data class Channel(val id: String, val label: String, val sources: List<String> = emptyList(), val excluded: List<String> = emptyList(), val dated: Boolean = false) {
    companion object {
        fun load(context: android.content.Context) = Json.parseToJsonElement(context.assets.open("world/channels.json").bufferedReader().use { it.readText() }).jsonArray.map { item ->
            val row = item.jsonObject; fun list(key: String) = row[key]?.jsonArray?.map { it.jsonPrimitive.content }.orEmpty()
            Channel(row.getValue("id").jsonPrimitive.content, row.getValue("label").jsonPrimitive.content, list("sources"), list("excluded"), row["dated"]?.jsonPrimitive?.boolean ?: false)
        }
    }
}

class CampusTools(private val context: android.content.Context, private val repository: () -> AcademicRepository?, private val line: () -> CampusLine?, private val tasks: TaskStore,
    private val remember: (String) -> Unit, private val propose: (TaskProposal) -> Unit) : AutoCloseable {
    private val channels by lazy { Channel.load(context) }
    private var search: NativeSearch? = null
    private var wayfind: Wayfind? = null
    private var places: top.hicancan.studev.data.CampusPackage? = null
    var definitions: List<JsonObject> = emptyList()
    fun arguments(name: String, args: JsonObject): JsonObject {
        val schema = definitions.firstOrNull { it.getValue("function").jsonObject.getValue("name").jsonPrimitive.content == name }?.getValue("function")?.jsonObject?.getValue("parameters")?.jsonObject ?: error("未知工具。")
        val fields = schema.getValue("properties").jsonObject
        require(args.keys.all { it in fields } && schema["required"]?.jsonArray.orEmpty().all { it.jsonPrimitive.content in args }) { "工具参数不完整。" }
        args.forEach { (key, value) ->
            val field = fields.getValue(key).jsonObject; val primitive = value as? JsonPrimitive ?: error("工具参数无效。")
            when (field.getValue("type").jsonPrimitive.content) {
                "string" -> require(primitive.isString && primitive.content.length <= 2000) { "文字参数无效。" }
                "integer" -> require(!primitive.isString && primitive.intOrNull?.let { it >= (field["minimum"]?.jsonPrimitive?.int ?: 0) && it <= (field["maximum"]?.jsonPrimitive?.int ?: 1440) } == true) { "时间或用时范围无效。" }
                "boolean" -> require(!primitive.isString && primitive.booleanOrNull != null) { "状态参数无效。" }
            }
            field["enum"]?.jsonArray?.let { allowed -> require(allowed.any { it.jsonPrimitive.content == primitive.content }) { "选项无效。" } }
        }
        return args
    }
    suspend fun execute(name: String, raw: JsonObject, call: String = ""): JsonElement {
        val args = arguments(name, raw)
        if (name == "search") {
            val repo = repository() ?: error("校园数据还没准备好。")
            val channel = channels.firstOrNull { it.label == (args["in"]?.jsonPrimitive?.content ?: "全部") } ?: error("没有这个搜索范围。")
            val engine = search ?: NativeSearch({ path -> repo.bytes("search/$path") }, { pack, mirror, offset, length -> repo.block("search/$pack", mirror, offset, length) }).also { search = it }
            val filters = buildJsonObject { if (channel.sources.isNotEmpty()) put("sourceIds", JsonArray(channel.sources.map(::JsonPrimitive))); if (channel.excluded.isNotEmpty()) put("excludedSourceIds", JsonArray(channel.excluded.map(::JsonPrimitive))) }
            return JsonArray(engine.page(args.getValue("query").jsonPrimitive.content, 6, filters = filters).results.map { result -> buildJsonObject {
                put("id", result.getValue("id")); put("title", result.getValue("title")); result["sourceName"]?.let { put("source", it) }
                result["publishedAt"]?.jsonPrimitive?.contentOrNull?.let { put("date", it.take(10)) }
                result["snippet"]?.let { put("snippet", it) }; put("url", result.getValue("url"))
            } })
        }
        if (name == "read") {
            val repo = repository() ?: error("校园数据还没准备好。")
            val id = args.getValue("id").jsonPrimitive.content
            require(Regex("[0-9a-f]{16}").matches(id)) { "这条不是文章，课程、教室、地点请用对应的方式查。" }
            val doc = Json.parseToJsonElement(repo.bytes("texts/${id.take(2)}.json").decodeToString()).jsonObject[id]?.jsonObject ?: error("找不到这篇资料。")
            val text = doc.getValue("text").jsonPrimitive.content
            return buildJsonObject {
                put("title", doc.getValue("title")); put("source", doc.getValue("source"))
                doc["published"]?.jsonPrimitive?.contentOrNull?.let { put("date", it.take(10)) }
                put("url", doc.getValue("url")); put("text", text.take(READ).ifEmpty { "这篇的正文没有收录，内容在附件里：把原文链接和附件给对方，不用再找。" })
                if (text.length > READ) put("cut", true)
                put("files", JsonArray(doc.getValue("files").jsonArray.take(10)))
            }
        }
        if (name == "find_place") {
            val campus = places ?: top.hicancan.studev.data.CampusPackage.load(context.assets).also { places = it }
            return JsonArray(Find.places(campus.places, args.getValue("query").jsonPrimitive.content).map { said(campus, it) })
        }
        if (name == "nearby") {
            val campus = places ?: top.hicancan.studev.data.CampusPackage.load(context.assets).also { places = it }
            val at = Find.meant(campus.places, campus.byId, args.getValue("near").jsonPrimitive.content)
            return buildJsonObject {
                put("near", nameOf(at))
                put("places", JsonArray(Find.around(campus.places, campus.byId, at, args.getValue("what").jsonPrimitive.content).map { (place, metres) -> JsonObject(said(campus, place) + ("metres" to JsonPrimitive(metres))) }))
            }
        }
        if (name == "remember") { remember(args.getValue("fact").jsonPrimitive.content); return buildJsonObject { put("remembered", true) } }
        if (name == "free_rooms") {
            val repo = repository() ?: error("校园数据还没准备好。")
            val date = date(args.getValue("date").jsonPrimitive.content); val index = repo.rooms(); val day = repo.roomDay(index.term, date.toString())
            if (day == null) return buildJsonObject { put("date", date.toString()); put("known", false); put("rooms", JsonArray(emptyList())) }
            val reader = RoomReader(repo.periods()); val min = args.getValue("minute").jsonPrimitive.int; val minutes = args.getValue("minutes").jsonPrimitive.int
            val rooms = index.rooms.filter(RoomReader::classroom).filter { args["building"]?.jsonPrimitive?.content?.let { said -> it.building.contains(buildingWord(said)) } ?: true }
                .map { it.id to reader.at(day, it.id, min) }.filter { !it.second.busy && it.second.minutes >= minutes }.sortedWith(compareByDescending<Pair<String, RoomState>> { it.second.minutes }.thenBy { it.first }).take(12)
            return buildJsonObject { put("date", date.toString()); put("known", true); put("rooms", JsonArray(rooms.map { (room, state) -> buildJsonObject { put("room", room); put("until", state.until); put("minutes", state.minutes) } })) }
        }
        if (name == "route") {
            val campus = places ?: top.hicancan.studev.data.CampusPackage.load(context.assets).also { places = it }
            val from = Find.meant(campus.places, campus.byId, args.getValue("from").jsonPrimitive.content)
            val to = Find.meant(campus.places, campus.byId, args.getValue("to").jsonPrimitive.content)
            val engine = wayfind ?: Wayfind.load(context.assets).also { wayfind = it }
            val route = engine.route(RouteRequest(from.routing, to.routing, args["mode"]?.jsonPrimitive?.content ?: "walk", alternatives = 1)).firstOrNull() ?: error("地图里没有从${nameOf(from)}到${nameOf(to)}的路。")
            return buildJsonObject { put("from", nameOf(from)); put("to", nameOf(to)); put("distance_m", kotlin.math.round(route.distance_m).toLong()); put("duration_s", kotlin.math.round(route.duration_s).toLong()); put("steps", JsonArray(route.maneuvers.map { JsonPrimitive(it.instruction) })); put("url", "/map/?from=${java.net.URLEncoder.encode(from.id, "UTF-8")}&nav=${java.net.URLEncoder.encode(to.id, "UTF-8")}") }
        }
        val current = line() ?: error("请先选择班级，等待课表读取完成。")
        return when (name) {
            "timeline" -> timeline(current, args.getValue("from").jsonPrimitive.content, args.getValue("to").jsonPrimitive.content)
            "exams" -> exams(current, CampusDay.now().toLocalDate())
            "list_tasks" -> Json.encodeToJsonElement(TaskStore.live(tasks.all.value))
            "suggest_slots" -> slots(current, args, Moment.of(CampusDay.now()))
            "propose_task" -> proposal(args, current).copy(call = call).let { item -> propose(item); buildJsonObject { put("state", "awaiting_user_confirmation"); put("proposal", item.key); put("task", JsonObject(Json.encodeToJsonElement(item.task).jsonObject - "id" - "modified")) } }
            else -> error("未知工具。")
        }
    }
    /** What a place is called when said alone: a room with its building (教3-302), anything else by its name. */
    private fun nameOf(place: top.hicancan.studev.data.Place) = if (place.kind == "room") place.id.substringAfter('/') else place.names.firstOrNull() ?: place.id
    /** A place as the model is told it: what it is, where, and whether it is open now. */
    private fun said(campus: top.hicancan.studev.data.CampusPackage, place: top.hicancan.studev.data.Place): JsonObject {
        val now = CampusDay.now(); val parent = place.parent?.let(campus.byId::get)
        val hours = top.hicancan.studev.map.Recommendations.hoursAt(place.hours, now.dayOfWeek.value, now.hour * 60 + now.minute)
        return buildJsonObject {
            put("id", place.id); put("name", nameOf(place)); place.category?.let { put("category", it) }
            put("where", when { parent == null -> "校外"; parent.kind == "campus" -> "校内"; else -> "${parent.names.firstOrNull() ?: parent.id}里" })
            if (hours.open != top.hicancan.studev.map.Recommendations.Open.Unknown && hours.today == "00:00–24:00") { put("today", "全天"); put("now", "24 小时开放") }
            else if (hours.open != top.hicancan.studev.map.Recommendations.Open.Unknown) { put("today", hours.today); put("now", when (hours.open) { top.hicancan.studev.map.Recommendations.Open.Closed -> "已关闭"; top.hicancan.studev.map.Recommendations.Open.Closing -> "快关门了，${hours.closesAt} 关"; else -> "开着，${hours.closesAt} 关" }) }
        }
    }
    override fun close() { search?.close(); wayfind?.close() }
    companion object {
        /** How much of an article the model reads at once, as READ in src/campus/world/campusTools.ts. */
        private const val READ = 8000
        fun date(value: String): LocalDate { require(Regex("\\d{4}-\\d{2}-\\d{2}").matches(value)) { "日期无效。" }; return LocalDate.parse(value) }
        /** Said as people say it, as toolDay in src/campus/world/tools.ts: 11月16日 周一, 08:00–09:35. */
        private fun toolDay(day: LocalDate) = "${dateLabel(day)} ${WEEKDAYS[day.dayOfWeek.value]}"
        private val KINDS = mapOf("class" to "课", "lab" to "实验", "exam" to "考试", "run" to "早锻炼", "task" to "任务")
        private val AVOID = mapOf("must" to "必须避开", "prefer" to "尽量避开", "allow" to "可以重叠")
        fun timeline(line: CampusLine, from: String, to: String): JsonArray {
            val start = date(from); val end = date(to); val days = CampusLine.daysBetween(start, end)
            require(days in 0..13) { "一次最多查询14天。" }
            return JsonArray((0..days).map { offset -> val day = start.plusDays(offset.toLong()); buildJsonObject {
                put("date", day.toString()); put("day", toolDay(day))
                put("events", JsonArray(line.on(day).map { event -> buildJsonObject { if (event.task != null) put("task", event.id); put("kind", KINDS.getValue(event.kind)); put("name", event.name); put("time", "${hm(event.start)}–${hm(event.end)}"); put("room", event.room); event.avoid?.let { put("avoid", AVOID.getValue(it)) } } }))
                put("due", JsonArray(line.dueOn(day).map { task -> val due = task.due!!; buildJsonObject { put("task", task.id); put("title", task.title); put("when", "${toolDay(LocalDate.parse(due.date))} ${due.time?.let(::hm) ?: "当天"}"); put("done", task.done != null) } }))
            } })
        }
        /** Every exam of the term one sits, as readExams in src/campus/world/tools.ts. */
        fun exams(line: CampusLine, today: LocalDate): JsonObject {
            val exams = line.exams.sortedWith(compareBy({ it.date }, { it.start })).map { exam -> buildJsonObject {
                put("course", exam.course.name); put("day", toolDay(LocalDate.parse(exam.date))); put("time", "${exam.start}–${exam.end}"); put("room", exam.location)
                if (exam.date < today.toString()) put("done", true)
            } }
            return buildJsonObject { put("exams", JsonArray(exams)); if (exams.isEmpty()) put("note", "学校还没有发布这学期你的考试安排。") }
        }
        fun slots(line: CampusLine, args: JsonObject, now: Moment): JsonArray {
            val from = date(args.getValue("from").jsonPrimitive.content); val to = date(args.getValue("to").jsonPrimitive.content)
            require(CampusLine.daysBetween(from, to) in 0..13) { "一次最多排14天。" }
            val id = args["task_id"]?.jsonPrimitive?.content; val task = id?.let { line.tasks.find { task -> task.id == it && task.deleted != true } }
            require(id == null || task != null) { "要移动的任务不存在。" }
            return JsonArray(Planning.available(line, SlotRequest(from, to, args.getValue("minutes").jsonPrimitive.int, exclude = id, due = task?.due), now).take(12).map { slot -> buildJsonObject { put("date", slot.date.toString()); put("start", slot.start); put("end", slot.end); put("day", toolDay(slot.date)); put("time", "${hm(slot.start)}–${hm(slot.end)}"); put("overlaps", slot.clashes.size) } })
        }
        fun proposal(args: JsonObject, line: CampusLine): TaskProposal {
            val id = args["id"]?.jsonPrimitive?.content; val old = id?.let { line.tasks.find { task -> task.id == it && task.deleted != true } }
            require(id == null || old != null) { "要修改的任务不存在。" }
            var task = (old ?: Task("proposal", "", modified = "proposal")).copy(title = args.getValue("title").jsonPrimitive.content.trim().take(200))
            if (args["date"] != null) task = task.copy(date = date(args.getValue("date").jsonPrimitive.content).toString(), start = args["start"]?.jsonPrimitive?.int, end = args["end"]?.jsonPrimitive?.int)
            else task = task.copy(start = args["start"]?.jsonPrimitive?.int ?: task.start, end = args["end"]?.jsonPrimitive?.int ?: task.end)
            if (args["due_date"] != null) task = task.copy(due = (task.due ?: TaskDeadline("")).copy(date = date(args.getValue("due_date").jsonPrimitive.content).toString(), time = args["due_time"]?.jsonPrimitive?.int ?: task.due?.time))
            else if (args["due_time"] != null) { require(task.due != null) { "请先给出截止日期。" }; task = task.copy(due = task.due!!.copy(time = args.getValue("due_time").jsonPrimitive.int)) }
            if (args["note"] != null) task = task.copy(note = args.getValue("note").jsonPrimitive.content.trim().take(4000).ifEmpty { null })
            if (args["done"] != null) task = task.copy(done = if (args.getValue("done").jsonPrimitive.boolean) "awaiting-confirmation" else null)
            require(task.title.isNotEmpty() && (task.date == null) == (task.start == null) && (task.end == null || task.start != null && task.end!! > task.start!!)) { "执行安排需要有效日期、开始和结束；截止请单独指定。" }
            return TaskProposal(task, old?.id, old?.modified)
        }
    }
}
