package top.hicancan.studev

import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import top.hicancan.studev.campus.CampusModel
import top.hicancan.studev.data.AcademicRepository
import top.hicancan.studev.me.CampusSettings
import top.hicancan.studev.search.AcademicSearch
import top.hicancan.studev.timetable.CourseCatalog
import top.hicancan.studev.me.TimetableEdits

@RunWith(AndroidJUnit4::class)
class StabilityTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext
    private fun wait(tag: String) { compose.waitUntil(30_000) { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }; compose.waitForIdle() }
    private fun waitForSearchResults() {
        val result = SemanticsMatcher("a hydrated search result") { it.config.getOrElse(androidx.compose.ui.semantics.SemanticsProperties.TestTag) { "" }.startsWith("search-result-") }
        compose.waitUntil(30_000) { compose.onAllNodes(result).fetchSemanticsNodes().isNotEmpty() && compose.onAllNodesWithTag("search-loading").fetchSemanticsNodes().isEmpty() }
        compose.waitForIdle()
    }
    private fun link(path: String) {
        compose.activityRule.scenario.onActivity { activity ->
            val originalIntent = activity.intent
            instrumentation.callActivityOnNewIntent(activity, Intent(activity, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(Uri.parse("https://studev.hicancan.top/$path")))
            activity.intent = originalIntent
        }
    }
    private fun shot(name: String) {
        compose.waitForIdle()
        Thread.sleep(350)
        compose.waitForIdle()
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(context.getExternalFilesDir(null), "stability-shots").apply { mkdirs() }.resolve("$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
    @Test fun firstSearchShowsResultsFromAnEmptyCache() = runBlocking {
        wait("tab-home")
        val repository = AcademicRepository.bundled(context)
        val cache = File(context.filesDir, "campus/${repository.release.version}/search")
        assertTrue(!cache.exists() || cache.deleteRecursively())
        val start = android.os.SystemClock.elapsedRealtime()
        link("search/web/?q=${Uri.encode("转专业")}")
        val result = SemanticsMatcher("a ranked search result") { it.config.getOrElse(androidx.compose.ui.semantics.SemanticsProperties.TestTag) { "" }.startsWith("search-result-") }
        compose.waitUntil(15_000) { compose.onAllNodes(result).fetchSemanticsNodes().isNotEmpty() }
        val firstMs = android.os.SystemClock.elapsedRealtime() - start
        shot("cold-first-results")
        waitForSearchResults()
        val completeMs = android.os.SystemClock.elapsedRealtime() - start
        File(context.getExternalFilesDir(null), "search-cold-ui.json").writeText(buildJsonObject {
            put("firstResultMs", firstMs); put("completeMs", completeMs)
        }.toString())
        shot("cold-complete-results")
    }
    @Test fun nativeSearchMatchesTheWebScopesAndRetainsResultMetadata() = runBlocking {
        val repository = AcademicRepository.bundled(context)
        AcademicSearch(repository).use { search ->
            val cases = listOf("web" to "奖学金", "materials" to "高等数学", "community" to "校园网")
            val report = buildJsonArray {
                for ((scope, query) in cases) {
                    val page = search.page(query, scope = scope)
                    assertTrue("$scope: $query", page.results.isNotEmpty())
                    assertTrue(page.total >= page.results.size)
                    assertTrue(page.results.all { it.title.isNotBlank() && it.url.startsWith("https://") && it.source.isNotBlank() })
                    when (scope) {
                        "web" -> assertTrue(page.results.none { it.sourceId in listOf("njupt-survival-guide", "njupt-general-free-exams") })
                        "materials" -> assertTrue(page.results.all { it.sourceId == "njupt-general-free-exams" })
                        "community" -> assertTrue(page.results.all { it.sourceId == "njupt-survival-guide" })
                    }
                    add(buildJsonObject { put("scope", scope); put("query", query); put("total", page.total); put("urls", JsonArray(page.results.map { JsonPrimitive(it.url) })) })
                }
            }
            File(context.getExternalFilesDir(null), "stability-search.json").writeText(report.toString())
            assertTrue(search.page("zzzxqv9999").results.isEmpty())
            val limited = search.page("奖学金", limit = 1)
            assertEquals(1, limited.results.size)
            assertTrue(limited.total > 1)
            assertTrue(search.page("奖学金", category = "download").results.all { it.category == "download" })
        }
    }
    @Test fun attendanceIsPersistedWithoutExportAndControlsCalendarEvents() = runBlocking {
        wait("tab-home")
        val original = CampusSettings(context).state.value
        val repository = AcademicRepository.bundled(context)
        val first = repository.exams("B240402").first()
        try {
            compose.activityRule.scenario.onActivity { activity ->
                ViewModelProvider(activity)[CampusModel::class.java].settings.update { it.copy(examAttendance = emptyMap()) }
            }
            link("search/exam/?class=B240402"); wait("exams")
            compose.onNodeWithTag("exams-attending").performClick()
            compose.onNodeWithTag("exams").performScrollToNode(hasTestTag("exam-attendance-${first.id}"))
            compose.onNodeWithTag("exam-attendance-${first.id}").performClick()
            compose.waitUntil(10_000) { CampusSettings(context).state.value.examChoices(repository.release.exams, "B240402")[first.id] == false }
            assertTrue(repository.effectiveExams("B240402", CampusSettings(context).state.value).none { it.id == first.id })
            assertNull(top.hicancan.studev.reminders.DeviceSchedule.update(context, emptyList(), "B240402", CampusSettings(context).state.value.copy(examAttendance = emptyMap())))
            compose.activityRule.scenario.onActivity { activity -> assertTrue(ViewModelProvider(activity)[CampusModel::class.java].state.value.events.none { it.id == "exam:${first.id}" }) }
            compose.onNodeWithTag("exams-excluded").performClick()
            compose.onNodeWithTag("exams").performScrollToNode(hasTestTag("exam-attendance-${first.id}")); shot("exam-excluded")
            compose.activityRule.scenario.recreate(); wait("exams")
            assertEquals(false, CampusSettings(context).state.value.examChoices(repository.release.exams, "B240402")[first.id])
            compose.onNodeWithTag("exams-excluded").performClick()
            compose.onNodeWithTag("exams").performScrollToNode(hasTestTag("exam-attendance-${first.id}"))
            compose.onNodeWithTag("exam-attendance-${first.id}").performClick()
            assertTrue(repository.effectiveExams("B240402", CampusSettings(context).state.value).any { it.id == first.id })
            assertTrue(CampusSettings(context).state.value.examChoices("2026-2027-1", "B240402").isEmpty())
            assertTrue(CampusSettings(context).state.value.examChoices(repository.release.exams, "B240403").isEmpty())
        } finally {
            compose.activityRule.scenario.onActivity { activity -> ViewModelProvider(activity)[CampusModel::class.java].settings.update { original } }
        }
    }
    @Test fun searchScopesAndRapidEditingKeepTheFinalQueryVisible() {
        wait("tab-home")
        link("search/web/?q=奖学金"); wait("academic-search")
        compose.waitUntil(30_000) { compose.onAllNodes(hasTestTag("search-sort")).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("search-query").performTextReplacement("校园卡")
        compose.onNodeWithTag("search-query").performTextReplacement("奖学金")
        compose.onNodeWithTag("search-query").performImeAction()
        waitForSearchResults()
        shot("website-search")
        compose.onNodeWithTag("search-scope-materials").performClick()
        compose.onNodeWithTag("search-query").performTextReplacement("高等数学")
        compose.onNodeWithTag("search-query").performImeAction()
        compose.waitUntil(30_000) { compose.onAllNodes(hasText("南邮历年资料", substring = true)).fetchSemanticsNodes().isNotEmpty() }
        waitForSearchResults()
        shot("materials-search")
    }
    @Test fun courseAddRemoveSkipAndRestorePersistAcrossRecreation() = runBlocking {
        wait("tab-home")
        val original = CampusSettings(context).state.value
        val repository = AcademicRepository.bundled(context)
        val own = repository.schedule("B240402").meetings
        val catalog = repository.catalog()
        val added = CourseCatalog.searchCatalog(catalog, "艺术").first { course -> own.none { it.teaching_class.id == CourseCatalog.catalogId(course) } }
        val addedId = CourseCatalog.catalogId(added)
        val ownId = CourseCatalog.managedCourses(own, catalog, TimetableEdits()).first().id
        lateinit var model: CampusModel
        try {
            compose.activityRule.scenario.onActivity { activity ->
                model = ViewModelProvider(activity)[CampusModel::class.java]
                model.settings.update { it.copy(timetable = emptyMap()) }
            }
            link("search/timetable/?class=B240402&q=艺术"); wait("course-manager")
            compose.waitUntil(30_000) { model.state.value.catalog.isNotEmpty() }
            compose.onNodeWithTag("course-toggle-$addedId").performScrollTo().performClick()
            compose.waitUntil(15_000) { model.state.value.schedule?.meetings?.any { it.teaching_class.id == addedId } == true }
            compose.activityRule.scenario.recreate(); wait("course-manager")
            assertTrue(addedId in CampusSettings(context).state.value.timetableEdits(repository.release.teaching).added)
            compose.onNodeWithTag("course-toggle-$addedId").performScrollTo().performClick()
            compose.waitUntil(15_000) { model.state.value.schedule?.meetings?.none { it.teaching_class.id == addedId } == true }
            compose.onNodeWithTag("course-manager-search").performTextReplacement("")
            compose.onNodeWithTag("managed-action-$ownId").performScrollTo().performClick()
            compose.waitUntil(15_000) { model.state.value.schedule?.meetings?.none { it.teaching_class.id == ownId } == true }
            assertTrue(ownId in CampusSettings(context).state.value.timetableEdits(repository.release.teaching).hidden)
            compose.onNodeWithTag("managed-action-$ownId").performScrollTo().performClick()
            compose.waitUntil(15_000) { model.state.value.schedule?.meetings?.any { it.teaching_class.id == ownId } == true }
            shot("courses-restored")
        } finally {
            compose.activityRule.scenario.onActivity { model.settings.update { original } }
        }
    }
}
