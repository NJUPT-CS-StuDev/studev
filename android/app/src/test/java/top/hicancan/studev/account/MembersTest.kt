package top.hicancan.studev.account

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class MembersTest {
    @Test fun memberDirectoryUsesItsPublicContractAndUnwrapsDetails() = runBlocking {
        val member = PublicMember("public-a", "灿", "一起学习", "https://studev.example/api/platform/members/public-a/avatar")
        var stored = StoredAccount("member-test-device", AccountSession("test-only-access", "test-only-refresh", Long.MAX_VALUE, "test-only-family", AccountUser("self", "本人")))
        val storage = object : AccountStorage { override suspend fun read() = stored; override suspend fun write(value: StoredAccount) { stored = value } }
        val calls = mutableListOf<String>()
        val transport = PlatformTransport { path, _, _ ->
            calls += path
            PlatformReply(200, if (path.startsWith("/members?")) buildJsonObject {
                put("items", JsonArray(listOf(accountJson.encodeToJsonElement(member)))); put("total", 1); put("offset", 0); put("limit", 50)
            } else buildJsonObject { put("member", accountJson.encodeToJsonElement(member)) })
        }
        val client = AccountClient(storage, transport)
        assertEquals(member, client.members("灿").items.single())
        assertEquals(member, client.member("public-a"))
        assertTrue(calls.all { it.startsWith("/members") })
        assertEquals(setOf("id", "nickname", "signature", "avatarUrl"), accountJson.encodeToJsonElement(member).jsonObject.keys)
    }
}
