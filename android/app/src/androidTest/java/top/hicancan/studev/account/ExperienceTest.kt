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

    @Test fun trustRemembersThisInstallationAndSensitiveActionsStillAskForCode() {
        val account = AccountUser("test-account", "验证测试", "TEST123456", true)
        val installedTrust = AccountDevice("test-trust", "验收手机", "bearer", true, "2026-11-20T01:23:45Z", 1_800_000_000_000)
        var stored = StoredAccount(deviceId = "synthetic-account-installation")
        val storage = object : AccountStorage {
            override suspend fun read() = stored
            override suspend fun write(value: StoredAccount) { stored = value }
        }
        val changedPassword = AtomicBoolean(false)
        var trusted = false
        fun reply(vararg fields: Pair<String, JsonElement>) = PlatformReply(200, JsonObject(mapOf(*fields)))
        fun refused(code: String, message: String) = PlatformReply(401, buildJsonObject {
            putJsonObject("error") { put("code", code); put("message", message) }
        })
        val client = AccountClient(storage, PlatformTransport { path, payload, _ ->
            when (path) {
                "/auth/login" -> {
                    val body = requireNotNull(payload)
                    assertEquals("example-password", body.getValue("password").jsonPrimitive.content)
                    val enteredCode = body["totp"]?.jsonPrimitive?.content
                    if (enteredCode == null && (!trusted || body["trustedDeviceToken"]?.jsonPrimitive?.content != "fixture-trust-token")) {
                        refused("MFA_REQUIRED", "请填写动态验证码。")
                    } else {
                        if (enteredCode != null) {
                            assertEquals("123456", enteredCode)
                            assertTrue(body.getValue("trustDevice").jsonPrimitive.boolean)
                            trusted = true
                        }
                        PlatformReply(200, buildJsonObject {
                            put("user", accountJson.encodeToJsonElement(account))
                            put("accessToken", "test-access"); put("refreshToken", "test-refresh"); put("expiresIn", 600); put("deviceSessionId", "test-session")
                            if (enteredCode != null) put("trustedDeviceToken", "fixture-trust-token")
                        })
                    }
                }
                "/auth/logout" -> reply()
                "/auth/password" -> {
                    assertEquals("654321", payload?.get("totp")?.jsonPrimitive?.content)
                    changedPassword.set(true)
                    refused("MFA_INVALID", "测试拦截了密码修改。")
                }
                "/auth/devices" -> reply("items" to JsonArray(emptyList()))
                "/auth/trusted-devices" -> reply("items" to accountJson.encodeToJsonElement(if (trusted) listOf(installedTrust) else emptyList()))
                "/auth/trusted-devices/test-trust/revoke" -> { trusted = false; reply() }
                else -> error("Unexpected request: $path")
            }
        }, now = { 1000 })
        compose.runOnUiThread { compose.activity.setContent { StuDevTheme { AccountScreen(client, onBack = {}) } } }
        fun field(label: String) = compose.onNode(hasSetTextAction() and hasText(label))
        fun submit() = compose.onNodeWithTag("account-submit").performScrollTo().performClick()
        fun exit() {
            compose.onNodeWithText("退出登录").performScrollTo().performClick()
            compose.onNodeWithText("确认退出").performClick()
            compose.onNodeWithText("登录 StuDev").assertExists()
        }
        field("学号").performTextInput(account.studentId)
        field("密码").performTextInput("example-password")
        field("动态验证码或恢复码").assertDoesNotExist()
        submit()
        field("动态验证码或恢复码").performScrollTo().performTextInput("123456")
        compose.onNodeWithText("信任此设备 30 天").performScrollTo().performClick()
        submit()
        compose.onNodeWithText("我的账号").assertExists()

        exit()
        field("密码").performTextInput("example-password")
        submit()
        compose.onNodeWithText("我的账号").assertExists()
        compose.onNodeWithText("账号安全").performClick()
        field("当前密码").performScrollTo().performTextInput("example-password")
        field("新密码").performScrollTo().performTextInput("example-next-password")
        field("确认新密码").performScrollTo().performTextInput("example-next-password")
        val change = compose.onNodeWithText("修改密码并重新登录")
        change.performScrollTo().assertIsNotEnabled()
        field("动态验证码或恢复码").performScrollTo().performTextInput("654321")
        change.performScrollTo().performClick()
        compose.waitUntil(10_000) { changedPassword.get() }

        compose.onNodeWithText("登录设备").performScrollTo().performClick()
        compose.onNodeWithText("取消信任").performScrollTo().performClick()
        compose.onNodeWithText("确认取消信任").performClick()
        compose.onNodeWithText("暂无受信任的设备。").assertExists()
        exit()
        field("密码").performTextInput("example-password")
        submit()
        field("动态验证码或恢复码").assertExists()
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
