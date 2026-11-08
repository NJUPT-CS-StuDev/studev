package top.hicancan.studev.timetable

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import top.hicancan.studev.data.Course
import top.hicancan.studev.data.Teacher
import top.hicancan.studev.data.TeachingGroup
import top.hicancan.studev.data.TeachingMeeting
import top.hicancan.studev.me.TimetableEdits

class CourseCatalogTest {
    private fun meeting(
        id: String,
        classGroupId: String,
        name: String,
        code: String? = "B0101",
        teacher: String = "张三",
        room: String? = "教3－405",
        weekday: Int = 1,
        periods: List<Int> = listOf(1, 2),
        weeks: List<Int> = (1..16).toList(),
        classes: List<String> = listOf("B240402"),
    ) = TeachingMeeting(
        id = id,
        course = Course(code, name, "必修", "必修", 3.0, 48.0, null, "考试", null),
        teachers = listOf(Teacher("t-$teacher", teacher, null, null, weeks)),
        teaching_class = TeachingGroup(classGroupId, classGroupId, 60, 58, 60),
        campus = "仙林",
        room = room,
        weekday = weekday,
        periods = periods,
        weeks = weeks,
        method = "面授讲课",
        classes = classes,
        kind = "event",
        subtype = "event:teaching-meeting",
    )

    @Test
    fun groupsAndSearchesCoursesWithFullWidthNormalization() {
        val m1 = meeting("m1", "tc-1", "高等数学A(上)", code = "MATH101", teacher = "李四", room = "教2－201", weekday = 1)
        val m2 = meeting("m2", "tc-1", "高等数学A(上)", code = "MATH101", teacher = "李四", room = "教2－201", weekday = 3)
        val m3 = meeting("m3", "tc-2", "大学物理", code = "PHYS101", teacher = "王五", room = "教3-405", weekday = 2)
        val catalog = CourseCatalog.groupCatalog(listOf(m1, m2, m3))
        assertEquals(2, catalog.size)
        assertEquals(2, catalog.first { CourseCatalog.catalogId(it) == "tc-1" }.meetings.size)

        val byRoom = CourseCatalog.searchCatalog(catalog, "教2-201")
        assertEquals(listOf("tc-1"), byRoom.map(CourseCatalog::catalogId))

        val byTeacherAndName = CourseCatalog.searchCatalog(catalog, "高等数学 李四")
        assertEquals(listOf("tc-1"), byTeacherAndName.map(CourseCatalog::catalogId))
    }

    @Test
    fun appliesHiddenAndAddedTimetableEdits() {
        val own1 = meeting("m1", "tc-own-1", "通信原理", weekday = 1)
        val own2 = meeting("m2", "tc-own-2", "信号与系统", weekday = 2)
        val elective = meeting("m3", "tc-elec-1", "人工智能导论", weekday = 4, classes = listOf("B240101"))
        val catalog = CourseCatalog.groupCatalog(listOf(own1, own2, elective))

        val edits = TimetableEdits(hidden = listOf("tc-own-2"), added = listOf("tc-elec-1"))
        val effective = CourseCatalog.effectiveMeetings(listOf(own1, own2), catalog, edits)
        assertEquals(listOf("m1", "m3"), effective.map { it.id })

        val managed = CourseCatalog.managedCourses(listOf(own1, own2), catalog, edits)
        assertEquals(3, managed.size)
        val hiddenCourse = managed.first { it.id == "tc-own-2" }
        assertEquals("class", hiddenCourse.source)
        assertEquals(true, hiddenCourse.hidden)
        val addedCourse = managed.first { it.id == "tc-elec-1" }
        assertEquals("added", addedCourse.source)
        assertEquals(false, addedCourse.hidden)
    }

    @Test
    fun formatsWeekRangesAndKeepsSkippedWeeksInPlace() {
        assertEquals("第1–15周（单周）", CourseCatalog.formatWeekNumbers(listOf(1, 3, 5, 7, 9, 11, 13, 15)))
        assertEquals("第1–4、6–8周", CourseCatalog.formatWeekNumbers(listOf(1, 2, 3, 4, 6, 7, 8)))
        val m = meeting("m1", "tc-1", "线性代数", weeks = listOf(1, 2, 3, 4, 6, 7, 8))
        assertEquals("off", TimetablePresentation.state(m, 5))
        assertEquals("active", TimetablePresentation.state(m, 6))
        assertEquals("hidden", TimetablePresentation.state(m, 9))
    }
}
