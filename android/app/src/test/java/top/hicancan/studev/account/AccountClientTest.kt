package top.hicancan.studev.account

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import javax.crypto.KeyGenerator

class AccountClientTest {
    private class Storage : AccountStorage {
        var value = StoredAccount(deviceId = "test-device-00000001")
        override suspend fun read() = value
        override suspend fun write(value: StoredAccount) { this.value = value }
    }
    private fun reply(access: String = "access-one", refresh: String = "refresh-one", family: String = "session-id") = PlatformReply(200, buildJsonObject {
        put("accessToken", access); put("refreshToken", refresh); put("expiresIn", 600); put("deviceSessionId", family)
        put("user", buildJsonObject { put("id", "user-id"); put("nickname", "测试成员"); put("studentId", "TEST123456"); put("totpEnabled", true) })
    })
    @Test fun signInPersistsTokensAndDeviceButNeverPasswordOrFactor() = runBlocking {
        val storage = Storage()
        val client = AccountClient(storage, PlatformTransport { path, body, bearer ->
            assertEquals("/auth/login", path); assertNull(bearer)
            assertEquals("test-device-00000001", body!!.getValue("deviceId").jsonPrimitive.content)
            assertEquals("123456", body.getValue("totp").jsonPrimitive.content)
            reply()
        }, now = { 1000 })
        assertEquals("测试成员", client.signIn("TEST123456", "secret-password", "123456", "测试手机").nickname)
        val persisted = accountJson.encodeToString(storage.value)
        assertFalse(persisted.contains("secret-password")); assertFalse(persisted.contains("\"totp\""))
        assertEquals(601000, storage.value.session!!.expiresAt)
    }
    @Test fun concurrentExpiredRequestsRotateOnlyOnceAndUseNewAccess() = runBlocking {
        val storage = Storage()
        var refreshCount = 0
        val client = AccountClient(storage, PlatformTransport { path, body, bearer ->
            when (path) {
                "/auth/login" -> reply()
                "/auth/refresh" -> { refreshCount++; assertEquals("refresh-one", body!!.getValue("refreshToken").jsonPrimitive.content); reply("access-two", "refresh-two") }
                else -> { assertEquals("access-two", bearer); PlatformReply(200, buildJsonObject { put("ok", true) }) }
            }
        }, now = { 10_000 })
        client.signIn("TEST123456", "password", "", "device")
        storage.value = storage.value.copy(session = storage.value.session!!.copy(expiresAt = 1))
        coroutineScope { (1..8).map { async { client.request("/auth/devices", authenticated = true) } }.awaitAll() }
        assertEquals(1, refreshCount); assertEquals("refresh-two", storage.value.session!!.refreshToken)
    }
    @Test fun unauthorizedAccessRetriesOnceWithRotatedToken() = runBlocking {
        val storage = Storage(); var calls = 0
        val client = AccountClient(storage, PlatformTransport { path, _, bearer -> when (path) {
            "/auth/login" -> reply()
            "/auth/refresh" -> reply("access-two", "refresh-two")
            else -> { calls++; PlatformReply(if (bearer == "access-one") 401 else 200, buildJsonObject {}) }
        } })
        client.signIn("TEST123456", "password", "", "device")
        client.request("/auth/devices", authenticated = true)
        assertEquals(2, calls)
    }
    @Test fun ambiguousRefreshClearsSessionWithoutReusingRefresh() = runBlocking {
        val storage = Storage(); var refreshes = 0
        val client = AccountClient(storage, PlatformTransport { path, _, _ -> if (path == "/auth/login") reply() else { refreshes++; throw java.io.IOException("test timeout") } })
        client.signIn("TEST123456", "password", "", "device")
        storage.value = storage.value.copy(session = storage.value.session!!.copy(expiresAt = 0))
        try { client.request("/auth/devices", authenticated = true); fail() } catch (_: java.io.IOException) { }
        assertNull(storage.value.session); assertEquals(1, refreshes)
        try { client.request("/auth/devices", authenticated = true); fail() } catch (e: PlatformFailure) { assertEquals("AUTH_REQUIRED", e.code) }
        assertEquals(1, refreshes)
    }
    @Test fun signOutRevokesBeforeClearingAndKeepsStableDeviceId() = runBlocking {
        val storage = Storage(); var revoked = false
        val client = AccountClient(storage, PlatformTransport { path, _, bearer -> if (path == "/auth/login") reply() else { assertEquals("/auth/logout", path); assertEquals("access-one", bearer); revoked = true; PlatformReply(200, buildJsonObject {}) } })
        client.signIn("TEST123456", "password", "", "device"); client.signOut()
        assertTrue(revoked); assertNull(client.current()); assertEquals("test-device-00000001", storage.value.deviceId)
    }
    @Test fun cancelledRefreshClearsSpentCredentialsBeforeAnotherRequest() = runBlocking {
        val memory = Storage()
        val storage = object : AccountStorage {
            override suspend fun read() = memory.read()
            override suspend fun write(value: StoredAccount) {
                // DataStore writes suspend and honor cancellation.
                currentCoroutineContext().ensureActive()
                memory.write(value)
            }
        }
        val rotated = CompletableDeferred<Unit>(); var refreshes = 0
        val client = AccountClient(storage, PlatformTransport { path, _, _ ->
            if (path == "/auth/login") reply() else {
                refreshes++; rotated.complete(Unit); awaitCancellation()
            }
        })
        client.signIn("TEST123456", "password", "", "device")
        memory.value = memory.value.copy(session = memory.value.session!!.copy(expiresAt = 0))
        val request = launch { client.request("/auth/devices", authenticated = true) }
        rotated.await(); request.cancelAndJoin()
        assertNull(memory.value.session)
        try { client.request("/auth/devices", authenticated = true); fail() } catch (e: PlatformFailure) { assertEquals("AUTH_REQUIRED", e.code) }
        assertEquals(1, refreshes)
    }
    @Test fun processDeathDuringRotationCannotLeaveAReusableRefreshTokenOnDisk() = runBlocking {
        val storage = Storage(); val processStopped = AssertionError("Synthetic process death")
        val client = AccountClient(storage, PlatformTransport { path, _, _ ->
            if (path == "/auth/login") reply() else throw processStopped
        })
        client.signIn("TEST123456", "password", "", "device")
        storage.value = storage.value.copy(session = storage.value.session!!.copy(expiresAt = 0))
        try { client.request("/auth/devices", authenticated = true); fail() } catch (e: AssertionError) { assertSame(processStopped, e) }
        // A new process can only use persisted storage; no finalizer ran.
        val restarted = AccountClient(storage, PlatformTransport { _, _, _ -> error("Must require sign-in, not replay the spent refresh") })
        assertNull(restarted.current())
    }
    @Test fun failedMutationIsNeverRetriedAsANewlySignedInAccount() = runBlocking {
        val storage = Storage(); val sent = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        val tokensUsed = mutableListOf<String?>(); var logins = 0
        val client = AccountClient(storage, PlatformTransport { path, _, bearer -> when (path) {
            "/auth/login" -> { logins++; reply("access-$logins", "refresh-$logins", "family-$logins") }
            "/auth/devices" -> { tokensUsed.add(bearer); sent.complete(Unit); release.await(); PlatformReply(401, buildJsonObject {}) }
            else -> error("Unexpected request: $path")
        } })
        client.signIn("ACCOUNT1", "password", "", "device")
        val mutation = async { runCatching { client.request("/auth/devices", buildJsonObject {}, authenticated = true) } }
        sent.await(); client.signIn("ACCOUNT2", "password", "", "device"); release.complete(Unit)
        assertTrue(mutation.await().exceptionOrNull() is PlatformFailure)
        assertEquals(listOf("access-1"), tokensUsed)
        assertEquals("family-2", storage.value.session!!.deviceSessionId)
    }
    @Test fun delayedLogoutDoesNotEraseALaterSignIn() = runBlocking {
        val storage = Storage(); val sent = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>(); var logins = 0
        val client = AccountClient(storage, PlatformTransport { path, _, bearer -> when (path) {
            "/auth/login" -> { logins++; reply("access-$logins", "refresh-$logins", "family-$logins") }
            "/auth/logout" -> { assertEquals("access-1", bearer); sent.complete(Unit); release.await(); PlatformReply(200, buildJsonObject {}) }
            else -> error("Unexpected request: $path")
        } })
        client.signIn("ACCOUNT1", "password", "", "device")
        val logout = async { client.signOut() }
        sent.await(); client.signIn("ACCOUNT2", "password", "", "device"); release.complete(Unit); logout.await()
        assertEquals("family-2", storage.value.session?.deviceSessionId)
    }
    @Test fun encryptionRoundTripsUsesFreshIvAndRejectsTamperingAndWrongKey() {
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val cipher = AccountCipher { key }
        val bytes = "test-access-and-refresh".toByteArray()
        val encrypted = cipher.encrypt(bytes)
        assertArrayEquals(bytes, cipher.decrypt(encrypted)); assertFalse(encrypted.contentEquals(cipher.encrypt(bytes)))
        assertFalse(encrypted.toString(Charsets.UTF_8).contains("test-access"))
        encrypted[15] = (encrypted[15].toInt() xor 1).toByte()
        try { cipher.decrypt(encrypted); fail() } catch (_: java.security.GeneralSecurityException) { }
        val wrong = AccountCipher { KeyGenerator.getInstance("AES").apply { init(256) }.generateKey() }
        try { wrong.decrypt(cipher.encrypt(bytes)); fail() } catch (_: java.security.GeneralSecurityException) { }
    }
}
