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
