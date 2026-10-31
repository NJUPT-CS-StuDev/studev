package top.hicancan.studev.activities

import kotlinx.serialization.json.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import top.hicancan.studev.account.*

class ActivitiesTest {
    private val id = "00000000-0000-0000-0000-000000000001"
    @Test fun activityLinksAcceptOnlyOurHttpsMapAndOneValidId() {
        assertEquals(id, ActivityLinks.parse(ActivityLinks.url(id)))
        assertEquals(id, ActivityLinks.parse("https://studev.hicancan.top/map?activity=$id"))
        for (url in listOf("http://studev.hicancan.top/map/?activity=$id", "https://evil.invalid/map/?activity=$id", "https://studev.hicancan.top.evil.invalid/map/?activity=$id", "https://studev.hicancan.top@evil.invalid/map/?activity=$id", "https://evil@studev.hicancan.top/map/?activity=$id", "https://studev.hicancan.top:444/map/?activity=$id", "https://studev.hicancan.top/account/?activity=$id", "https://studev.hicancan.top/map/?activity=$id&activity=$id", "https://studev.hicancan.top/map/?activity=../../private", "https://studev.hicancan.top/map/?place=$id")) assertNull(url, ActivityLinks.parse(url))
    }
    @Test fun sharedPlaceContractUsesKindDiscriminatorWithoutNullPlaceholders() {
        val campus: ActivityPlace = ActivityPlace.Campus("教3")
        assertEquals("""{"kind":"campus","id":"教3"}""", activityJson.encodeToString(campus))
        val point: ActivityPlace = ActivityPlace.Point("集合点", listOf(118.926, 32.114))
        val encoded = activityJson.encodeToString(point)
        assertFalse(encoded.contains("null")); assertTrue(encoded.contains("\"kind\":\"point\""))
        assertEquals(point, activityJson.decodeFromString<ActivityPlace>(encoded))
    }
    @Test fun draftValidationRejectsInvalidTimeTitleVisibilityAndCoordinates() {
        val draft = ActivityDraft("校园散步", "2026-10-31T10:00:00Z", "2026-10-31T12:00:00Z", ActivityPlace.Campus("教3"))
        validateDraft(draft)
        for (bad in listOf(draft.copy(title = ""), draft.copy(endsAt = draft.startsAt), draft.copy(startsAt = "tomorrow"), draft.copy(description = "字".repeat(2001)), draft.copy(visibility = "private"), draft.copy(place = ActivityPlace.Point("x", listOf(181.0, 32.0))), draft.copy(place = ActivityPlace.Point("x", listOf(Double.NaN, 32.0))), draft.copy(place = ActivityPlace.Point("", listOf(118.0, 32.0))))) {
            try { validateDraft(bad); fail() } catch (_: IllegalArgumentException) { }
        }
    }
    @Test fun publicReadNeedsNoAccountAndDecodesTheServerContract() = runBlocking {
        val storage = object : AccountStorage {
            override suspend fun read() = StoredAccount()
            override suspend fun write(value: StoredAccount) { fail("Public read must not write account credentials") }
        }
        val activity = CampusActivity(id, "校园散步", "2026-10-31T10:00:00Z", "2026-10-31T12:00:00Z", ActivityPlace.Campus("教3"), "集合说明", Organiser("owner", "发起人"), "unlisted", 2, "2026-10-30T10:00:00Z", "2026-10-30T10:00:00Z")
        val client = AccountClient(storage, PlatformTransport { path, body, bearer ->
            assertNull(body); assertNull(bearer); assertEquals("/activities/$id", path)
            PlatformReply(200, buildJsonObject { put("activity", activityJson.encodeToJsonElement(activity)) })
        })
        assertEquals(activity, Activities(client).get(id))
    }
    @Test fun authenticatedCreateEditAndDeleteUsePlaceContractAndExpectedRevision() = runBlocking {
        val user = AccountUser("owner", "发起人")
        val storage = object : AccountStorage {
            private var value = StoredAccount(session = AccountSession("access", "refresh", Long.MAX_VALUE, "device-session", user))
            override suspend fun read() = value
            override suspend fun write(value: StoredAccount) { this.value = value }
        }
        val draft = ActivityDraft("校园散步", "2026-10-31T10:00:00Z", "2026-10-31T12:00:00Z", ActivityPlace.Point("集合点", listOf(118.926, 32.114)))
        val activity = CampusActivity(id, draft.title, draft.startsAt, draft.endsAt, draft.place, draft.description, Organiser(user.id, user.nickname), draft.visibility, 2, "2026-10-30T10:00:00Z", "2026-10-30T10:00:00Z")
        val calls = mutableListOf<Pair<String, JsonObject>>()
        val client = AccountClient(storage, PlatformTransport { path, body, bearer ->
            assertEquals("access", bearer); calls += path to body!!
            PlatformReply(200, buildJsonObject { put("activity", activityJson.encodeToJsonElement(activity)) })
        })
        val service = Activities(client)
        assertEquals(activity, service.save(draft))
        service.save(draft, activity); service.delete(activity)
        assertEquals(listOf("/activities", "/activities/$id", "/activities/$id/delete"), calls.map { it.first })
        assertEquals("point", calls[0].second.getValue("place").jsonObject.getValue("kind").jsonPrimitive.content)
        assertFalse(calls[0].second.containsKey("organiser"))
        assertEquals(2, calls[1].second.getValue("revision").jsonPrimitive.int)
        assertEquals(2, calls[2].second.getValue("revision").jsonPrimitive.int)
    }
}
