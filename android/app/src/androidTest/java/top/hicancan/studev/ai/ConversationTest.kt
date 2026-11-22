package top.hicancan.studev.ai

import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import top.hicancan.studev.MainActivity
import top.hicancan.studev.account.*
import top.hicancan.studev.app.CampusModel
import top.hicancan.studev.app.Route
import top.hicancan.studev.app.StuDevTheme

class ConversationTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test fun simultaneousRepliesSurviveLeavingAndStoppingOnlyStopsTheSelectedChat() {
        val a = "这周有哪些考试"
        val b = "今天哪里有空教室"
        val starts = mapOf(a to CompletableDeferred<Unit>(), b to CompletableDeferred<Unit>())
        val finish = mapOf(a to CompletableDeferred<Unit>(), b to CompletableDeferred<Unit>())
        val account = AccountUser("conversation-test", "验收同学")
        val storage = object : AccountStorage {
            override suspend fun read() = StoredAccount(session = AccountSession("test-access", "test-refresh", 601_000, "test-device", account))
            override suspend fun write(value: StoredAccount) = Unit
        }
        val client = AccountClient(storage, PlatformTransport { _, _, _ -> error("Only the model stream is expected") },
            now = { 1000 }, streamer = PlatformStreamer { path, payload, _, receive ->
                assertEquals("/ai", path)
                val question = payload.getValue("messages").jsonArray.last().jsonObject.getValue("content").jsonPrimitive.content
                val text = if (question == a) "考试的部分回答" else "空教室的完整回答"
                receive("delta", buildJsonObject { put("content", text) })
                starts.getValue(question).complete(Unit)
                finish.getValue(question).await()
                receive("message", buildJsonObject { put("message", buildJsonObject { put("role", "assistant"); put("content", text) }) })
                null
            })
        lateinit var conversations: Conversations
        try {
            compose.runOnUiThread {
                val model = CampusModel(compose.activity.application)
                conversations = Conversations(compose.activity.application, model, compose.activity.lifecycleScope, client)
                conversations.replaceChats(emptyList())
                conversations.open(null, null)
                var visible by mutableStateOf(true)
                val route = Route()
                compose.activity.setContent {
                    StuDevTheme {
                        Column(Modifier.fillMaxSize()) {
                            TextButton(onClick = { visible = !visible }) { Text(if (visible) "去其他模块" else "回到对话") }
                            if (visible) androidx.compose.foundation.layout.Box(Modifier.weight(1f)) { AiScreen(model, route, conversations) }
                        }
                    }
                }
            }
            compose.waitUntil(15_000) { compose.onAllNodesWithText("有什么可以帮你？").fetchSemanticsNodes().isNotEmpty() }
            compose.waitUntil(10_000) { client.user.value != null }
            val input = compose.onNode(hasSetTextAction() and hasContentDescription("问点什么"))
            input.performTextInput(a)
            compose.onNodeWithContentDescription("发送").performClick()
            compose.waitUntil(10_000) { starts.getValue(a).isCompleted }
            compose.onNodeWithText("工具").assertIsEnabled()
            compose.onNodeWithContentDescription("新对话").performClick()
            input.performTextInput(b)
            compose.onNodeWithContentDescription("发送").performClick()
            compose.waitUntil(10_000) { starts.getValue(b).isCompleted }
            compose.onNodeWithText("去其他模块").performClick()
            compose.runOnIdle { assertEquals(2, conversations.running.size) }
            compose.onNodeWithText("回到对话").performClick()
            compose.onNodeWithContentDescription("对话列表").performClick()
            compose.onNode(hasText(a) and hasClickAction()).performClick()
            compose.onNodeWithContentDescription("停止").performClick()
            compose.waitUntil(10_000) { conversations.running.size == 1 }
            compose.onNodeWithText("考试的部分回答").assertExists()
            compose.onAllNodesWithText("空教室的完整回答").assertCountEquals(0)
            finish.getValue(b).complete(Unit)
            compose.waitUntil(10_000) { conversations.running.isEmpty() }
            compose.onNodeWithContentDescription("对话列表").performClick()
            compose.onNode(hasText(b) and hasClickAction()).performClick()
            compose.onNodeWithText("空教室的完整回答").assertExists()
            compose.onAllNodesWithText("考试的部分回答").assertCountEquals(0)
        } finally {
            finish.values.forEach { it.complete(Unit) }
        }
    }
}
