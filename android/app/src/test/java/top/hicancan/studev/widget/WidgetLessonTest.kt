package top.hicancan.studev.widget

import org.junit.Assert.*
import org.junit.Test
import top.hicancan.studev.timetable.CampusEvent
import java.time.Instant

class WidgetLessonTest {
    private val morning = Instant.parse("2026-10-30T00:00:00Z") // 08:00 Shanghai
    private fun event(start: Instant = morning, exam: Boolean = false) = CampusEvent("event", "嵌入式手机终端开发技术", start,
        start.plusSeconds(5400), "教4-208", null, "", exam)
    @Test fun departureUsesKernelMinutesAndThreeMinuteBuffer() {
        assertEquals("07:39 出门", WidgetLesson.headline(event(), morning.minusSeconds(3600), 18))
        assertEquals(morning.minusSeconds(21 * 60L), WidgetLesson.departure(event(), 18))
        assertEquals("嵌入式手机终端开发技术 · 教4-208 · 08:00 上课", WidgetLesson.detail(event()))
    }
    @Test fun tomorrowAndExamHaveExplicitCopy() {
        assertEquals("明天 07:39 出门", WidgetLesson.headline(event(), morning.minusSeconds(12 * 3600), 18))
        assertEquals("08:00 考试", WidgetLesson.headline(event(exam = true), morning.minusSeconds(600), null))
        assertTrue(WidgetLesson.detail(event(exam = true)).endsWith("08:00 考试"))
    }
    @Test fun ongoingClassRemainsUntilItsEndAndNoLessonsIsBoundedToTomorrow() {
        val lesson = event()
        assertEquals(lesson, WidgetLesson.next(listOf(lesson), morning.plusSeconds(600)))
        assertEquals("正在上课", WidgetLesson.headline(lesson, morning.plusSeconds(600), 18))
        assertNull(WidgetLesson.next(listOf(lesson), lesson.end))
        assertNull(WidgetLesson.next(listOf(event(morning.plusSeconds(48 * 3600))), morning))
    }
    @Test fun refreshUsesNextClassBoundaryOrShanghaiMidnight() {
        val lesson = event()
        assertEquals(lesson.start, WidgetLesson.refreshAt(listOf(lesson), morning.minusSeconds(60)))
        assertEquals(lesson.end, WidgetLesson.refreshAt(listOf(lesson), morning.plusSeconds(60)))
        assertEquals(Instant.parse("2026-10-30T16:00:00Z"), WidgetLesson.refreshAt(emptyList(), morning))
    }
}
