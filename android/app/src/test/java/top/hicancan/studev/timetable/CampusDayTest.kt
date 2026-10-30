package top.hicancan.studev.timetable

import org.junit.Assert.*
import org.junit.Test
import top.hicancan.studev.data.*
import java.time.*

/** Port of src/campus/classrooms/model/campusDay.test.ts. */
class CampusDayTest {
    private val periods = listOf(TeachingPeriod(1, "08:00", "08:45", "上午"), TeachingPeriod(2, "08:50", "09:35", "上午"), TeachingPeriod(3, "09:50", "10:35", "上午"))
    private val weeks = listOf(TeachingWeek(1, "2026-08-31", "2026-09-06"), TeachingWeek(2, "2026-09-07", "2026-09-13"))
    @Test fun nanjingTimeDoesNotDependOnTheDeviceTimeZone() {
        val now = CampusDay.now(Clock.fixed(Instant.parse("2026-10-25T10:51:00Z"), ZoneId.of("America/Los_Angeles")))
        assertEquals("2026-10-25", now.toLocalDate().toString()); assertEquals(LocalTime.of(18, 51), now.toLocalTime())
        assertEquals("2026-10-26", CampusDay.now(Clock.fixed(Instant.parse("2026-10-25T17:30:00Z"), ZoneOffset.UTC)).toLocalDate().toString())
    }
    @Test fun runningThenNextThenLastPeriod() {
        assertEquals(listOf(1, 1, 3, 3), listOf("07:00", "08:10", "09:40", "22:00").map { CampusDay.periodAt(periods, LocalTime.parse(it)) })
    }
    @Test fun publishedWeeksAndBoundaries() {
        assertEquals("2026-08-31", CampusDay.clamp(weeks, LocalDate.parse("2026-07-01")).toString())
        assertEquals("2026-09-13", CampusDay.clamp(weeks, LocalDate.parse("2027-01-01")).toString())
        val date = LocalDate.parse("2026-09-09")
        assertEquals(2, CampusDay.weekOf(weeks, date)?.week); assertEquals(3, CampusDay.weekday(weeks[1], date))
        assertEquals(1, CampusDay.weekOf(weeks, LocalDate.parse("2026-09-06"))?.week)
        assertEquals(2, CampusDay.weekOf(weeks, LocalDate.parse("2026-09-07"))?.week)
        assertNull(CampusDay.weekOf(weeks, LocalDate.parse("2026-09-14")))
    }
    @Test fun occupancyAndCheckedFreeListsHaveWebParity() {
        val course = RoomOccupant("class", "m", "高数", listOf("甲"), listOf("B1"), listOf(1, 2))
        val exam = RoomOccupant("exam", "e", "物理", listOf("乙"), listOf("B1", "B2"), listOf(2, 3))
        val day = RoomDay("2026-10-26", week = 9, weekday = 1, occupied = mapOf("教4-306" to listOf(course), "教4-308" to listOf(exam)))
        assertFalse(CampusDay.isFree(day, "教4-306", 1)); assertTrue(CampusDay.isFree(day, "教4-306", 3))
        assertTrue(CampusDay.isFree(day, "教4-308", 1)); assertFalse(CampusDay.isFree(day, "教4-308", 2)); assertFalse(CampusDay.isFree(day, "教4-308", 3))
        assertEquals(listOf(exam), CampusDay.occupants(day, "教4-308", 2)); assertEquals(3, CampusDay.freeRun(day, "教4-310", 1, 3))
        val checked = day.copy(free = mapOf("1" to listOf("教4-308"), "2" to listOf("教4-306"), "3" to listOf("教4-306", "教4-310")), observed_at = "2026-10-25T06:00:00Z")
        assertFalse(CampusDay.isFree(checked, "教4-310", 1)); assertNull(CampusDay.occupants(checked, "教4-310", 1))
        assertEquals(emptyList<RoomOccupant>(), CampusDay.occupants(checked, "教4-306", 2)); assertEquals(listOf(course), CampusDay.occupants(checked, "教4-306", 1))
        assertEquals(2, CampusDay.freeRun(checked, "教4-306", 2, 3)); assertTrue(CampusDay.isFree(checked, "教4-306", 2, 3))
        assertFalse(CampusDay.isFree(checked, "教4-306", 1, 3))
        assertFalse(CampusDay.isFree(checked.copy(free = emptyMap()), "教4-999", 1))
    }
    @Test fun roomAliasesAndKindsMatchWebFilters() {
        val room = Room("图科楼-409", "图科楼", "4", "409", "仙林", listOf("多媒体教室"), listOf("图409"), true)
        listOf("409", "图科楼-409", "图科楼", "图409", "图科楼409", "").forEach { assertTrue(CampusDay.roomMatches(room, it)) }
        assertFalse(CampusDay.roomMatches(room, "306")); assertTrue(CampusDay.eligible(room)); assertFalse(CampusDay.eligible(room.copy(listed = false)))
        assertFalse(CampusDay.eligible(room.copy(kinds = listOf("实验室")))); assertTrue(CampusDay.eligible(room.copy(kinds = listOf("实验室")), true))
    }
}
