package top.hicancan.studev.knowledge

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class KnowledgeReleaseTest {
    private fun text(path: String) = checkNotNull(javaClass.classLoader?.getResourceAsStream("data/$path")) {
        "The released knowledge fixture is missing: $path"
    }.bufferedReader().use { it.readText() }

    @Test fun decodeTheCompleteReleasedKnowledgeAndCurriculumWithTheProductionTypes() {
        // AcademicRepository.read uses this same strict decoder, so an unmodelled released field fails here too.
        val knowledge = Json.decodeFromString<KnowledgeIndex>(text("knowledge/knowledge.json"))
        val curriculumText = text("curriculum/courses.json")
        val curriculum = Json.decodeFromString<List<CurriculumCourse>>(curriculumText)
        assertTrue(knowledge.courses.isNotEmpty())
        assertTrue(knowledge.topics.isNotEmpty())
        assertTrue(knowledge.materials.isNotEmpty())
        val codes = curriculum.map { it.code }.toSet()
        assertTrue(knowledge.courses.all { course -> course.codes.isNotEmpty() && course.codes.all { it in codes } })
        val courses = knowledge.courses.map { it.id }.toSet()
        assertTrue(knowledge.materials.all { it.course in courses })

        // Week ranges belong to every actual training-plan entry, including the ones a screen never filters to.
        fun weeks(courses: JsonArray) = courses.flatMap { course ->
            course.jsonObject.getValue("plans").jsonArray.map { it.jsonObject.getValue("weeks").jsonPrimitive.content }
        }
        val expectedWeeks = weeks(Json.parseToJsonElement(curriculumText).jsonArray)
        assertTrue(expectedWeeks.isNotEmpty())
        assertTrue(expectedWeeks.all { it.isNotBlank() })
        assertEquals(expectedWeeks, weeks(Json.encodeToJsonElement(curriculum).jsonArray))
    }
}
