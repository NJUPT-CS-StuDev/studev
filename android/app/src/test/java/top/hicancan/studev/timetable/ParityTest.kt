package top.hicancan.studev.timetable

import java.io.File
import java.time.LocalDate
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import top.hicancan.studev.data.*
import top.hicancan.studev.map.Labels
import top.hicancan.studev.map.Recommendations
import top.hicancan.studev.timetable.ExamAttendance
import top.hicancan.studev.world.*

/** Every expectation comes from src/campus/world/parity/golden.json, written by the web code. */
class ParityTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val golden = generateSequence(File(checkNotNull(System.getProperty("user.dir"))).canonicalFile) { it.parentFile }
        .map { File(it, "src/campus/world/parity/golden.json") }.first { it.isFile }
        .let { json.parseToJsonElement(it.readText()).jsonObject }
    private val term = json.decodeFromJsonElement<TeachingTerm>(golden.getValue("term"))
    private val periods = json.decodeFromJsonElement<List<TeachingPeriod>>(golden.getValue("periods"))
    private val holidays = CampusLine.holidays(json.decodeFromJsonElement<List<CalendarTerm>>(golden.getValue("calendar")))
    private val run = RunPlan(json.decodeFromJsonElement<MorningRun>(golden.getValue("run")), json.decodeFromJsonElement<List<String>>(golden.getValue("runDays")), 5)
    private val line = CampusLine(term, periods, json.decodeFromJsonElement(golden.getValue("schedules").jsonArray[0].jsonObject.getValue("meetings")), emptyList(), emptyList(), holidays, run)
    @Test fun settingsSyncMatches() {
        val test = golden.getValue("settingsSync").jsonObject
        fun settings(value: JsonObject): top.hicancan.studev.me.PersonalSettings = value.entries.filter { it.key != "modified" }
            .fold(top.hicancan.studev.me.PersonalSettings()) { s, (key, part) -> top.hicancan.studev.me.CampusSettings.take(s, key, part) }
            .copy(modified = value["modified"]?.let { json.decodeFromJsonElement<Map<String, String>>(it) }.orEmpty())
        val initial = top.hicancan.studev.me.CampusSettings.initial(settings(test.getValue("original").jsonObject))
        assertEquals(test.getValue("initial"), top.hicancan.studev.me.Sync.partsOf(initial))
        assertEquals(test.getValue("merged"), top.hicancan.studev.me.Sync.mergeSettings(test.getValue("initial").jsonObject, test.getValue("theirs").jsonObject))
        assertEquals(settings(test.getValue("taken").jsonObject), top.hicancan.studev.me.Sync.taken(initial, test.getValue("merged").jsonObject))
    }
    @Test fun ownProviderAddressesMatch() {
        golden.getValue("assistant").jsonObject.getValue("addresses").jsonArray.forEach { item ->
            val test = item.jsonObject; val base = test.getValue("base").jsonPrimitive.content
            assertEquals(test.getValue("endpoint").jsonPrimitive.content, top.hicancan.studev.ai.Models.endpoint(base))
            assertEquals(test.getValue("invalid").jsonPrimitive.boolean, top.hicancan.studev.ai.Models.addressError(base) != null)
        }
    }
    private fun brief(event: LineEvent) = buildJsonObject {
        put("kind", event.kind); put("name", event.name); put("short", event.short); put("start", event.start); put("end", event.end); put("room", event.room)
    }
    @Test fun openingStatesMatch() {
        golden.getValue("hoursCases").jsonArray.forEach { case ->
            val row = case.jsonObject
            val hours = json.decodeFromJsonElement<OpeningHours>(row.getValue("hours"))
            assertEquals(row.toString(), row.getValue("state").jsonPrimitive.content, Recommendations.status(hours, row.getValue("day").jsonPrimitive.int, row.getValue("minute").jsonPrimitive.int).name.lowercase())
        }
    }
    @Test fun recommendationsMatch() {
        val places = json.decodeFromJsonElement<List<Place>>(golden.getValue("places"))
        val from = json.decodeFromJsonElement<List<Double>>(golden.getValue("from"))
        golden.getValue("recommend").jsonArray.forEach { case ->
            val row = case.jsonObject
            val got = Recommendations.of(places, row.getValue("day").jsonPrimitive.int, row.getValue("hour").jsonPrimitive.int * 60 + row.getValue("minute").jsonPrimitive.int, from)
            assertEquals(row.toString(), row.getValue("expected").jsonArray.map { it.jsonObject.getValue("id").jsonPrimitive.content to it.jsonObject.getValue("state").jsonPrimitive.content }, got.map { it.place.id to it.status.name.lowercase() })
        }
    }
    @Test fun labelsMatch() {
        val labels = golden.getValue("labels").jsonObject
        val byId = json.decodeFromJsonElement<List<Place>>(labels.getValue("entities")).associateBy { it.id }
        fun rule(value: JsonElement) = (value as? JsonObject)?.let { Labels.Rule(it.getValue("minZoom").jsonPrimitive.double, it.getValue("priority").jsonPrimitive.int) }
        labels.getValue("cases").jsonArray.forEach { case ->
            val row = case.jsonObject; val place = byId.getValue(row.getValue("id").jsonPrimitive.content)
            assertEquals(row.toString(), rule(row.getValue("rule")), Labels.rule(place, byId))
            if (place.kind == "building") assertEquals(row.toString(), rule(row.getValue("teaching")), Labels.rule(place, byId, true))
        }
    }
    @Test fun attendanceDeadlineAndPlanningSemanticsMatch() {
        val s = golden.getValue("semantics").jsonObject
        val tasks = json.decodeFromJsonElement<List<Task>>(golden.getValue("tasks").jsonObject.getValue("list"))
        s.getValue("dueReminders").jsonArray.forEach { item ->
            val row = item.jsonObject
            val task = tasks.first { it.id == row.getValue("id").jsonPrimitive.content }
            val at = Tasks.reminderAt(task, row.getValue("remind").jsonPrimitive.int, "due")!!
            assertEquals(row.getValue("at").jsonObject.getValue("date").jsonPrimitive.content, at.first.toString())
            assertEquals(row.getValue("at").jsonObject.getValue("min").jsonPrimitive.int, at.second)
        }
        val labs = golden.getValue("labs").jsonObject
        val labList = json.decodeFromJsonElement<List<Lab>>(labs.getValue("labs"))
        s.getValue("frames").jsonArray.forEach { item ->
            val row = item.jsonObject
            val personal = CampusLine(term, periods, json.decodeFromJsonElement(labs.getValue("meetings")), labList, listOf(json.decodeFromJsonElement<Exam>(labs.getValue("exam"))), holidays, null, json.decodeFromJsonElement(row.getValue("tasks")))
            val frame = CampusLine.timeBounds(personal.on(LocalDate.parse(s.getValue("scheduleDate").jsonPrimitive.content)))
            assertEquals(row.getValue("expected").jsonArray.map { it.jsonPrimitive.int }, listOf(frame.first, frame.second))
        }
        val hidden = golden.getValue("courses").jsonObject.getValue("hidden").jsonObject
        val hiddenLine = CampusLine(term, periods, json.decodeFromJsonElement(hidden.getValue("meetings")), labList, listOf(json.decodeFromJsonElement<Exam>(labs.getValue("exam"))), holidays, null, names = json.decodeFromJsonElement(hidden.getValue("names")), courseMeetings = json.decodeFromJsonElement(labs.getValue("meetings")))
        val hiddenEvents = hiddenLine.on(LocalDate.parse(hidden.getValue("date").jsonPrimitive.content))
        assertEquals(hidden.getValue("events"), JsonArray(hiddenEvents.map { event -> JsonObject(brief(event) + mapOf("id" to JsonPrimitive(event.id), "lab" to (event.lab?.let { JsonPrimitive(it.id) } ?: JsonNull))) }))
        assertEquals(json.decodeFromJsonElement<Map<String, Int>>(hidden.getValue("tones")), TimetablePresentation.tones(hiddenLine))
        val at = s.getValue("now").jsonObject
        val now = Moment(LocalDate.parse(at.getValue("date").jsonPrimitive.content), at.getValue("min").jsonPrimitive.int)
        val req = s.getValue("request").jsonObject
        val request = SlotRequest(LocalDate.parse(req.getValue("from").jsonPrimitive.content), LocalDate.parse(req.getValue("to").jsonPrimitive.content), req.getValue("minutes").jsonPrimitive.int, req.getValue("earliest").jsonPrimitive.int, req.getValue("latest").jsonPrimitive.int)
        s.getValue("cases").jsonArray.forEach { item ->
            val row = item.jsonObject
            val preferences = json.decodeFromJsonElement<Map<String, EventPreference>>(row.getValue("preferences"))
            val personal = CampusLine(term, periods, json.decodeFromJsonElement(labs.getValue("meetings")), json.decodeFromJsonElement(labs.getValue("labs")), listOf(json.decodeFromJsonElement<Exam>(labs.getValue("exam"))), holidays, null, preferences = preferences)
            val events = personal.on(LocalDate.parse(s.getValue("scheduleDate").jsonPrimitive.content))
            assertEquals(row.getValue("events"), JsonArray(events.map { event -> buildJsonObject { put("id", event.id); put("avoid", event.avoid); put("layer", event.layer) } }))
            assertEquals(row.getValue("layers"), JsonArray(CampusLine.layers(events).map { buildJsonObject { put("id", it.event.id); put("under", it.under); put("over", it.over) } }))
            val slots = Planning.available(personal, request, now).take(4).map { slot -> buildJsonObject { put("date", slot.date.toString()); put("start", slot.start); put("end", slot.end); put("clashes", JsonArray(slot.clashes.map(::JsonPrimitive))); put("penalty", slot.penalty) } }
            assertEquals(row.getValue("slots"), JsonArray(slots))
        }
    }
    @Test fun aiToolsUseTheSameTimelinePlanningAndTaskProposalContract() {
        val s = golden.getValue("semantics").jsonObject
        val labs = golden.getValue("labs").jsonObject
        val taskLine = CampusLine(term, periods, json.decodeFromJsonElement(labs.getValue("meetings")), json.decodeFromJsonElement(labs.getValue("labs")), listOf(json.decodeFromJsonElement<Exam>(labs.getValue("exam"))), holidays, null, json.decodeFromJsonElement(golden.getValue("tasks").jsonObject.getValue("list")))
        assertEquals(s.getValue("toolTimeline"), CampusTools.timeline(taskLine, "2026-11-09", "2026-11-13"))
        assertEquals(s.getValue("toolSlots"), CampusTools.slots(taskLine, buildJsonObject { put("from", "2026-11-09"); put("to", "2026-11-09"); put("minutes", 30); put("task_id", "b") }, Moment(LocalDate.parse("2026-11-09"), 480)))
        s.getValue("proposals").jsonArray.forEach { item ->
            val row = item.jsonObject; val expected = row.getValue("expected").jsonObject
            val result = CampusTools.proposal(row.getValue("args").jsonObject, taskLine)
            val expectedTask = json.decodeFromJsonElement<Task>(JsonObject(expected.getValue("task").jsonObject + mapOf("id" to JsonPrimitive("proposal"), "modified" to JsonPrimitive("proposal"))))
            assertEquals(expectedTask, result.task.copy(id = "proposal", modified = "proposal"))
            assertEquals(expected["id"]?.jsonPrimitive?.content, result.id)
            assertEquals(expected["expected"]?.jsonPrimitive?.content, result.expected)
        }
    }
    @Test fun tasksStandOnTheLineAndAreGroupedOrderedAndRead() {
        val tasks = golden.getValue("tasks").jsonObject
        val labs = golden.getValue("labs").jsonObject
        val list = json.decodeFromJsonElement<List<Task>>(tasks.getValue("list"))
        val taskLine = CampusLine(term, periods, json.decodeFromJsonElement(labs.getValue("meetings")), json.decodeFromJsonElement(labs.getValue("labs")), listOf(json.decodeFromJsonElement<Exam>(labs.getValue("exam"))), holidays, null, list)
        fun taskBrief(event: LineEvent) = JsonObject(brief(event) + mapOf("id" to JsonPrimitive(event.id), "lab" to (event.lab?.let { JsonPrimitive(it.id) } ?: JsonNull)))
        tasks.getValue("days").jsonArray.forEach { item ->
            val day = item.jsonObject
            val date = LocalDate.parse(day.getValue("date").jsonPrimitive.content)
            assertEquals(day.getValue("events"), JsonArray(taskLine.on(date).map(::taskBrief)))
            assertEquals(day.getValue("due").jsonArray.map { it.jsonPrimitive.content }, taskLine.dueOn(date).map { it.id })
            assertEquals(day.getValue("layers"), JsonArray(CampusLine.layers(taskLine.on(date)).map { buildJsonObject { put("id", it.event.id); put("under", it.under); put("over", it.over) } }))
        }
        val at = tasks.getValue("now").jsonObject
        val now = Moment(LocalDate.parse(at.getValue("date").jsonPrimitive.content), at.getValue("min").jsonPrimitive.int)
        assertEquals(tasks.getValue("groups").jsonArray.map { it.jsonObject.getValue("group").jsonPrimitive.content }, list.map { Tasks.group(it, now) })
        assertEquals(tasks.getValue("order").jsonArray.map { it.jsonPrimitive.content }, list.sortedWith(Tasks.order).map { it.id })
        val reminders = list.flatMap { task -> task.remind.orEmpty().map { remind -> Tasks.reminderAt(task, remind)!!.let { (date, min) -> buildJsonObject { put("id", task.id); put("remind", remind); putJsonObject("at") { put("date", date.toString()); put("min", min) } } } } }
        assertEquals(tasks.getValue("reminders"), JsonArray(reminders))
        val manual = list.mapIndexed { at, task -> if (at == 2) task.copy(order = 1.0) else if (at == 3) task.copy(order = 0.0) else task }
        assertEquals(tasks.getValue("manual").jsonArray.map { it.jsonPrimitive.content }, manual.sortedWith(Tasks.order).map { it.id })
        tasks.getValue("moves").jsonArray.forEach { item ->
            val case = item.jsonObject
            val group = case.getValue("group").jsonPrimitive.content
            val shown = case.getValue("shown").jsonArray.map { id -> list.first { it.id == id.jsonPrimitive.content } }
            assertEquals(shown.map { it.id }, list.filter { it.parent == null && it.done == null && Tasks.group(it, now) == group }.sortedWith(Tasks.order).map { it.id })
            val moved = Tasks.move(list.first { it.id == case.getValue("id").jsonPrimitive.content }, group, case.getValue("index").jsonPrimitive.int, shown, now)
            assertEquals(case.toString(), case.getValue("changed").jsonArray.map { json.decodeFromJsonElement<Task>(JsonObject(it.jsonObject + ("modified" to JsonPrimitive("")))) }, moved.map { it.copy(modified = "") })
        }
        tasks.getValue("reportTitles").jsonArray.forEach { item -> assertEquals(item.jsonObject.getValue("title").jsonPrimitive.content, Suggestions.reportTitle(item.jsonObject.getValue("project").jsonPrimitive.content)) }
        tasks.getValue("suggestions").jsonArray.forEach { item ->
            val case = item.jsonObject
            val at = case.getValue("now").jsonObject
            val got = Suggestions.suggest(taskLine, Moment(LocalDate.parse(at.getValue("date").jsonPrimitive.content), at.getValue("min").jsonPrimitive.int), case.getValue("setAside").jsonArray.map { it.jsonPrimitive.content })
            assertEquals(case.toString(), case.getValue("expected").jsonArray.map { it.jsonObject.getValue("key").jsonPrimitive.content }, got.map { it.key })
            assertEquals(case.toString(), case.getValue("expected").jsonArray.map { val task = it.jsonObject.getValue("task").jsonObject; Triple(task.getValue("title").jsonPrimitive.content, task.getValue("course").jsonPrimitive.content, task.getValue("due").jsonObject.getValue("date").jsonPrimitive.content) },
                got.map { Triple(it.task.title, it.task.course, it.task.due!!.date) })
        }
        tasks.getValue("buildings").jsonArray.forEach { item -> assertEquals(item.toString(), item.jsonObject.getValue("word").jsonPrimitive.content, buildingWord(item.jsonObject.getValue("said").jsonPrimitive.content)) }
        val sync = tasks.getValue("sync").jsonObject
        fun tasksOf(key: String) = json.decodeFromJsonElement<List<Task>>(sync.getValue(key))
        assertEquals(tasksOf("merged"), Tasks.merge(tasksOf("mine"), tasksOf("theirs")))
        sync.getValue("stamps").jsonArray.forEach { item -> assertEquals(item.jsonObject.getValue("stamp").jsonPrimitive.content, Tasks.stamp(java.time.Instant.parse(item.jsonObject.getValue("at").jsonPrimitive.content))) }
        val quickCourses = tasks.getValue("courses").jsonArray.map { item -> Tasks.QuickCourse(item.jsonObject.getValue("identity").jsonPrimitive.content, item.jsonObject.getValue("names").jsonArray.map { it.jsonPrimitive.content }) }
        tasks.getValue("parse").jsonArray.forEach { item ->
            val test = item.jsonObject
            val quick = Tasks.parse(test.getValue("input").jsonPrimitive.content, Moment(LocalDate.parse("2026-11-12"), 600), quickCourses)
            val expected = test.getValue("result").jsonObject
            assertEquals(test.toString(), expected.getValue("title").jsonPrimitive.content, quick.title)
            assertEquals(test.toString(), expected["date"]?.jsonPrimitive?.content, quick.date)
            assertEquals(test.toString(), expected["start"]?.jsonPrimitive?.int, quick.start)
            assertEquals(test.toString(), expected["due"]?.let { json.decodeFromJsonElement<TaskDeadline>(it) }, quick.due)
            assertEquals(test.toString(), expected["end"]?.jsonPrimitive?.int, quick.end)
            assertEquals(test.toString(), expected["priority"]?.jsonPrimitive?.int, quick.priority)
            assertEquals(test.toString(), expected["course"]?.jsonPrimitive?.content, quick.course)
            assertEquals(test.toString(), expected.getValue("marks").jsonArray.map { it.jsonArray[0].jsonPrimitive.int to it.jsonArray[1].jsonPrimitive.int }, quick.marks)
        }
    }
    @Test fun ownCoursesBecomeMeetingsAndOwnNamesFollowACourse() {
        val courses = golden.getValue("courses").jsonObject
        val labs = golden.getValue("labs").jsonObject
        val own = json.decodeFromJsonElement<CustomCourse>(courses.getValue("custom"))
        assertEquals(courses.getValue("meetings"), JsonArray(Courses.meetings(own).map { meeting -> buildJsonObject {
            put("id", meeting.id); put("teachingClass", meeting.teaching_class.id); put("name", meeting.course.name); put("weekday", meeting.weekday)
            put("periods", JsonArray(meeting.periods.map(::JsonPrimitive))); put("weeks", JsonArray(meeting.weeks.map(::JsonPrimitive))); put("room", meeting.room)
            put("teachers", JsonArray(meeting.teachers.map { JsonPrimitive(it.name) }))
        } }))
        val names = json.decodeFromJsonElement<Map<String, String>>(courses.getValue("names"))
        val named = Courses.named(CampusLine(term, periods, json.decodeFromJsonElement(labs.getValue("meetings")), json.decodeFromJsonElement(labs.getValue("labs")), listOf(json.decodeFromJsonElement<Exam>(labs.getValue("exam"))), holidays, null), names)
        val expected = courses.getValue("renamed").jsonObject
        fun pairs(key: String) = expected.getValue(key).jsonArray.map { it.jsonObject.getValue("id").jsonPrimitive.content to it.jsonObject.getValue("name").jsonPrimitive.content }
        assertEquals(pairs("meetings"), named.meetings.map { it.id to (Courses.personalName(it.course.code, it.course.name, named.meetings, names) ?: it.course.name) })
        assertEquals(pairs("labs"), named.labs.map { it.id to (Courses.personalName(it.course.code, it.course.name, named.meetings, names) ?: it.course.name) })
        assertEquals(pairs("exams"), named.exams.map { it.id to (Courses.personalName(it.course.code, it.course.name, named.meetings, names) ?: it.course.name) })
        courses.getValue("weeks").jsonArray.forEach { item ->
            val test = item.jsonObject
            assertEquals(test.toString(), (test.getValue("weeks") as? JsonArray)?.map { it.jsonPrimitive.int }, Courses.parseWeeks(test.getValue("text").jsonPrimitive.content, 18))
        }
    }
    @Test fun labsTakeTheirPlaceAmongLessonsAndExams() {
        val labs = golden.getValue("labs").jsonObject
        val meetings = json.decodeFromJsonElement<List<TeachingMeeting>>(labs.getValue("meetings"))
        val classLabs = json.decodeFromJsonElement<List<Lab>>(labs.getValue("labs"))
        val labLine = CampusLine(term, periods, meetings, classLabs, listOf(json.decodeFromJsonElement<Exam>(labs.getValue("exam"))), holidays, null)
        fun labBrief(event: LineEvent) = JsonObject(brief(event) + mapOf("id" to JsonPrimitive(event.id), "lab" to (event.lab?.let { JsonPrimitive(it.id) } ?: JsonNull)))
        val orders = listOf(listOf("exam", "lab", "class", "run"), listOf("class", "run", "exam", "lab"))
        labs.getValue("days").jsonArray.forEach { item ->
            val day = item.jsonObject
            val date = LocalDate.parse(day.getValue("date").jsonPrimitive.content)
            val events = labLine.on(date)
            assertEquals(date.toString(), day.getValue("events"), JsonArray(events.map(::labBrief)))
            assertEquals(day.getValue("alongside").jsonArray.map { row -> row.jsonArray.map { it.jsonPrimitive.content } }, events.map { event -> labLine.overlapping(event).map { it.id } })
            assertEquals(day.getValue("layers"), JsonArray(orders.map { order -> JsonArray(CampusLine.layers(events, order).map { buildJsonObject { put("id", it.event.id); put("under", it.under); put("over", it.over) } }) }))
            assertEquals(day.getValue("clusters"), JsonArray(orders.map { order -> JsonArray(CampusLine.clusters(events, order).map { run ->
                buildJsonObject { put("front", run.front.id); put("events", JsonArray(run.events.map { JsonPrimitive(it.id) })); put("start", run.start); put("end", run.end) } }) }))
        }
        val dayOff = labs.getValue("dayOff").jsonObject
        val off = json.decodeFromJsonElement<Lab>(dayOff.getValue("lab"))
        assertEquals(dayOff.getValue("events"), JsonArray(CampusLine(term, periods, meetings, listOf(off), emptyList(), holidays, null).on(LocalDate.parse(off.date)).map(::labBrief)))
        labs.getValue("moments").jsonArray.forEach { item ->
            val at = item.jsonObject.getValue("now").jsonObject
            assertEquals(item.jsonObject.getValue("next"), labLine.next(Moment(LocalDate.parse(at.getValue("date").jsonPrimitive.content), at.getValue("min").jsonPrimitive.int))?.let(::labBrief) ?: JsonNull)
        }
        assertEquals(labs.getValue("tones").jsonObject.mapValues { it.value.jsonPrimitive.int }, TimetablePresentation.tones(labLine))
        assertEquals(labs.getValue("last").jsonPrimitive.content, labLine.lastLesson().toString())
        labs.getValue("choices").jsonArray.forEach { item ->
            val choices = json.decodeFromJsonElement<top.hicancan.studev.me.LabChoices>(item.jsonObject.getValue("choices"))
            assertEquals(item.jsonObject.getValue("expected").jsonArray.map { it.jsonPrimitive.content }, CourseCatalog.attendingLabs(classLabs, choices).map { it.id })
        }
        labs.getValue("personal").jsonArray.forEach { item ->
            val extra = item.jsonObject.getValue("extraClasses").jsonArray.map { it.jsonPrimitive.content }
            val got = CourseCatalog.effectiveLabs(classLabs, extra, json.decodeFromJsonElement(item.jsonObject.getValue("all")))
            assertEquals(item.jsonObject.getValue("expected").jsonArray.map { it.jsonPrimitive.content }, got.map { it.id })
        }
    }
    @Test fun everyClassWeekGreysTheSameLessonsOffTheirWeek() {
        var count = 0
        golden.getValue("schedules").jsonArray.forEach { entry ->
            val meetings = json.decodeFromJsonElement<List<TeachingMeeting>>(entry.jsonObject.getValue("meetings"))
            entry.jsonObject.getValue("weeks").jsonArray.forEach { item ->
                val week = item.jsonObject.getValue("week").jsonPrimitive.int
                val cells = TimetablePresentation.offWeekLessons(meetings, week)
                assertEquals("week $week", json.decodeFromJsonElement<List<OffWeekLesson>>(item.jsonObject.getValue("cells")), cells)
                count += cells.size
            }
        }
        assertTrue(count > 0)
    }
    @Test fun eventsOnADayMatchIncludingHolidaysAndMorningRuns() {
        golden.getValue("days").jsonArray.forEach { day ->
            val date = LocalDate.parse(day.jsonObject.getValue("date").jsonPrimitive.content)
            assertEquals(date.toString(), day.jsonObject.getValue("events"), JsonArray(line.on(date).map(::brief)))
        }
    }
    @Test fun nextEventAndRunProgressMatch() {
        golden.getValue("moments").jsonArray.forEach { item ->
            val test = item.jsonObject
            val at = test.getValue("now").jsonObject
            val now = Moment(LocalDate.parse(at.getValue("date").jsonPrimitive.content), at.getValue("min").jsonPrimitive.int)
            assertEquals(test.getValue("next"), line.next(now)?.let(::brief) ?: JsonNull)
            val expected = test.getValue("run").jsonObject
            val tally = CampusLine.tally(run, now)
            assertEquals(expected.getValue("count").jsonPrimitive.int, tally.count)
            assertEquals(expected.getValue("need").jsonPrimitive.int, tally.need)
            assertEquals(expected.getValue("planned").jsonPrimitive.int, tally.planned)
            assertEquals(expected["nextBonus"]?.takeUnless { it is JsonNull }?.jsonArray?.map { it.jsonPrimitive.int }, tally.nextBonus)
            assertEquals(expected.getValue("done").jsonPrimitive.int, tally.done)
            assertEquals(test.getValue("plan").jsonArray.map { it.jsonPrimitive.content }, CampusLine.planRuns(run, line, now))
            assertEquals(test.getValue("week").jsonPrimitive.content, line.weekShown(now).toString())
        }
    }
    @Test fun aLessonOffItsWeekOpensWhereItNextMeets() = golden.getValue("around").jsonArray.forEach { item ->
        val test = item.jsonObject
        assertEquals(test["date"]?.jsonPrimitive?.contentOrNull, line.meetingAround(test.getValue("meeting").jsonPrimitive.content, LocalDate.parse(test.getValue("from").jsonPrimitive.content))?.date?.toString())
    }
    @Test fun lessonsHiddenBehindASlotAreTheSame() = golden.getValue("sharing").jsonArray.forEach { item ->
        val test = item.jsonObject
        val id = test.getValue("event").jsonPrimitive.content
        val event = (0L..30L).asSequence().map { LocalDate.parse("2026-11-09").plusDays(it) }.flatMap { line.on(it) }.first { it.id == id }
        assertEquals(test.getValue("others").jsonArray.map { it.jsonPrimitive.content }, line.sharingSlot(event).map { it.id })
    }
    @Test fun termTeachingEndsOnTheSameDay() = assertEquals(golden.getValue("lastLesson").jsonPrimitive.content, line.lastLesson().toString())
    @Test fun roomStatesMatchAtEverySampledMoment() {
        val rooms = golden.getValue("rooms").jsonObject
        val days = json.decodeFromJsonElement<List<RoomDay>>(rooms.getValue("days")).associateBy { it.date }
        val reader = RoomReader(periods)
        rooms.getValue("cases").jsonArray.forEach { item ->
            val test = item.jsonObject
            val state = reader.at(days.getValue(test.getValue("date").jsonPrimitive.content), test.getValue("room").jsonPrimitive.content, test.getValue("min").jsonPrimitive.int)
            assertEquals(item.toString(), test.getValue("tier").jsonPrimitive.content, state.tier)
            assertEquals(item.toString(), test.getValue("until").jsonPrimitive.int, state.until)
            assertEquals(item.toString(), test.getValue("minutes").jsonPrimitive.int, state.minutes)
            assertEquals(item.toString(), test.getValue("busy").jsonPrimitive.boolean, state.busy)
        }
    }
    @Test fun identitiesNamesAndAttendanceMatch() {
        val edge = golden.getValue("edgeCases").jsonObject
        edge.getValue("names").jsonArray.forEach { item ->
            val test = item.jsonObject
            val value = test.getValue("value").jsonPrimitive.content
            assertEquals(test.getValue("course").jsonPrimitive.content, Names.course(value))
            assertEquals(test.getValue("short").jsonPrimitive.content, Names.courseShort(value))
            assertEquals(test.getValue("room").jsonPrimitive.content, Names.room(value))
        }
        val exams = edge.getValue("attendanceExams").jsonArray.map { row ->
            val exam = row.jsonObject
            val course = exam.getValue("course").jsonObject
            Exam(exam.getValue("id").jsonPrimitive.content, listOf("A"), ExamCourse(course["code"]?.jsonPrimitive?.contentOrNull, course.getValue("name").jsonPrimitive.content), null, null, "教1-101", null, "2026-11-05", "08:00", "09:00", null, null, "2026-11-04-sheet.xlsx", "event", "event:exam")
        }
        edge.getValue("examAttendance").jsonArray.forEach { item ->
            val test = item.jsonObject
            val choices = test.getValue("choices").jsonObject.mapValues { it.value.jsonPrimitive.boolean }
            val own = test.getValue("ownCodes").takeUnless { it is JsonNull }?.jsonArray?.map { it.jsonPrimitive.content }?.toSet()
            assertEquals(test.getValue("expected").jsonArray.map { it.jsonPrimitive.content }, ExamAttendance.select(exams, choices, own).map { it.id })
        }
    }
    @Test fun examRemindersMatch() = golden.getValue("edgeCases").jsonObject.getValue("examReminders").jsonArray.forEach { item ->
        val test = item.jsonObject
        assertEquals(test.getValue("minutes").jsonPrimitive.int, Exams.reminderMinutes(test.getValue("key").jsonPrimitive.content, test.getValue("start").jsonPrimitive.int))
    }
    @Test fun eachTimetableHandsOutTheSameTones() = golden.getValue("tones").jsonArray.forEach { item ->
        val test = item.jsonObject
        val meetings = golden.getValue("schedules").jsonArray.first { it.jsonObject.getValue("class").jsonPrimitive.content == test.getValue("class").jsonPrimitive.content }
            .jsonObject.getValue("meetings").let { json.decodeFromJsonElement<List<TeachingMeeting>>(it) }
        assertEquals(test.getValue("tones").jsonObject.mapValues { it.value.jsonPrimitive.int }, TimetablePresentation.tones(meetings))
    }
    @Test fun aConversationBranchesAndThePathShownFollowsTheBranchesChosen() {
        val thread = golden.getValue("thread").jsonObject
        var at = top.hicancan.studev.ai.ChatThread()
        thread.getValue("steps").jsonArray.zip(thread.getValue("frames").jsonArray).forEach { (stepJson, frameJson) ->
            val step = stepJson.jsonObject; val frame = frameJson.jsonObject
            val id = step.getValue("id").jsonPrimitive.content
            at = if (step.getValue("op").jsonPrimitive.content == "append")
                at.append(step.getValue("parent").jsonPrimitive.content, id, buildJsonObject { put("role", step.getValue("role")); put("content", step.getValue("content")) })
            else at.choose(id)
            assertEquals(frame.getValue("path").jsonArray.map { it.jsonPrimitive.content }, at.path().map { it.id })
            assertEquals(frame.getValue("tip").jsonPrimitive.content, at.tip())
            assertEquals(frame.getValue("lineage").jsonArray.map { it.jsonPrimitive.content }, at.lineage(at.tip()).map { it.id })
            frame.getValue("siblings").jsonObject.forEach { (node, value) ->
                val expected = value.jsonObject; val got = at.siblings(node)
                assertEquals(expected.getValue("index").jsonPrimitive.int, got.index)
                assertEquals(expected.getValue("count").jsonPrimitive.int, got.count)
                assertEquals(expected["previous"]?.jsonPrimitive?.contentOrNull, got.previous)
                assertEquals(expected["next"]?.jsonPrimitive?.contentOrNull, got.next)
            }
        }
        val chain = top.hicancan.studev.ai.ChatThread.chain(listOf(buildJsonObject { put("role", "user"); put("content", "a") }, buildJsonObject { put("role", "assistant"); put("content", "b") }), listOf("x", "y"))
        assertEquals(thread.getValue("chain").jsonArray.map { pair -> pair.jsonArray.map { it.jsonPrimitive.content } }, chain.path().map { listOf(it.id, it.parent) })
    }
    @Test fun conversationsAreNamedByTheirFirstQuestionAndGroupedByTheDayTheyLastChanged() {
        val chats = golden.getValue("chats").jsonObject
        val listed = chats.getValue("listed").jsonArray.map { item -> val chat = item.jsonObject
            top.hicancan.studev.ai.SavedChat(chat.getValue("id").jsonPrimitive.content, chat.getValue("title").jsonPrimitive.content, chat.getValue("updated").jsonPrimitive.long, top.hicancan.studev.ai.ChatThread.of(chat.getValue("thread").jsonObject)) }
        assertEquals(chats.getValue("titles").jsonArray.map { it.jsonPrimitive.content }, listed.map { top.hicancan.studev.ai.Chats.titleOf(it.title, it.thread) })
        assertEquals(chats.getValue("groups").jsonArray.map { group -> group.jsonArray[0].jsonPrimitive.content to group.jsonArray[1].jsonArray.map { it.jsonPrimitive.content } },
            top.hicancan.studev.ai.Chats.groups(listed, chats.getValue("now").jsonPrimitive.long).map { (name, list) -> name to list.map { it.id } })
    }
    @Test fun aProviderStreamIsReadIntoTheSameTurnAndTheSameRequestIsMade() {
        val cases = golden.getValue("assistant").jsonObject
        val root = generateSequence(File(checkNotNull(System.getProperty("user.dir"))).canonicalFile) { it.parentFile }.first { File(it, "src/campus/world/assistant.json").isFile }
        val assistant = top.hicancan.studev.ai.Assistant.of(json.parseToJsonElement(File(root, "src/campus/world/assistant.json").readText()).jsonObject, json.parseToJsonElement(File(root, "src/campus/world/tools.json").readText()).jsonArray)
        cases.getValue("streams").jsonArray.forEach { item ->
            val case = item.jsonObject; val completion = assistant.Completion()
            assertEquals(case.getValue("pieces").jsonArray.map { it.jsonPrimitive.content }, case.getValue("lines").jsonArray.map { completion.take(it.jsonPrimitive.content) })
            val expected = case.getValue("result").jsonObject; val got = completion.result()
            if (expected["message"] != null) assertEquals(expected.getValue("message"), got.getOrThrow()) else assertEquals(expected.getValue("error").jsonPrimitive.content, got.exceptionOrNull()?.message)
        }
        assertEquals(cases.getValue("request"), assistant.request("deepseek-flash", listOf(buildJsonObject { put("role", "user"); put("content", "明天有课吗") }), java.time.Instant.ofEpochMilli(cases.getValue("at").jsonPrimitive.long)))
    }
}
