package top.hicancan.studev.map

import android.content.Context
import org.json.JSONObject

internal object CampusStyle {
    fun load(context: Context, dark: Boolean): String {
        val style = JSONObject(context.assets.open("campus-style.json").bufferedReader().use { it.readText() })
        if (dark) {
            val paints = mapOf(
                "campus-background" to mapOf("background-color" to "#182522"),
                "building-fill" to mapOf("fill-color" to "#40574D"),
                "building-outline" to mapOf("line-color" to "#718D7B"),
                "way-casing" to mapOf("line-color" to "#283C32"),
                "ways" to mapOf("line-color" to "#A1AD8E"),
                "building-labels" to mapOf("text-color" to "#E3EBDD", "text-halo-color" to "#182522"),
                "way-labels" to mapOf("text-color" to "#B9CDBF", "text-halo-color" to "#182522"),
            )
            val layers = style.getJSONArray("layers")
            for (index in 0 until layers.length()) {
                val layer = layers.getJSONObject(index)
                paints[layer.getString("id")]?.forEach { (key, value) -> layer.getJSONObject("paint").put(key, value) }
            }
        }
        return style.toString()
    }
}
