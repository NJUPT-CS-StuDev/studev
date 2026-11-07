package top.hicancan.studev.map

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import kotlin.math.cos
import kotlin.math.sin

private const val RAD = Math.PI / 180

/** The globe that turns the map, drawn from the camera itself: a real sphere under the same bearing and pitch. */
@Composable fun MapBall(bearing: Double, pitch: Double, body: Color, line: Color, north: Color, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val radius = size.minDimension / 2 * 15 / 18
        val centre = Offset(size.width / 2, size.height / 2)
        val (sb, cb) = sin(bearing * RAD) to cos(bearing * RAD)
        val (sp, cp) = sin(pitch * RAD) to cos(pitch * RAD)
        // Map frame (x east, y north, z up) to the viewer: x right, y up, z toward the eye.
        fun project(lon: Double, lat: Double): Triple<Double, Double, Double> {
            val x = cos(lat * RAD) * sin(lon * RAD); val y = cos(lat * RAD) * cos(lon * RAD); val z = sin(lat * RAD)
            val rx = x * cb - y * sb; val ry = x * sb + y * cb
            return Triple(rx, ry * cp + z * sp, -ry * sp + z * cp)
        }
        fun ring(at: (Double) -> Pair<Double, Double>) {
            val path = Path()
            var pen = false
            for (step in 0..72) {
                val (lon, lat) = at(step * 5.0)
                val (x, y, z) = project(lon, lat)
                if (z < 0) { pen = false; continue }
                val px = centre.x + (x * radius).toFloat(); val py = centre.y - (y * radius).toFloat()
                if (pen) path.lineTo(px, py) else path.moveTo(px, py)
                pen = true
            }
            drawPath(path, line, style = Stroke(.7f * size.minDimension / 36))
        }
        drawCircle(Color.Black.copy(alpha = .10f), radius + 1.5f, centre)
        drawCircle(body, radius, centre)
        listOf(0.0, 45.0, 90.0, 135.0).forEach { lon -> ring { lon to it } }
        listOf(-45.0, 0.0, 45.0).forEach { lat -> ring { it to lat } }
        // Where north points on the screen, on the rim, so tilting never hides it.
        drawCircle(north, radius * 2.6f / 15, Offset(centre.x - (sb * radius * 12.5 / 15).toFloat(), centre.y - (cb * radius * 12.5 / 15).toFloat()))
    }
}
