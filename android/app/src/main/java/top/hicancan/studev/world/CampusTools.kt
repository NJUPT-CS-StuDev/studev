package top.hicancan.studev.world

import kotlinx.serialization.json.*
import java.time.LocalDate
import top.hicancan.studev.data.AcademicRepository
import top.hicancan.studev.me.TaskStore
import top.hicancan.studev.navigation.*
import top.hicancan.studev.search.NativeSearch

data class TaskProposal(val task: Task, val id: String? = null, val expected: String? = null, val key: String = java.util.UUID.randomUUID().toString())

/** Device-local tools over the same interpreters and immutable kernels as the visual entries. */
/** A building as said, as the room data writes it: 教三楼 → 教3, as buildingWord in src/campus/world/campusTools.ts. */
fun buildingWord(said: String): String = said.trim().map { c -> "一二三四五六七八九".indexOf(c).let { if (it >= 0) ('1' + it) else c } }.joinToString("").let { if (it.length > 1 && it.endsWith("楼")) it.dropLast(1) else it }

class CampusTools(private val context: android.content.Context, private val repository: () -> AcademicRepository?, private val line: () -> CampusLine?, private val tasks: TaskStore, private val propose: (TaskProposal) -> Unit) : AutoCloseable {
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
    suspend fun execute(name: String, raw: JsonObject): JsonElement {
        val args = arguments(name, raw)
        if (name == "campus_search") {
            val repo = repository() ?: error("校园数据还没准备好。")
            val engine = search ?: NativeSearch({ path -> repo.bytes("search/$path") }, { pack, mirror, offset, length -> repo.block("search/$pack", mirror, offset, length) }).also { search = it }
            return JsonArray(engine.page(args.getValue("query").jsonPrimitive.content, 6).results.map { result -> buildJsonObject { for (key in listOf("id", "title", "url", "sourceName", "snippet", "attachments")) result[key]?.let { put(key, it) } } })
        }
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
            val from = campus.byId[args.getValue("from").jsonPrimitive.content] ?: error("请先搜索确认地图地点。")
            val to = campus.byId[args.getValue("to").jsonPrimitive.content] ?: error("请先搜索确认地图地点。")
            val engine = wayfind ?: Wayfind.load(context.assets).also { wayfind = it }
            val routes = engine.route(RouteRequest(from.routing, to.routing, args["mode"]?.jsonPrimitive?.content ?: "walk", alternatives = 1))
            return buildJsonObject { put("routes", JsonArray(routes.map { route -> buildJsonObject { put("distance_m", route.distance_m); put("duration_s", route.duration_s); put("steps", JsonArray(route.maneuvers.map { JsonPrimitive(it.instruction) })) } })); put("url", "/map/?from=${java.net.URLEncoder.encode(from.id, "UTF-8")}&nav=${java.net.URLEncoder.encode(to.id, "UTF-8")}") }
        }
        val current = line() ?: error("请先选择班级，等待课表读取完成。")
        return when (name) {
            "timeline" -> timeline(current, args.getValue("from").jsonPrimitive.content, args.getValue("to").jsonPrimitive.content)
            "list_tasks" -> Json.encodeToJsonElement(TaskStore.live(tasks.all.value))
            "suggest_slots" -> slots(current, args, Moment.of(CampusDay.now()))
            "propose_task" -> proposal(args, current).let { item -> propose(item); buildJsonObject { put("state", "awaiting_user_confirmation"); put("proposal", item.key); put("task", JsonObject(Json.encodeToJsonElement(item.task).jsonObject - "id" - "modified")) } }
            else -> error("未知工具。")
        }
    }
    override fun close() { search?.close(); wayfind?.close() }
    companion object {
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
