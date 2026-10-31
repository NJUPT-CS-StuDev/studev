package top.hicancan.studev.reminders

import org.junit.Assert.*
import org.junit.Test
import top.hicancan.studev.timetable.*
import java.time.Instant

class ReminderTimesTest {
    private val start = Instant.parse("2026-10-30T00:00:00Z")
    private fun event(id: String, exam: Boolean = false) = CampusEvent(id, "算法", start, start.plusSeconds(6000), "教3-601", "教3－601", "B240402", exam)
    @Test fun lessonsAndExamsUseTheSameLeadAndStableIdentity() {
        val plans = ReminderTimes.plans(listOf(event("lesson"), event("exam", true), event("lesson")), 15, start.minusSeconds(3600))
        assertEquals(2, plans.size); assertEquals(start.minusSeconds(900), plans.first().at); assertTrue(plans.last().event.exam)
        assertEquals(plans, ReminderTimes.plans(listOf(event("lesson"), event("exam", true)), 15, start.minusSeconds(3600)))
    }
    @Test fun neverSchedulesPastOrAlreadyDueReminders() {
        assertTrue(ReminderTimes.plans(listOf(event("lesson")), 15, start).isEmpty())
        assertTrue(ReminderTimes.plans(listOf(event("lesson")), 15, start.minusSeconds(900)).isEmpty())
        assertEquals(1, ReminderTimes.plans(listOf(event("lesson")), 15, start.minusSeconds(901)).size)
    }
    @Test fun changedLeadReplacesTheSameEvent() {
        assertEquals("lesson", ReminderTimes.plans(listOf(event("lesson")), 30, start.minusSeconds(3600)).single().event.id)
        assertEquals(start.minusSeconds(1800), ReminderTimes.plans(listOf(event("lesson")), 30, start.minusSeconds(3600)).single().at)
    }
    @Test fun schedulerChoosesExactlyOneDeliveryMechanism() {
        assertEquals(ReminderScheduleMode.ExactAlarm, ReminderTimes.mode(true))
        assertEquals(ReminderScheduleMode.WorkManager, ReminderTimes.mode(false))
    }
}
