package top.hicancan.studev.timetable

import android.app.UiModeManager
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertTrue
import org.junit.runner.RunWith
import top.hicancan.studev.MainActivity
import top.hicancan.studev.data.AcademicRepository

@RunWith(AndroidJUnit4::class)
class ParityScreensTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext
    private val directory get() = File(context.getExternalFilesDir(null), "parity-shots").apply { mkdirs() }
    private fun wait(tag: String) { compose.waitUntil(30000) { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }; compose.waitForIdle() }
    private fun shot(name: String) {
        compose.waitForIdle(); Thread.sleep(500)
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(directory,"$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG,100,it) }; bitmap.recycle()
    }
    private fun link(path: String) {
        compose.activityRule.scenario.onActivity { activity ->
            instrumentation.callActivityOnNewIntent(activity, Intent(activity, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(Uri.parse("https://studev.hicancan.top/$path")))
        }
    }
    @Test fun sameClassWeekAndBuildingSelectionInBothThemes() = runBlocking {
        val repo = AcademicRepository.bundled(context)
        val schedule = checkNotNull(repo.schedule("B240402"))
        File(directory,"app-B240402-w9-cells.json").writeText(Json.encodeToString(TimetablePresentation.cells(schedule.meetings,9)))
        val manager = context.getSystemService(UiModeManager::class.java)
        try {
            val onlyTheme = InstrumentationRegistry.getArguments().getString("theme")
            for ((mode,theme) in listOf(UiModeManager.MODE_NIGHT_NO to "light", UiModeManager.MODE_NIGHT_YES to "dark").filter { onlyTheme == null || it.second == onlyTheme }) {
                if (onlyTheme == null) compose.activityRule.scenario.onActivity { manager.setApplicationNightMode(mode) }
                wait("tab-timetable")
                link("search/timetable/?class=B240402&week=9"); wait("timetable")
                compose.onNodeWithTag("week-view").performClick(); wait("timetable-week")
                compose.waitUntil(20000) { compose.onAllNodesWithTag("lesson-${schedule.meetings.first { it.weeks.contains(9) }.id}").fetchSemanticsNodes().isNotEmpty() }
                TimetablePresentation.cells(schedule.meetings, 9).forEach { cell ->
                    val column = compose.onNodeWithTag("timetable-column-${cell.day}").fetchSemanticsNode().boundsInRoot
                    val bounds = compose.onNodeWithTag("lesson-${cell.id}").fetchSemanticsNode().boundsInRoot
                    if (bounds.width > 0 && bounds.height > 0) {
                        assertTrue("${cell.id} exceeds its day", bounds.left >= column.left - 1 && bounds.right <= column.right + 1)
                        assertTrue("${cell.id} exceeds its column", bounds.width <= column.width / cell.columns + 1)
                    }
                }
                shot("app-B240402-w9-week-$theme-top")
                compose.onNodeWithTag("timetable-week").performTouchInput { swipeUp() }
                shot("app-B240402-w9-week-$theme-bottom")
                compose.onNodeWithTag("day-view").performClick(); wait("timetable-day")
                compose.onNodeWithTag("weekday-4").performClick()
                compose.onNodeWithTag("timetable-day").performTouchInput { swipeDown() }
                shot("app-B240402-w9-day4-$theme-top")
                compose.onNodeWithTag("timetable-day").performTouchInput { swipeUp() }
                shot("app-B240402-w9-day4-$theme-bottom")
                compose.onNodeWithTag("weekday-6").performClick()
                shot("app-B240402-w9-day6-$theme-bottom")
                link("search/timetable/?class=B240402&week=3"); wait("timetable")
                compose.onNodeWithTag("day-view").performClick(); compose.onNodeWithTag("weekday-4").performClick()
                compose.onNodeWithTag("timetable-day").performTouchInput { swipeUp() }
                shot("app-B240402-w3-day4-$theme-bottom")
                val parallel = checkNotNull(repo.schedule("B250105"))
                link("search/timetable/?class=B250105&week=9"); wait("timetable")
                compose.onNodeWithTag("day-view").performClick()
                compose.onNodeWithTag("weekday-1").performClick()
                compose.waitUntil(20000) { compose.onAllNodesWithTag("lesson-${parallel.meetings.first { it.weekday == 1 && 9 in it.weeks }.id}").fetchSemanticsNodes().isNotEmpty() }
                for (weekday in listOf(1, 6)) {
                    compose.onNodeWithTag("weekday-$weekday").performClick()
                    compose.onNodeWithTag("timetable-day").performTouchInput { swipeUp() }
                    shot("app-B250105-w9-day$weekday-$theme-bottom")
                }
                link("search/exam/?class=B240402"); wait("exams")
                val exams = repo.exams("B240402")
                compose.waitUntil(20000) { compose.onAllNodesWithTag("exam-${exams.first().id}").fetchSemanticsNodes().isNotEmpty() }
                shot("app-B240402-exams-$theme")
                link("search/classrooms/?date=2026-10-30&period=3&campus=仙林"); wait("rooms")
                compose.onNodeWithTag("building-filter").performScrollTo().performClick()
                compose.onNodeWithTag("buildings-none").performClick()
                compose.onNodeWithTag("building-教3").performScrollTo().performClick()
                compose.onNodeWithTag("building-教4").performScrollTo().performClick()
                shot("app-rooms-building-menu-$theme")
                compose.onNodeWithText("完成").performClick()
                shot("app-rooms-filter-$theme")
                // A new visit must retain both selected IDs, including after the menu closes.
                link("search/exam/?class=B240402"); wait("exams")
                link("search/classrooms/?date=2026-10-30&period=3&campus=仙林"); wait("rooms")
                compose.onNodeWithTag("building-filter").performScrollTo().assertTextContains("楼栋 · 已选 2")
                File(directory,"app-assertions-$theme.json").writeText("""{"theme":"$theme","assertions":"passed","class":"B240402","week":9,"buildings":["教3","教4"]}""")
            }
        } finally { if (InstrumentationRegistry.getArguments().getString("theme") == null) compose.activityRule.scenario.onActivity { manager.setApplicationNightMode(UiModeManager.MODE_NIGHT_AUTO) } }
    }
}

/** Set a package override before launching an Activity, so captures also work on pre-seam-fix branches. */
@RunWith(AndroidJUnit4::class)
class ParityThemeTest {
    @Test fun configure() {
        val theme = InstrumentationRegistry.getArguments().getString("theme")
        InstrumentationRegistry.getInstrumentation().targetContext.getSystemService(UiModeManager::class.java)
            .setApplicationNightMode(when (theme) { "light" -> UiModeManager.MODE_NIGHT_NO; "dark" -> UiModeManager.MODE_NIGHT_YES; else -> UiModeManager.MODE_NIGHT_AUTO })
    }
}
