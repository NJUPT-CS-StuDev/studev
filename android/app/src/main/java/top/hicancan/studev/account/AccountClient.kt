package top.hicancan.studev.account

import top.hicancan.studev.BuildConfig
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
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
    val signature: String = "", val email: String = "", val status: String = "active", val profileComplete: Boolean = true,
    val memberships: List<AccountMembership> = emptyList())
@Serializable data class AccountMembership(val organizationName: String, val position: String = "")
fun avatarLetter(nickname: String): String = if (nickname.isEmpty()) "我" else java.text.BreakIterator.getCharacterInstance(java.util.Locale.ROOT).run {
    setText(nickname); first(); nickname.substring(0, next())
}
sealed interface AccountPresence {
    val user: AccountUser? get() = null

    data object Loading : AccountPresence
    data object Unavailable : AccountPresence
    data object SignedOut : AccountPresence
    data class SignedIn(override val user: AccountUser) : AccountPresence
}

@Serializable data class AccountState(val user: AccountUser, val enrollmentRequired: Boolean = false, val passwordChangeRequired: Boolean = false, val profileRequired: Boolean = false, val mfaRequired: Boolean = false)
@Serializable data class AccountDevice(val id: String, val deviceName: String, val kind: String, val current: Boolean, val createdAt: String, val expiresAt: Long)
@Serializable data class AccountSession(val accessToken: String, val refreshToken: String, val expiresAt: Long, val deviceSessionId: String, val user: AccountUser,
    val renewalDeferred: Boolean = false)
@Serializable data class StoredAccount(val deviceId: String = UUID.randomUUID().toString(), val session: AccountSession? = null)
interface AccountStorage { suspend fun read(): StoredAccount; suspend fun write(value: StoredAccount) }
data class PlatformReply(val status: Int, val body: JsonObject)
class PlatformFailure(val status: Int, val code: String, message: String) : Exception(message)
fun interface PlatformTransport { suspend fun send(path: String, body: JsonObject?, bearer: String?): PlatformReply }
/** An event stream from the platform: each event as it arrives; a refusal before any comes back as its reply. */
fun interface PlatformStreamer { suspend fun stream(path: String, body: JsonObject, bearer: String, onEvent: (String, JsonObject) -> Unit): PlatformReply? }
internal fun InputStream.accountBytes(limit: Int): ByteArray {
    val output = ByteArrayOutputStream(); val buffer = ByteArray(8192)
    while (true) { val count = read(buffer); if (count < 0) break; require(output.size() + count <= limit) { "Response exceeds limit" }; output.write(buffer, 0, count) }
    return output.toByteArray()
}

class HttpsPlatformStreamer : PlatformStreamer {
    override suspend fun stream(path: String, body: JsonObject, bearer: String, onEvent: (String, JsonObject) -> Unit): PlatformReply? = withContext(Dispatchers.IO) {
        require(path.startsWith('/') && !path.startsWith("//") && !path.contains('\\'))
        val connection = URI(BuildConfig.PLATFORM_HOST + "/api/platform" + path).toURL().openConnection() as HttpURLConnection
        val cancelled = launch(start = CoroutineStart.UNDISPATCHED) { try { awaitCancellation() } finally { connection.disconnect() } }
        try {
            connection.connectTimeout = 15_000; connection.readTimeout = 90_000
            connection.instanceFollowRedirects = false; connection.requestMethod = "POST"; connection.doOutput = true
            connection.setRequestProperty("Accept", "text/event-stream"); connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Authorization", "Bearer $bearer")
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            if (status !in 200..299) {
                val bytes = connection.errorStream?.use { it.accountBytes(65_536) } ?: byteArrayOf()
                return@withContext PlatformReply(status, runCatching { accountJson.parseToJsonElement(bytes.toString(Charsets.UTF_8)).jsonObject }.getOrElse { buildJsonObject {} })
            }
            connection.inputStream.bufferedReader(Charsets.UTF_8).use { reader ->
                var event: String? = null
                while (true) {
                    currentCoroutineContext().ensureActive()
                    val line = reader.readLine() ?: break
                    when {
                        line.startsWith("event: ") -> event = line.removePrefix("event: ")
                        line.startsWith("data: ") -> event?.let { onEvent(it, accountJson.parseToJsonElement(line.removePrefix("data: ")).jsonObject) }
                        line.isEmpty() -> event = null
                    }
                }
            }
            null
        } finally { cancelled.cancel(); connection.disconnect() }
    }
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
                throw PlatformFailure(status, "INVALID_RESPONSE", "暂时连不上，请稍后再试。")
            }
            PlatformReply(status, value)
        } finally { connection.disconnect() }
    }
}

class AccountClient(private val storage: AccountStorage, private val transport: PlatformTransport, private val now: () -> Long = System::currentTimeMillis, private val streamer: PlatformStreamer = HttpsPlatformStreamer()) {
    private val lock = Mutex()
    private val accountPresence = kotlinx.coroutines.flow.MutableStateFlow<AccountPresence>(AccountPresence.Loading)
    val presence: kotlinx.coroutines.flow.StateFlow<AccountPresence> = accountPresence

    private fun publish(user: AccountUser?) {
        accountPresence.value = user?.let { AccountPresence.SignedIn(it) } ?: AccountPresence.SignedOut
    }
    private suspend fun keep(stored: StoredAccount) {
        storage.write(stored)
        publish(stored.session?.user)
    }
    private suspend fun restore(): StoredAccount = try {
        storage.read().also { saved ->
            if (accountPresence.value == AccountPresence.Loading || accountPresence.value == AccountPresence.Unavailable) {
                publish(saved.session?.user)
            }
        }
    } catch (failure: java.io.IOException) {
        if (accountPresence.value == AccountPresence.Loading) accountPresence.value = AccountPresence.Unavailable
        throw failure
    }
    suspend fun current(): AccountUser? = when (val shown = accountPresence.value) {
        AccountPresence.Loading, AccountPresence.Unavailable -> lock.withLock {
            when (val restored = accountPresence.value) {
                AccountPresence.Loading, AccountPresence.Unavailable -> restore().session?.user
                else -> restored.user
            }
        }
        else -> shown.user
    }
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
    suspend fun signIn(studentId: String, password: String, totp: String, deviceName: String): AccountState = lock.withLock {
        val stored = restore()
        val value = checked(transport.send("/auth/login", buildJsonObject {
            put("studentId", studentId.trim()); put("password", password); put("deviceId", stored.deviceId); put("deviceName", deviceName.take(80))
            if (totp.isNotBlank()) put("totp", totp.trim())
        }, null))
        val state = accountJson.decodeFromJsonElement<AccountState>(value)
        keep(stored.copy(session = tokens(value, state.user)))
        state
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
            val stored = restore()
            if (stored.session?.user?.id == state.user.id) keep(stored.copy(session = stored.session.copy(user = state.user)))
        }
        return state
    }
    suspend fun devices(): List<AccountDevice> = accountJson.decodeFromJsonElement(request("/auth/devices", authenticated = true).getValue("items"))
    suspend fun revokeDevice(id: String) { request("/auth/devices/$id/revoke", buildJsonObject {}, authenticated = true) }
    suspend fun forget() = lock.withLock { val stored = restore(); keep(stored.copy(session = null)) }
    private suspend fun access(forceFor: AccountSession? = null, foreground: Boolean = true): AccountSession = lock.withLock {
        val stored = restore()
        val session = stored.session ?: throw PlatformFailure(401, "AUTH_REQUIRED", "请先登录。")
        if (forceFor != null && session.deviceSessionId != forceFor.deviceSessionId) throw PlatformFailure(401, "ACCOUNT_CHANGED", "登录账号已更改，请重新操作。")
        if (session.expiresAt > now() + 30_000 && (!foreground || !session.renewalDeferred) &&
            (forceFor == null || session.accessToken != forceFor.accessToken)) return@withLock session
        try {
            // Never retry a refresh after an ambiguous network result: rotation
            // might have committed. Persist the spent intent BEFORE sending,
            // so even process death requires sign-in rather than token replay.
            storage.write(stored.copy(session = null))
            val value = checked(transport.send("/auth/refresh", buildJsonObject {
                put("refreshToken", session.refreshToken)
                put("deviceId", stored.deviceId)
                put("foreground", foreground)
            }, null))
            val fresh = tokens(value, session.user).copy(renewalDeferred = !foreground)
            keep(stored.copy(session = fresh)); fresh
        } catch (failure: Exception) {
            // UI/navigation cancellation may arrive after the server spent the
            // ticket. Finish the durable cleanup before releasing the mutex.
            withContext(NonCancellable) { keep(stored.copy(session = null)) }
            throw failure
        }
    }
    private fun expired(reply: PlatformReply): Boolean = reply.status == 401 &&
        reply.body["error"]?.jsonObject?.get("code")?.jsonPrimitive?.content in setOf("TOKEN_INVALID", "AUTH_REQUIRED")
    private suspend fun authenticatedRequest(path: String, body: JsonObject?, credential: AccountSession, foreground: Boolean): JsonObject {
        var reply = transport.send(path, body, credential.accessToken)
        if (expired(reply)) reply = transport.send(path, body, access(forceFor = credential, foreground = foreground).accessToken)
        return checked(reply)
    }
    suspend fun request(path: String, body: JsonObject? = null, authenticated: Boolean = false, foreground: Boolean = true): JsonObject {
        if (!authenticated) return checked(transport.send(path, body, null))
        return authenticatedRequest(path, body, access(foreground = foreground), foreground)
    }
    /** An event stream for someone signed in, renewing the pass once if it ran out before the stream began. */
    suspend fun stream(path: String, body: JsonObject, onEvent: (String, JsonObject) -> Unit) {
        val credential = access()
        var refused = streamer.stream(path, body, credential.accessToken, onEvent)
        if (refused != null && expired(refused)) refused = streamer.stream(path, body, access(forceFor = credential).accessToken, onEvent)
        refused?.let(::checked)
    }
    suspend fun signOut() {
        val credential = access(foreground = false)
        authenticatedRequest("/auth/logout", buildJsonObject {}, credential, foreground = false)
        lock.withLock {
            val stored = restore()
            if (stored.session?.deviceSessionId == credential.deviceSessionId) keep(stored.copy(session = null))
        }
    }
}
