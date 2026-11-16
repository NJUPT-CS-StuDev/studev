package top.hicancan.studev.account

import androidx.activity.compose.setContent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import kotlinx.coroutines.CompletableDeferred
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import top.hicancan.studev.MainActivity
import top.hicancan.studev.app.StuDevTheme
import java.util.concurrent.atomic.AtomicBoolean

/** Network/storage gates exercise the normal components without a second application path. */
class ExperienceTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test fun publicFormCanBeFilledBeforeAccountStorageReturns() {
        val identityStarted = CompletableDeferred<Unit>()
        val identityGate = CompletableDeferred<Unit>()
        val definitionStarted = CompletableDeferred<Unit>()
        val definitionGate = CompletableDeferred<Unit>()
        val storage = object : AccountStorage {
            override suspend fun read(): StoredAccount {
                identityStarted.complete(Unit)
                identityGate.await()
                return StoredAccount(deviceId = "synthetic-form-installation")
            }
            override suspend fun write(value: StoredAccount) = Unit
        }
        val formId = "00000000-0000-4000-8000-000000000001"
        val client = AccountClient(storage, PlatformTransport { path, body, bearer ->
            assertEquals("/forms/$formId", path)
            assertNull(body); assertNull(bearer)
            definitionStarted.complete(Unit)
            definitionGate.await()
            PlatformReply(200, buildJsonObject {
                put("canSubmit", true)
                put("form", buildJsonObject {
                    put("id", formId); put("title", "问题反馈")
                    put("fields", buildJsonArray { add(buildJsonObject {
                        put("id", "note"); put("type", "textarea"); put("label", "问题说明"); put("required", true)
                    }) })
                })
            })
        })
        try {
            compose.runOnUiThread { compose.activity.setContent {
                StuDevTheme { FormScreen(client, FormRequest(formId), onBack = {}) }
            } }
            compose.waitUntil(10_000) { identityStarted.isCompleted && definitionStarted.isCompleted }
            compose.onNodeWithText("正在加载表单…").assertIsDisplayed()
            compose.onAllNodes(hasText("正在提交", substring = true)).assertCountEquals(0)

            compose.runOnIdle { definitionGate.complete(Unit) }
            val answer = hasSetTextAction() and hasText("问题说明 *")
            compose.waitUntil(10_000) { compose.onAllNodes(answer).fetchSemanticsNodes().isNotEmpty() }
            assertFalse("the account read is still pending while fields are usable", identityGate.isCompleted)
            compose.onNode(answer).assertIsDisplayed().assertIsEnabled().performTextInput("先把问题写下来")
            compose.onNode(answer).assertTextContains("先把问题写下来")
            compose.onAllNodes(hasText("正在提交", substring = true)).assertCountEquals(0)

            compose.runOnIdle { identityGate.complete(Unit) }
            compose.waitUntil(10_000) { compose.onAllNodesWithText("提交").fetchSemanticsNodes().isNotEmpty() }
            compose.onNode(answer).assertTextContains("先把问题写下来")
        } finally {
            definitionGate.complete(Unit); identityGate.complete(Unit)
        }
    }

    @Test fun cachedAccountAndNavigationRemainUsableWhileVerificationAndDevicesWait() {
        val account = AccountUser(id = "synthetic-user", nickname = "缓存同学", studentId = "TEST123456", realName = "合成测试成员", qq = "100002")
        var stored = StoredAccount(deviceId = "synthetic-account-installation", session = AccountSession(
            accessToken = "synthetic-access", refreshToken = "synthetic-refresh", expiresAt = 601_000,
            deviceSessionId = "synthetic-family", user = account,
        ))
        val storage = object : AccountStorage {
            override suspend fun read() = stored
            override suspend fun write(value: StoredAccount) { stored = value }
        }
        val stateStarted = CompletableDeferred<Unit>()
        val stateGate = CompletableDeferred<Unit>()
        val devicesStarted = CompletableDeferred<Unit>()
        val devicesGate = CompletableDeferred<Unit>()
        val client = AccountClient(storage, PlatformTransport { path, _, bearer ->
            assertEquals("synthetic-access", bearer)
            when (path) {
                "/auth/session" -> {
                    stateStarted.complete(Unit); stateGate.await()
                    PlatformReply(200, buildJsonObject { put("user", Json.encodeToJsonElement(account)) })
                }
                "/auth/devices" -> {
                    devicesStarted.complete(Unit); devicesGate.await()
                    PlatformReply(200, buildJsonObject { put("items", buildJsonArray {}) })
                }
                else -> error("Unexpected request: $path")
            }
        }, now = { 1000 })
        val returned = AtomicBoolean(false)
        try {
            compose.runOnUiThread { compose.activity.setContent {
                StuDevTheme { AccountScreen(client, onBack = { returned.set(true) }) }
            } }
            compose.waitUntil(10_000) { stateStarted.isCompleted }
            compose.onAllNodesWithText("缓存同学").onFirst().assertIsDisplayed()
            compose.onNodeWithText("正在验证登录状态…").assertIsDisplayed()
            assertFalse(stateGate.isCompleted)

            compose.onNodeWithText("登录设备").performClick()
            compose.waitUntil(10_000) { devicesStarted.isCompleted }
            compose.onNodeWithText("正在读取设备…").assertIsDisplayed()
            assertFalse(devicesGate.isCompleted)
            compose.onNodeWithText("账号安全").performClick()
            compose.onNodeWithText("修改密码").assertIsDisplayed()
            compose.onNodeWithContentDescription("返回").performClick()
            assertTrue("return is available before either remote response", returned.get())
            assertFalse(stateGate.isCompleted)
            assertFalse(devicesGate.isCompleted)
        } finally {
            stateGate.complete(Unit); devicesGate.complete(Unit)
        }
    }
}
