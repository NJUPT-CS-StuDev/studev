package top.hicancan.studev

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import top.hicancan.studev.account.Accounts
import java.io.File
import java.net.HttpURLConnection
import java.net.URI

/** Local platform only: real handler, Keystore, Compose, HTTP and device sessions. */
class AccountFlowTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext
    private fun waitText(text: String) { compose.waitUntil(30_000) { compose.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().isNotEmpty() } }
    private fun fill(label: String, value: String) { compose.onNodeWithText(label, substring = false).performScrollTo().performTextReplacement(value) }
    private fun shot(name: String) {
        compose.waitForIdle()
        val bitmap = instrumentation.uiAutomation.takeScreenshot()
        val file = File(context.getExternalFilesDir(null), "accounts/$name.png"); file.parentFile!!.mkdirs()
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }; bitmap.recycle()
    }
    private fun browserLogin(student: String, password: String) {
        val connection = URI(BuildConfig.PLATFORM_HOST + "/api/platform/auth/login").toURL().openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"; connection.connectTimeout = 15_000; connection.readTimeout = 15_000; connection.doOutput = true
            connection.setRequestProperty("Origin", BuildConfig.PLATFORM_HOST); connection.setRequestProperty("Content-Type", "application/json")
            val body = JSONObject().put("studentId", student).put("password", password).put("deviceId", "acceptance-browser-00001").put("deviceName", "网页验收浏览器")
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
            assertEquals(200, connection.responseCode)
            val reply = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
            assertFalse(reply.has("accessToken")); assertFalse(reply.has("refreshToken"))
        } finally { connection.disconnect() }
    }
    @Test fun registerSignInAndManageWebAndAppDevices() {
        check(BuildConfig.DEBUG && URI(BuildConfig.PLATFORM_HOST).host == "127.0.0.1") { "Account acceptance requires the loopback platform fixture." }
        runBlocking { Accounts.get(context).forget() }
        val student = "EMU${System.currentTimeMillis()}"
        val password = "Synthetic-emulator-password-123"
        compose.onNodeWithTag("tab-me").performClick()
        compose.onNodeWithTag("open-account").performScrollTo().performClick()
        waitText("登录 studev")
        compose.onNodeWithText("注册", substring = false).performClick()
        fill("学号", student); fill("真实姓名", "合成测试同学"); fill("昵称", "模拟器同学")
        fill("联系 QQ", (100000000L + System.currentTimeMillis() % 800000000).toString())
        fill("密码", password); fill("确认密码", password)
        shot("register")
        compose.onNodeWithTag("account-submit").performScrollTo().performClick()
        waitText("注册成功")
        fill("密码", password)
        compose.onNodeWithTag("account-submit").performScrollTo().performClick()
        waitText("模拟器同学")
        compose.onNodeWithText("资料", substring = false).performScrollTo().assertExists()
        shot("signed-in")
        browserLogin(student, password)
        compose.onNodeWithText("设备", substring = false).performScrollTo().performClick()
        waitText("网页验收浏览器")
        compose.onNodeWithText("Android · 当前设备", substring = false).assertExists()
        shot("mixed-devices")
        // Revoke the browser session from the same device UI used in production.
        compose.onAllNodesWithText("退出此设备", substring = false).onFirst().performScrollTo().performClick()
        waitText("确认退出")
        compose.onNodeWithText("确认退出", substring = false).performClick()
        compose.waitUntil(30_000) { compose.onAllNodesWithText("网页验收浏览器").fetchSemanticsNodes().isEmpty() }
        shot("device-revoked")
        runBlocking { Accounts.get(context).signOut() }
    }
}
