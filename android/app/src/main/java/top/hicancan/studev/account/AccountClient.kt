package top.hicancan.studev.account

import top.hicancan.studev.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
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

const val PLATFORM_ORIGIN = BuildConfig.SITE_ORIGIN
internal val accountJson = Json { ignoreUnknownKeys = true; encodeDefaults = true }
@Serializable data class AccountUser(val id: String, val nickname: String, val studentId: String = "", val totpEnabled: Boolean = false, val realName: String = "", val qq: String = "", val role: String = "user", val revision: Int = 0,
    val department: String = "", val title: String = "", val signature: String = "", val email: String = "", val status: String = "active", val profileComplete: Boolean = true)
/** What an account's state is called, as on the web. */
val AccountUser.statusName: String get() = when (status) { "active" -> "启用"; "disabled" -> "停用"; "pending" -> "待注册"; else -> status }
/** The nickname shown after the real name; blank when it only repeats the name, student ID or QQ (same rule as the web). */
val AccountUser.displayNickname: String get() = nickname.trim().takeUnless { it.isEmpty() || it == realName || it == studentId || it == qq }.orEmpty()
/** What a role is called: the same three names as the web. */
val AccountUser.roleName: String get() = when (role) { "owner" -> "所有者"; "admin" -> "管理员"; else -> "用户" }
@Serializable data class AccountState(val user: AccountUser, val enrollmentRequired: Boolean = false, val passwordChangeRequired: Boolean = false, val profileRequired: Boolean = false, val mfaRequired: Boolean = false)
@Serializable data class AccountDevice(val id: String, val deviceName: String, val kind: String, val current: Boolean, val createdAt: String, val expiresAt: Long)
@Serializable data class AccountSession(val accessToken: String, val refreshToken: String, val expiresAt: Long, val deviceSessionId: String, val user: AccountUser)
@Serializable data class UploadReceipt(val userId: String, val token: String)
@Serializable data class StoredAccount(val deviceId: String = UUID.randomUUID().toString(), val session: AccountSession? = null, val uploads: Map<String, UploadReceipt> = emptyMap())
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
        val connection = URI(BuildConfig.PLATFORM_HOST + "/api/platform" + path).toURL().openConnection() as HttpURLConnection
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
    private val signedIn = kotlinx.coroutines.flow.MutableStateFlow<AccountUser?>(null)
    /** Who is signed in, updated the moment that changes: signing in or out, a refreshed session, a saved profile. */
    val user: kotlinx.coroutines.flow.StateFlow<AccountUser?> = signedIn
    /** Every change to the stored account goes through here, so [user] always says what is stored. */
    private suspend fun keep(stored: StoredAccount) { storage.write(stored); signedIn.value = stored.session?.user }
    suspend fun current(): AccountUser? = lock.withLock { storage.read().session?.user.also { signedIn.value = it } }
    /** Upload receipts share the account's encrypted storage and are available only to their original account. */
    suspend fun keepUpload(id: String, token: String, owner: String) = lock.withLock {
        val stored = storage.read()
        val user = stored.session?.user ?: throw PlatformFailure(401, "LOGIN_REQUIRED", "请先登录。")
        require(user.id == owner) { "登录账号已更改，请回到原账号确认上传。" }
        keep(stored.copy(uploads = stored.uploads + (id to UploadReceipt(user.id, token))))
    }
    suspend fun uploadReceipt(id: String): String? = lock.withLock { val stored = storage.read(); stored.uploads[id]?.takeIf { it.userId == stored.session?.user?.id }?.token }
    suspend fun forgetUpload(id: String) = lock.withLock { val stored = storage.read(); keep(stored.copy(uploads = stored.uploads - id)) }
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
        val value = checked(transport.send("/auth/login", buildJsonObject {
            put("studentId", studentId.trim()); put("password", password); put("deviceId", stored.deviceId); put("deviceName", deviceName.take(80))
            if (totp.isNotBlank()) put("totp", totp.trim())
        }, null))
        val user = accountJson.decodeFromJsonElement<AccountUser>(value.getValue("user"))
        keep(stored.copy(session = tokens(value, user)))
        user
    }
    suspend fun register(studentId: String, realName: String, nickname: String, qq: String, password: String) {
        checked(transport.send("/auth/register", buildJsonObject {
            put("studentId", studentId.trim()); put("realName", realName.trim()); put("nickname", nickname.trim())
            put("qq", qq.trim()); put("password", password)
        }, null))
    }
    suspend fun state(): AccountState {
        val value = request("/auth/session", authenticated = true)
        val state = accountJson.decodeFromJsonElement<AccountState>(value)
        lock.withLock {
            val stored = storage.read()
            if (stored.session?.user?.id == state.user.id) keep(stored.copy(session = stored.session.copy(user = state.user)))
        }
        return state
    }
    suspend fun devices(): List<AccountDevice> = accountJson.decodeFromJsonElement(request("/auth/devices", authenticated = true).getValue("items"))
    suspend fun revokeDevice(id: String) { request("/auth/devices/$id/revoke", buildJsonObject {}, authenticated = true) }
    suspend fun forget() = lock.withLock { val stored = storage.read(); keep(stored.copy(session = null)) }
    private suspend fun access(forceFor: AccountSession? = null): AccountSession = lock.withLock {
        val stored = storage.read()
        val session = stored.session ?: throw PlatformFailure(401, "AUTH_REQUIRED", "请先登录。")
        if (forceFor != null && session.deviceSessionId != forceFor.deviceSessionId) throw PlatformFailure(401, "ACCOUNT_CHANGED", "登录账号已更改，请重新操作。")
        if (session.expiresAt > now() + 30_000 && (forceFor == null || session.accessToken != forceFor.accessToken)) return@withLock session
        try {
            // Never retry a refresh after an ambiguous network result: rotation
            // might have committed. Persist the spent intent BEFORE sending,
            // so even process death requires sign-in rather than token replay.
            keep(stored.copy(session = null))
            val value = checked(transport.send("/auth/refresh", buildJsonObject { put("refreshToken", session.refreshToken); put("deviceId", stored.deviceId) }, null))
            val fresh = tokens(value, session.user)
            keep(stored.copy(session = fresh)); fresh
        } catch (failure: Exception) {
            // UI/navigation cancellation may arrive after the server spent the
            // ticket. Finish the durable cleanup before releasing the mutex.
            withContext(NonCancellable) { keep(stored.copy(session = null)) }
            throw failure
        }
    }
    private suspend fun authenticatedRequest(path: String, body: JsonObject?, credential: AccountSession): JsonObject {
        var reply = transport.send(path, body, credential.accessToken)
        if (reply.status == 401) reply = transport.send(path, body, access(forceFor = credential).accessToken)
        return checked(reply)
    }
    suspend fun request(path: String, body: JsonObject? = null, authenticated: Boolean = false): JsonObject {
        if (!authenticated) return checked(transport.send(path, body, null))
        return authenticatedRequest(path, body, access())
    }
    suspend fun signOut() {
        val credential = access()
        authenticatedRequest("/auth/logout", buildJsonObject {}, credential)
        lock.withLock {
            val stored = storage.read()
            if (stored.session?.deviceSessionId == credential.deviceSessionId) keep(stored.copy(session = null))
        }
    }
}
