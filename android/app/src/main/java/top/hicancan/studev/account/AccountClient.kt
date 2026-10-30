package top.hicancan.studev.account

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import java.net.HttpURLConnection
import java.net.URI
import java.util.UUID
import java.io.InputStream
import java.io.ByteArrayOutputStream

const val PLATFORM_ORIGIN = "https://studev.hicancan.top"
internal val accountJson = Json { ignoreUnknownKeys = true; encodeDefaults = true }
@Serializable data class AccountUser(val id: String, val nickname: String, val studentId: String = "", val totpEnabled: Boolean = false)
@Serializable data class AccountSession(val accessToken: String, val refreshToken: String, val expiresAt: Long, val deviceSessionId: String, val user: AccountUser)
@Serializable data class StoredAccount(val deviceId: String = UUID.randomUUID().toString(), val session: AccountSession? = null)
interface AccountStorage { suspend fun read(): StoredAccount; suspend fun write(value: StoredAccount) }
data class PlatformReply(val status: Int, val body: JsonObject)
class PlatformFailure(val status: Int, val code: String, message: String) : Exception(message)
fun interface PlatformTransport { suspend fun send(path: String, body: JsonObject?, bearer: String?): PlatformReply }
internal fun InputStream.accountBytes(limit: Int): ByteArray {
    val output = ByteArrayOutputStream(); val buffer = ByteArray(8192)
    while (true) { val count = read(buffer); if (count < 0) break; require(output.size() + count <= limit) { "Response exceeds limit" }; output.write(buffer, 0, count) }
    return output.toByteArray()
}

class HttpsPlatformTransport : PlatformTransport {
    override suspend fun send(path: String, body: JsonObject?, bearer: String?): PlatformReply = withContext(Dispatchers.IO) {
        require(path.startsWith('/') && !path.startsWith("//") && !path.contains('\\'))
        val connection = URI(PLATFORM_ORIGIN + "/api/platform" + path).toURL().openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 15_000; connection.readTimeout = 15_000
            connection.instanceFollowRedirects = false
            connection.requestMethod = if (body == null) "GET" else "POST"
            connection.setRequestProperty("Accept", "application/json")
            bearer?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
            if (body != null) {
                connection.doOutput = true; connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val bytes = stream?.use { it.accountBytes(1_048_576) } ?: byteArrayOf()
            val value = runCatching { accountJson.parseToJsonElement(bytes.toString(Charsets.UTF_8)).jsonObject }.getOrElse {
                throw PlatformFailure(status, "INVALID_RESPONSE", "服务暂时无法响应，请稍后重试。")
            }
            PlatformReply(status, value)
        } finally { connection.disconnect() }
    }
}

class AccountClient(private val storage: AccountStorage, private val transport: PlatformTransport, private val now: () -> Long = System::currentTimeMillis) {
    private val lock = Mutex()
    suspend fun current(): AccountUser? = storage.read().session?.user
    private fun checked(reply: PlatformReply): JsonObject {
        if (reply.status !in 200..299) {
            val error = reply.body["error"]?.jsonObject
            throw PlatformFailure(reply.status, error?.get("code")?.jsonPrimitive?.content ?: "REQUEST_FAILED", error?.get("message")?.jsonPrimitive?.content ?: "操作未完成，请稍后重试。")
        }
        return reply.body
    }
    private fun tokens(value: JsonObject, user: AccountUser): AccountSession = AccountSession(
        value.getValue("accessToken").jsonPrimitive.content, value.getValue("refreshToken").jsonPrimitive.content,
        now() + value.getValue("expiresIn").jsonPrimitive.long * 1000,
        value.getValue("deviceSessionId").jsonPrimitive.content, user,
    )
    suspend fun signIn(studentId: String, password: String, totp: String, deviceName: String): AccountUser = lock.withLock {
        val stored = storage.read()
        val value = checked(transport.send("/auth/token", buildJsonObject {
            put("studentId", studentId.trim()); put("password", password); put("deviceId", stored.deviceId); put("deviceName", deviceName.take(80))
            if (totp.isNotBlank()) put("totp", totp.trim())
        }, null))
        val user = accountJson.decodeFromJsonElement<AccountUser>(value.getValue("user"))
        storage.write(stored.copy(session = tokens(value, user)))
        user
    }
    private suspend fun access(forceFor: String? = null): String = lock.withLock {
        val stored = storage.read()
        val session = stored.session ?: throw PlatformFailure(401, "AUTH_REQUIRED", "请先登录。")
        if (session.expiresAt > now() + 30_000 && (forceFor == null || session.accessToken != forceFor)) return@withLock session.accessToken
        try {
            // Never retry a refresh after an ambiguous network result: rotation
            // might have committed. The next attempt requires a fresh sign-in.
            val value = checked(transport.send("/auth/token/refresh", buildJsonObject { put("refreshToken", session.refreshToken); put("deviceId", stored.deviceId) }, null))
            val fresh = tokens(value, session.user)
            storage.write(stored.copy(session = fresh)); fresh.accessToken
        } catch (failure: Exception) {
            storage.write(stored.copy(session = null)); throw failure
        }
    }
    suspend fun request(path: String, body: JsonObject? = null, authenticated: Boolean = false): JsonObject {
        if (!authenticated) return checked(transport.send(path, body, null))
        val token = access()
        var reply = transport.send(path, body, token)
        if (reply.status == 401) reply = transport.send(path, body, access(forceFor = token))
        return checked(reply)
    }
    suspend fun signOut() {
        request("/auth/logout", buildJsonObject {}, authenticated = true)
        lock.withLock { storage.write(storage.read().copy(session = null)) }
    }
}
