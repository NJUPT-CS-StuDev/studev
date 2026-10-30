package top.hicancan.studev.rooms

import top.hicancan.studev.data.Room
import top.hicancan.studev.timetable.CampusDay

/** A null selection includes all buildings; an empty selection includes none. */
object RoomSelection {
    fun toggle(ids: Set<String>?, all: Set<String>, id: String): Set<String> {
        val selected = ids ?: all
        return if (id in selected) selected - id else selected + id
    }
    fun filter(rooms: List<Room>, campus: String, buildings: Set<String>?, everything: Boolean = false, query: String = "", minSeats: Int = 0): List<Room> =
        rooms.filter { it.campus == campus && (buildings == null || it.building in buildings) && CampusDay.eligible(it, everything) && CampusDay.roomMatches(it, query) && (it.seats ?: 0) >= minSeats }
}
