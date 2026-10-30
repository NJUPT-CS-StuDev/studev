package top.hicancan.studev.timetable

import java.io.File
import java.time.Instant
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import top.hicancan.studev.data.*
import top.hicancan.studev.exams.examPresentation
import top.hicancan.studev.rooms.RoomSelection

class ParityTest {
    private val json = Json
    private fun fixture(name: String): JsonObject {
        val directory = generateSequence(File(checkNotNull(System.getProperty("user.dir"))).canonicalFile) { it.parentFile }
            .map { File(it, "src/campus/academics/parity") }.first { it.isDirectory }
        return json.parseToJsonElement(File(directory, name).readText()).jsonObject
    }
    private val golden = fixture("golden.json")
    private fun JsonElement.text() = jsonPrimitive.content
    private fun JsonObject.int(key: String) = getValue(key).jsonPrimitive.int
    @Test fun actualClassWeeksMatchEveryWebCellIncludingLayoutNotesAndColour() {
        val days = fixture("spec.json").getValue("timetable").jsonObject.getValue("layout").jsonObject.getValue("days").jsonArray.map { it.jsonPrimitive.int }
        var count = 0
        golden.getValue("schedules").jsonArray.forEach { entry ->
            val group = entry.jsonObject
            val meetings = json.decodeFromJsonElement<List<TeachingMeeting>>(group.getValue("meetings"))
            group.getValue("weeks").jsonArray.forEach { item ->
                val test = item.jsonObject
                val cells = TimetablePresentation.cells(meetings, test.int("week"))
                val expected = json.decodeFromJsonElement<List<TimetableCell>>(test.getValue("cells"))
                assertEquals("${group.getValue("class")} week ${test.int("week")}", expected, cells)
                days.forEach { day -> assertEquals(expected.filter { it.day == day }, cells.filter { it.day == day }) }
                count += cells.size
            }
        }
        assertEquals(211, count)
    }
    @Test fun actualExamsMatchWebAcrossShanghaiDateAndStartEndBoundaries() {
        golden.getValue("exams").jsonArray.forEach { entry ->
            val group = entry.jsonObject
            val exams = json.decodeFromJsonElement<List<Exam>>(group.getValue("exams"))
            group.getValue("cases").jsonArray.forEach { item ->
                val test = item.jsonObject
                val cells = exams.map { examPresentation(it, Instant.parse(test.getValue("now").text())) }
                assertEquals(test.getValue("cells"), json.encodeToJsonElement(cells))
            }
        }
    }
    @Test fun actualRoomResultsMatchWebForAllBuildingsNoneMultipleCampusAndPeriods() {
        val rooms = golden.getValue("rooms").jsonObject
        val index = json.decodeFromJsonElement<RoomIndex>(rooms.getValue("index"))
        val days = json.decodeFromJsonElement<List<RoomDay>>(rooms.getValue("days"))
        rooms.getValue("cases").jsonArray.forEach { item ->
            val test = item.jsonObject
            val selection = test.getValue("selection").jsonObject
            val buildings = selection.getValue("buildings").takeIf { it != JsonNull }?.jsonArray?.map { it.text() }?.toSet()
            val matching = RoomSelection.filter(index.rooms, selection.getValue("campus").text(), buildings,
                selection.getValue("everything").jsonPrimitive.boolean, selection.getValue("query").text(), selection.int("minSeats"))
            val day = days.first { it.date == test.getValue("date").text() }
            val free = matching.filter { CampusDay.isFree(day, it.id, selection.int("from"), selection.int("until")) }
            val actual = buildJsonObject { put("rooms", json.encodeToJsonElement(matching.map { it.id }.sorted())); put("free", json.encodeToJsonElement(free.map { it.id }.sorted())) }
            assertEquals("$selection on ${day.date}", test.getValue("expected"), actual)
        }
    }
    @Test fun coloursAreIndependentOfTheMeetingSetAndUseUnicodeCodePoints() {
        val meeting = json.decodeFromJsonElement<List<TeachingMeeting>>(golden.getValue("schedules").jsonArray[0].jsonObject.getValue("meetings")).first()
        val changed = meeting.copy(course = meeting.course.copy(code = null, name = "😀课程"))
        assertEquals(2438769704L % 12, TimetablePresentation.colourIndex(changed).toLong())
        assertEquals(TimetablePresentation.colourIndex(meeting), TimetablePresentation.colourIndex(meeting.copy(weeks = listOf(9))))
        golden.getValue("edgeCases").jsonObject.getValue("colours").jsonArray.forEach { item ->
            val test = item.jsonObject
            val course = test.getValue("course").jsonObject
            val value = meeting.copy(course = meeting.course.copy(code = course.getValue("code").jsonPrimitive.contentOrNull, name = course.getValue("name").text()))
            assertEquals(test.getValue("identity").text(), TimetablePresentation.identity(value))
            assertEquals(test.int("colourIndex"), TimetablePresentation.colourIndex(value))
        }
    }
    @Test fun hiddenBuildingChoicesAndInvalidExamTimesUseTheSharedEdgeCases() {
        val edge = golden.getValue("edgeCases").jsonObject
        edge.getValue("buildingTransitions").jsonArray.forEach { item ->
            val test = item.jsonObject
            fun values(key: String) = test.getValue(key).jsonArray.map { it.text() }.toSet()
            val selected = test.getValue("selected").takeIf { it != JsonNull }?.jsonArray?.map { it.text() }?.toSet()
            assertEquals(values("expected"), RoomSelection.toggle(selected, values("all"), test.getValue("toggle").text()))
        }
        edge.getValue("invalidExams").jsonArray.forEach { item ->
            val test = item.jsonObject
            val exam = json.decodeFromJsonElement<Exam>(test.getValue("exam"))
            assertEquals(test.getValue("expected"), json.encodeToJsonElement(examPresentation(exam, Instant.parse(test.getValue("now").text()))))
        }
    }
}
