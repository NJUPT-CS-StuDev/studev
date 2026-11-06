package top.hicancan.studev.timetable

import java.io.File
import java.time.LocalDate
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import top.hicancan.studev.data.*
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
    private val run = RunPlan(json.decodeFromJsonElement<MorningRun>(golden.getValue("run")), json.decodeFromJsonElement<Map<String, String>>(golden.getValue("runDays")), 5)
    private val line = CampusLine(term, periods, json.decodeFromJsonElement(golden.getValue("schedules").jsonArray[0].jsonObject.getValue("meetings")), emptyList(), holidays, run)
    private fun brief(event: LineEvent) = buildJsonObject {
        put("kind", event.kind); put("name", event.name); put("short", event.short); put("start", event.start); put("end", event.end); put("room", event.room)
    }
    @Test fun everyClassWeekMatchesEveryWebCell() {
        var count = 0
        golden.getValue("schedules").jsonArray.forEach { entry ->
            val meetings = json.decodeFromJsonElement<List<TeachingMeeting>>(entry.jsonObject.getValue("meetings"))
            entry.jsonObject.getValue("weeks").jsonArray.forEach { item ->
                val week = item.jsonObject.getValue("week").jsonPrimitive.int
                val cells = TimetablePresentation.cells(meetings, week)
                assertEquals("week $week", json.decodeFromJsonElement<List<TimetableCell>>(item.jsonObject.getValue("cells")), cells)
                count += cells.size
            }
        }
        assertTrue(count > 100)
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
            val tally = CampusLine.tally(run)
            assertEquals(expected.getValue("count").jsonPrimitive.int, tally.count)
            assertEquals(expected.getValue("need").jsonPrimitive.int, tally.need)
            assertEquals(expected.getValue("planned").jsonPrimitive.int, tally.planned)
            assertEquals(expected["nextBonus"]?.takeUnless { it is JsonNull }?.jsonArray?.map { it.jsonPrimitive.int }, tally.nextBonus)
            assertEquals(test.getValue("plan").jsonArray.map { it.jsonPrimitive.content }, CampusLine.planRuns(run, line, now).keys.sorted())
        }
    }
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
            Exam(exam.getValue("id").jsonPrimitive.content, listOf("A"), ExamCourse(course["code"]?.jsonPrimitive?.contentOrNull, course.getValue("name").jsonPrimitive.content), null, null, null, null, "2026-11-05", "08:00", "09:00", null, null, "event", "event:exam")
        }
        edge.getValue("examAttendance").jsonArray.forEach { item ->
            val test = item.jsonObject
            val choices = test.getValue("choices").jsonObject.mapValues { it.value.jsonPrimitive.boolean }
            val own = test.getValue("ownCodes").takeUnless { it is JsonNull }?.jsonArray?.map { it.jsonPrimitive.content }?.toSet()
            assertEquals(test.getValue("expected").jsonArray.map { it.jsonPrimitive.content }, ExamAttendance.select(exams, choices, own).map { it.id })
        }
    }
    @Test fun colourHashHandlesSupplementaryCharacters() {
        val code = Course(null, "😀课程", null, null, null, null, null, null, null)
        assertEquals(2438769704L % 12, TimetablePresentation.colourIndex(TeachingMeeting("x", code, emptyList(), TeachingGroup("g"), null, null, 1, listOf(1, 1), listOf(1), null, emptyList(), "event", "event:class")).toLong())
    }
}
