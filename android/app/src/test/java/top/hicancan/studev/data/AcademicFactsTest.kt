package top.hicancan.studev.data

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import top.hicancan.studev.world.CampusLine
import top.hicancan.studev.world.endsAt
import top.hicancan.studev.world.startsAt

class AcademicFactsTest {
    private inline fun <reified T> read(path: String): T = Json.decodeFromString(checkNotNull(javaClass.classLoader?.getResourceAsStream("data/$path")).bufferedReader().use { it.readText() })
    @Test fun decodeTheActualSharedPackageAndCalendarOccurrences() {
        val release = read<DataRelease>("release.json")
        val term = read<TeachingTerm>("teaching/${release.teaching}/term.json")
        val periods = read<List<TeachingPeriod>>("teaching/${release.teaching}/periods.json")
        val schedule = read<ClassSchedule>("teaching/${release.teaching}/classes/B240402.json")
        // A class has no exam file until its exams are published.
        val exams = runCatching { read<ClassExams>("exams/${release.exams}/classes/B240402.json") }.getOrNull() ?: ClassExams(emptyList(), emptyList())
        val rooms = read<RoomIndex>("rooms/index.json")
        assertEquals("B240402", schedule.klass.id); assertTrue(rooms.rooms.isNotEmpty())
        val events = CampusLine(term, periods, schedule.meetings, emptyList(), exams.exams, emptyMap(), null).lessonsAndExams()
        assertEquals(schedule.meetings.sumOf { it.weeks.size } + exams.exams.size, events.size)
        events.forEach { assertTrue(it.endsAt > it.startsAt) }
        val first = schedule.meetings.first()
        val occurrence = events.first { it.id.startsWith("${first.id}@") }
        assertEquals(first.weekday, occurrence.date.dayOfWeek.value)
        assertEquals(first.room, occurrence.room)
    }
    @Test fun discoverThePublishedReleaseWithoutDependingOnJavaScriptBundles() {
        val release = read<DataRelease>("release.json")
        val manifest = Json.encodeToJsonElement(release).jsonObject.toMutableMap().apply {
            put("core", JsonArray(emptyList())); put("all", JsonArray(emptyList())); put("bytes", JsonPrimitive(123))
        }
        assertEquals(release, AcademicRepository.releaseFromManifest(JsonObject(manifest).toString()))
        assertNull(AcademicRepository.releaseFromManifest("{}"))
        manifest["base"] = JsonPrimitive("https://other.invalid/data")
        assertNull(AcademicRepository.releaseFromManifest(JsonObject(manifest).toString()))
    }
    @Test fun decodeOnlyCoursePlansFromTheActualMixedInformationFile() {
        val file = read<InformationEntityFile>("entities/information.json")
        assertTrue(file.items.any { it["subtype"]?.jsonPrimitive?.content == "information:opening-hours" })
        val plans = file.items.filter { it["subtype"]?.jsonPrimitive?.content == "information:course-plan" }
            .map { Json.decodeFromJsonElement<CoursePlan>(it) }
        assertTrue(plans.isNotEmpty())
        assertTrue(plans.all { it.teaching_class_ids.isNotEmpty() })
    }
    @Test fun theReleaseManifestNamesTheCurrentApp() {
        val app = appInManifest("""{"version":"v","base":"/data/v","android":{"versionName":"2.3.5","versionCode":29},"core":[]}""")
        org.junit.Assert.assertEquals(AppRelease("2.3.5", 29), app)
    }
}
