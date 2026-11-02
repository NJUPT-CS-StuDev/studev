package top.hicancan.studev.search

import android.content.res.AssetManager
import kotlinx.serialization.json.*
import top.hicancan.studev.data.CampusPackage
import top.hicancan.studev.data.Place

class CampusSearch(assets: AssetManager) : AutoCloseable {
    private val runtime = NativeSearch { path -> assets.open("${CampusPackage.BASE}/search/$path").use { it.readBytes() } }
    suspend fun search(query: String, campus: CampusPackage): List<Place> =
        runtime.search(query, 60).mapNotNull { campus.byId[it.getValue("id").jsonPrimitive.content] }
    override fun close() = runtime.close()
}
