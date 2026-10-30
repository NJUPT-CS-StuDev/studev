package top.hicancan.studev.timetable

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import top.hicancan.studev.campus.AcademicState
import top.hicancan.studev.data.AcademicRepository
import top.hicancan.studev.exams.ExamsScreen
import top.hicancan.studev.rooms.RoomsScreen
import top.hicancan.studev.ui.theme.DarkColors
import top.hicancan.studev.ui.theme.LightColors

/** Feature UI assertions use the real package without depending on the map Activity's lifecycle. */
@RunWith(AndroidJUnit4::class)
class ParityViewsTest {
    @get:Rule val compose = createComposeRule()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    @Test fun cellBoundsAndRememberedBuildingSelectionInBothThemes() = runBlocking {
        val repo = AcademicRepository.bundled(context)
        val schedule = checkNotNull(repo.schedule("B240402"))
        val exams = repo.exams("B240402")
        val index = repo.rooms()
        val state = AcademicState(repository = repo, term = repo.term(), periods = repo.periods(), schedule = schedule, exams = exams, rooms = index, busy = false)
        val dark = mutableStateOf(false)
        val screen = mutableStateOf("timetable")
        val store = context.getSharedPreferences("room-building-selection", android.content.Context.MODE_PRIVATE)
        val previous = store.getStringSet("仙林", null)?.toSet()
        store.edit().remove("仙林").commit()
        try {
            compose.setContent {
                MaterialTheme(colorScheme = if (dark.value) DarkColors else LightColors) {
                    Surface(Modifier.fillMaxSize()) {
                        when (screen.value) {
                            "timetable" -> TimetableScreen(state, "B240402", 9, {}, {})
                            "exams" -> ExamsScreen(state, "B240402", {}, { _, _ -> })
                            else -> RoomsScreen(repo, index, "仙林", initialDate = "2026-10-30", initialPeriod = 3, onCampus = {}, onRoute = { _, _ -> })
                        }
                    }
                }
            }
            for (theme in listOf(false, true)) {
                compose.runOnIdle { dark.value = theme; screen.value = "timetable" }
                compose.onNodeWithTag("week-view").performClick()
                val cells = TimetablePresentation.cells(schedule.meetings, 9)
                var visible = 0
                cells.forEach { cell ->
                    val column = compose.onNodeWithTag("timetable-column-${cell.day}").fetchSemanticsNode().boundsInRoot
                    val bounds = compose.onNodeWithTag("lesson-${cell.id}").fetchSemanticsNode().boundsInRoot
                    if (bounds.width > 0 && bounds.height > 0) {
                        assertTrue("${cell.id} starts before its day", bounds.left >= column.left - 1)
                        assertTrue("${cell.id} overflows its day", bounds.right <= column.right + 1)
                        assertTrue("${cell.id} overflows its conflict column", bounds.width <= column.width / cell.columns + 1)
                        visible++
                    }
                }
                assertTrue(visible >= 5)
                compose.onNodeWithTag("day-view").performClick()
                compose.onNodeWithTag("weekday-4").performClick()
                compose.onNodeWithTag("timetable-day").assertExists()
                compose.runOnIdle { screen.value = "exams" }
                compose.onNodeWithText("全部 ${exams.size}").assertExists()
                compose.onNodeWithTag("exam-${exams.first().id}").assertExists()
                compose.runOnIdle { screen.value = "rooms" }
                compose.waitUntil(20000) { compose.onAllNodesWithTag("room-summary").fetchSemanticsNodes().any { it.config.toString().contains("间空闲") } }
                // First visit starts with all; select the exact comparison pair in each scheme.
                compose.onNodeWithTag("building-filter").performScrollTo().performClick()
                compose.onNodeWithTag("buildings-none").performClick()
                compose.onNodeWithTag("building-教3").performScrollTo().performClick()
                compose.onNodeWithTag("building-教4").performScrollTo().performClick()
                compose.onNodeWithText("完成").performClick()
                compose.onNodeWithTag("room-summary").performScrollTo().assertTextEquals("25 / 96 间空闲")
                compose.runOnIdle { screen.value = "exams" }
                compose.waitForIdle()
                compose.runOnIdle { screen.value = "rooms" }
                compose.onNodeWithTag("building-filter").performScrollTo().assertTextContains("楼栋 · 已选 2")
            }
        } finally {
            if (previous == null) store.edit().remove("仙林").commit() else store.edit().putStringSet("仙林", previous).commit()
        }
    }
}
