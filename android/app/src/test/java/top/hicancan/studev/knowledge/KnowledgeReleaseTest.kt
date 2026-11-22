package top.hicancan.studev.knowledge

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import top.hicancan.studev.data.InformationEntityFile

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
        // The curriculum covers selected majors. Knowledge links to the full campus course-plan catalogue.
        val planIds = Json.decodeFromString<InformationEntityFile>(text("entities/information.json")).items
            .filter { it["subtype"]?.jsonPrimitive?.content == "information:course-plan" }
            .map { it.getValue("id").jsonPrimitive.content }
            .toSet()
        for (course in knowledge.courses) {
            assertTrue("${course.name} has no course codes", course.codes.isNotEmpty())
            val unknown = course.codes.filterNot { "information/course-plan/$it" in planIds }
            assertTrue("${course.name} links to unknown course plans: $unknown", unknown.isEmpty())
        }
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

    @Test fun followTheClassPlanUnlessADeepLinkSelectsAnotherAndKeepOnlyRecordedGraphEdges() {
        val curriculum = Json.decodeFromString<List<CurriculumCourse>>(text("curriculum/courses.json"))
        assertEquals("2024" to "计算机科学与技术", catalogScope(curriculum, "2024", "计算机科学与技术", null, null))
        assertEquals("2026" to "软件工程", catalogScope(curriculum, "2024", "计算机科学与技术", "2026", "软件工程"))
        assertEquals("2024" to "全部专业", catalogScope(curriculum, "2024", "计算机科学与技术", null, "全部专业"))
        for (year in listOf("2024", "2026")) {
            val selected = curriculum.filter { course -> course.plans.any { it.grade == year && it.major == "计算机科学与技术" } }
            val graph = courseRelations(curriculum, selected)
            assertTrue(graph.edges.isNotEmpty())
            assertEquals(graph.edges.flatMap { listOf(it.from, it.to) }.toSet(), graph.nodes.map { it.code }.toSet())
            assertTrue(graph.edges.all { edge -> edge.from in curriculum.first { it.code == edge.to }.requires })
        }
    }
}
