package top.hicancan.studev.map

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.lerp
import kotlin.math.cos
import kotlin.math.sin

private const val RAD = Math.PI / 180

/**
 * The ball that turns the map, the same as the web's (src/campus/map/ball.ts): a solid sphere seen under the
 * map's own bearing and pitch. Its equator turns and flattens with the map and a red mark on its rim points
 * north. No meridians: those would make it a globe, the sign for "world" or "language". Drawn on a 44-unit
 * square with the ball 15 units across its radius, leaving room for the turning arrows shown while it turns.
 */
@Composable fun MapBall(bearing: Double, pitch: Double, turning: Boolean, paper: Color, ink: Color, line: Color, arrow: Color, north: Color, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val unit = size.minDimension / 44
        val radius = 15 * unit
        val centre = Offset(size.width / 2, size.height / 2)
        fun at(x: Double, y: Double) = Offset(centre.x + (x * radius).toFloat(), centre.y - (y * radius).toFloat())
        if (turning) {
            // The web's arrows in its own units, y down: the right one is the left turned half round.
            val stroke = Stroke(1.3f * unit, cap = StrokeCap.Round, join = StrokeJoin.Round)
            listOf(1f, -1f).forEach { s ->
                fun p(x: Float, y: Float) = Offset(centre.x + s * x * unit, centre.y + s * y * unit)
                val arc = Path().apply { p(-19.5f, -6f).let { moveTo(it.x, it.y) }; val c = p(-21.34f, 0f); val e = p(-19.5f, 6f); quadraticTo(c.x, c.y, e.x, e.y) }
                val head = Path().apply { p(-21.6f, 3.4f).let { moveTo(it.x, it.y) }; p(-19.5f, 6f).let { lineTo(it.x, it.y) }; p(-17f, 4.2f).let { lineTo(it.x, it.y) } }
                drawPath(arc, arrow, style = stroke)
                drawPath(head, arrow, style = stroke)
            }
        }
        val dark = lerp(paper, ink, .22f)
        drawCircle(Brush.radialGradient(listOf(paper, dark), Offset(centre.x - .3f * radius, centre.y - .4f * radius), 1.5f * radius), radius, centre)
        drawCircle(lerp(paper, ink, .3f), radius, centre, style = Stroke(.6f * unit))
        val gloss = Offset(centre.x - 5 * unit, centre.y - 6.5f * unit)
        rotate(-30f, gloss) {
            drawOval(Brush.radialGradient(listOf(Color.White.copy(alpha = .85f), Color.White.copy(alpha = 0f)), gloss, 7 * unit), Offset(gloss.x - 7 * unit, gloss.y - 5 * unit), Size(14 * unit, 10 * unit))
        }
        val (sb, cb) = sin(bearing * RAD) to cos(bearing * RAD)
        val (sp, cp) = sin(pitch * RAD) to cos(pitch * RAD)
        // The near half of the equator, from the map frame (x east, y north, z up) to the viewer.
        val ring = Path()
        var pen = false
        for (lon in 0..360 step 4) {
            val (x, y) = sin(lon * RAD) to cos(lon * RAD)
            val ry = x * sb + y * cb
            if (-ry * sp < 0) { pen = false; continue }
            val point = at(x * cb - y * sb, ry * cp)
            if (pen) ring.lineTo(point.x, point.y) else ring.moveTo(point.x, point.y)
            pen = true
        }
        drawPath(ring, line, style = Stroke(.8f * unit))
        // North on the screen, at the rim, so no tilt ever hides it behind the ball.
        val (dx, dy) = -sb to cb
        fun tip(r: Double, side: Double) = at((dx * r - dy * side) / 15, (dy * r + dx * side) / 15)
        drawPath(Path().apply { tip(20.0, .0).let { moveTo(it.x, it.y) }; tip(13.5, 3.4).let { lineTo(it.x, it.y) }; tip(13.5, -3.4).let { lineTo(it.x, it.y) }; close() }, north)
    }
}
