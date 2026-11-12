package top.hicancan.studev.timetable

import java.io.File
import java.time.LocalDate
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import top.hicancan.studev.data.*
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
        labs.getValue("personal").jsonArray.forEach { item ->
            val kept = item.jsonObject.getValue("kept").jsonArray.map { it.jsonPrimitive.content }
            val got = CourseCatalog.effectiveLabs(classLabs, meetings, meetings.filter { it.id in kept }, json.decodeFromJsonElement(item.jsonObject.getValue("added")), json.decodeFromJsonElement(item.jsonObject.getValue("all")))
            assertEquals(item.jsonObject.getValue("expected").jsonArray.map { it.jsonPrimitive.content }, got.map { it.id })
        }
    }
    @Test fun everyClassWeekGreysTheSameLessonsOffTheirWeek() {
        var count = 0
        golden.getValue("schedules").jsonArray.forEach { entry ->
            val meetings = json.decodeFromJsonElement<List<TeachingMeeting>>(entry.jsonObject.getValue("meetings"))
            entry.jsonObject.getValue("weeks").jsonArray.forEach { item ->
                val week = item.jsonObject.getValue("week").jsonPrimitive.int
                val cells = TimetablePresentation.offWeekLessons(meetings, week, TimetablePresentation.tones(meetings))
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
}
