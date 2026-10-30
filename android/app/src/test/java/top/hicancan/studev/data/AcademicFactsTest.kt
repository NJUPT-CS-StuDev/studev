package top.hicancan.studev.data

import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test
import top.hicancan.studev.timetable.CampusEvents
import java.time.ZoneId

class AcademicFactsTest {
    private inline fun <reified T> read(path: String): T = Json.decodeFromString(checkNotNull(javaClass.classLoader?.getResourceAsStream("data/$path")).bufferedReader().use { it.readText() })
    @Test fun decodeTheActualSharedPackageAndCalendarOccurrences() {
        val release = read<DataRelease>("release.json")
        val term = read<TeachingTerm>("teaching/${release.teaching}/term.json")
        val periods = read<List<TeachingPeriod>>("teaching/${release.teaching}/periods.json")
        val schedule = read<ClassSchedule>("teaching/${release.teaching}/classes/B240402.json")
        val exams = read<ClassExams>("exams/${release.exams}/classes/B240402.json")
        val rooms = read<RoomIndex>("rooms/index.json")
        assertEquals("B240402", schedule.klass.id); assertTrue(rooms.rooms.isNotEmpty())
        val events = CampusEvents.build(term, periods, schedule, exams.exams)
        assertEquals(schedule.meetings.sumOf { it.weeks.size } + exams.exams.size, events.size)
        events.forEach { assertTrue(it.end > it.start) }
        val first = schedule.meetings.first()
        val occurrence = events.first { it.id.contains(":${first.id}:") }
        assertEquals(first.weekday, occurrence.start.atZone(ZoneId.of("Asia/Shanghai")).dayOfWeek.value)
        assertEquals(first.room, occurrence.room)
    }
    @Test fun discoverOnlyTheCurrentFactFormat() {
        val json = """var e={version:`data-20261030-facts`,base:`/data/data-20261030-facts`,built_at:`2026-10-30T16:00:00Z`,teaching:`2026-2027-1`,exams:`2025-2026-2`,rooms:`2026-2027-1`};"""
        assertEquals("2026-2027-1", AcademicRepository.releaseFromModule(json)?.teaching)
        assertNotNull(AcademicRepository.releaseFromModule(json.replace('`', '"')))
        assertNull(AcademicRepository.releaseFromModule("""{version:"old",base:"/data/old",built_at:"2026"}"""))
        assertNull(AcademicRepository.releaseFromModule(json.replace("/data/data-20261030-facts", "https://other.invalid/data")))
    }
}
