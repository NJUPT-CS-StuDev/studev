package top.hicancan.studev.home

import org.junit.Assert.*
import org.junit.Test
import top.hicancan.studev.data.OpeningHours
import top.hicancan.studev.data.Place
import top.hicancan.studev.navigation.Endpoint
import java.time.LocalDateTime

class HomeRecommendationsTest {
    private fun time(hour: Int, minute: Int = 0) = LocalDateTime.of(2026, 10, 30, hour, minute)
    private fun hours(start: String, end: String) = OpeningHours((1..7).associate { it.toString() to listOf(listOf(start, end)) })
    private fun place(id: String, category: String, hours: OpeningHours? = null, featured: Boolean = true) = Place(
        id, "building", "campus", listOf(id), centre = listOf(118.926, 32.114), sources = listOf("fixture"), use = "测试用途", routing = Endpoint.Target(id), category = category, hours = hours, featured = featured)

    @Test fun openingBoundariesAndClosingThreshold() {
        val schedule = hours("08:00", "22:00")
        assertEquals(OpenState.Closed, openingStatus(schedule, time(7, 59)).state)
        assertEquals(OpenState.Open, openingStatus(schedule, time(8)).state)
        assertEquals(OpenState.Open, openingStatus(schedule, time(21, 29)).state)
        assertEquals(OpenState.Closing, openingStatus(schedule, time(21, 30)).state)
        assertEquals(OpenState.Closed, openingStatus(schedule, time(22)).state)
        assertEquals(OpenState.Unknown, openingStatus(null, time(12)).state)
    }
    @Test fun overnightSundayAndBreaks() {
        val sunday = OpeningHours(mapOf("7" to listOf(listOf("22:00", "02:00"))))
        val monday = LocalDateTime.of(2026, 11, 2, 1, 50)
        assertEquals(OpenState.Closing, openingStatus(sunday, monday).state)
        assertEquals(OpenState.Closed, openingStatus(sunday, monday.withHour(2).withMinute(0)).state)
        val split = OpeningHours(mapOf("5" to listOf(listOf("08:00", "12:00"), listOf("13:30", "17:00"))))
        assertEquals(OpenState.Closed, openingStatus(split, time(12, 30)).state)
        assertEquals(OpenState.Open, openingStatus(hours("00:00", "24:00"), time(23, 59)).state)
    }
    @Test fun timeOfDayChangesCandidatesAndNeverRecommendsClosedFood() {
        val items = listOf(place("class", "教学楼"), place("library", "图书馆", hours("08:00", "22:00")),
            place("canteen", "食堂", hours("07:00", "21:00")), place("closed", "食堂", hours("17:00", "21:00")),
            place("dorm", "宿舍"), place("store", "超市", hours("00:00", "24:00")), place("unfeatured", "教学楼", featured = false))
        assertEquals("class", HomeRecommendations.rank(items, time(7), null).first().place.id)
        assertEquals("canteen", HomeRecommendations.rank(items, time(12), null).first().place.id)
        assertFalse(HomeRecommendations.rank(items, time(12), null).any { it.place.id == "closed" })
        assertEquals("library", HomeRecommendations.rank(items, time(20), null).first().place.id)
        assertEquals(setOf("dorm", "store"), HomeRecommendations.rank(items, time(23), null).map { it.place.id }.toSet())
        assertEquals(2, HomeRecommendations.rank(items, time(12), null, "食堂").size)
    }
    @Test fun distancesUsePositionOrExplicitCampusCentre() {
        val p = place("near", "教学楼")
        assertEquals(0.0, HomeRecommendations.rank(listOf(p), time(8), p.centre).single().distance, .001)
        assertTrue(HomeRecommendations.rank(listOf(p), time(8), null).single().distance > 0)
        assertEquals(0.0, HomeRecommendations.distance(listOf(0.0, 0.0), listOf(0.0, 0.0)), .001)
    }
}
