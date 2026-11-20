package top.hicancan.studev.ai

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ChatProjectsTest {
    private val model = ModelSelection("api", "second")
    private val thread = ChatThread().append("", "question", buildJsonObject { put("role", "user"); put("content", "问题") })

    @Test fun oldConversationSurvivesAndMoveChangesOnlyItsProject() {
        val saved = SavedChat("chat", "我的对话", 100, thread, model)
        val old = buildJsonObject { put("chats", JsonArray(listOf(saved.toJson()))); put("current", saved.id) }
        val migrated = KeptChats.of(old, ModelSelection())
        assertEquals(saved.toJson(), migrated.chats.single().toJson())
        assertNull(migrated.currentProject)

        val custom = ChatProject("custom", "复习", instructions = "先给例子", memory = Memory.remembered("", "复习偏好"))
        val course = ChatProject("course", "操作系统", "JS001")
        val moved = migrated.copy(chats = listOf(saved.copy(projectId = course.id)), projects = listOf(custom, course), currentProject = course.id)
        val reopened = KeptChats.of(moved.toJson(), ModelSelection())
        assertEquals(course.id, reopened.currentProject)
        assertEquals(listOf(custom, course), reopened.projects)
        assertEquals(saved.toJson(), reopened.chats.single().copy(projectId = null).toJson())
    }

    @Test fun projectInstructionsUseOneValidatedPayload() {
        val project = ChatProject("custom", "复习", instructions = "# 先给例子")
        val text = Instructions.forChat(project)
        assertEquals("项目：复习\n项目指令\n# 先给例子", text)
        assertEquals(text, Situation(2, null, "仙林", null, text).toJson().getValue("instructions").jsonPrimitive.content)
        assertNull(Instructions.forChat(null))
        val course = project.copy(course = "JS001")
        assertEquals("项目：复习\n课程：JS001", Instructions.forChat(course))
        assertEquals(8000 + "项目：复习\n项目指令\n".length, Instructions.forChat(project.copy(instructions = "b".repeat(9000)))?.length)
    }

    @Test fun importPreservesMarkdownAndRejectsOversizedOrInvalidText() {
        val text = "# 标题\n\n- 例子\n"
        assertEquals(text, Instructions.markdown(("\uFEFF" + text).byteInputStream(), text.length))
        assertThrows(IllegalArgumentException::class.java) { Instructions.markdown(text.byteInputStream(), text.length - 1) }
        assertThrows(java.nio.charset.MalformedInputException::class.java) { Instructions.markdown(byteArrayOf(-61, 0).inputStream(), 20) }
    }
}
