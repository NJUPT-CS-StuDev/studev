package top.hicancan.studev.world

import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Typeface
import android.util.LruCache
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.core.graphics.PathParser
import kotlinx.serialization.json.*
import top.hicancan.studev.app.Ink

/**
 * What docstream draws, drawn: a formula the kernel typeset (glyph outlines, rules, words; in ems, y up from the
 * baseline) and a Mermaid diagram it laid out (paths and words; in dp of 14dp text, y down). The same kernel gives the
 * web the same drawings as SVG, so a formula or diagram looks alike everywhere.
 */
object Drawings {
    class Formula(val width: Float, val height: Float, val depth: Float, val items: List<JsonObject>, val glyphs: Map<Int, Path>)
    class Diagram(val x: Float, val y: Float, val width: Float, val height: Float, val items: List<JsonObject>)

    private val formulas = LruCache<String, Formula>(300)
    // A one-element array, so that "not a kind laid out" is remembered too.
    private val diagrams = LruCache<String, Array<Diagram?>>(60)
    private val outlines = HashMap<Int, Path>()

    fun formula(tex: String, display: Boolean): Formula {
        val key = (if (display) "D" else "T") + tex
        formulas.get(key)?.let { return it }
        val json = Json.parseToJsonElement(top.hicancan.docstream.math(tex, display)).jsonObject
        val glyphs = json.getValue("glyphs").jsonObject.entries.associate { (id, d) ->
            val n = id.toInt()
            n to synchronized(outlines) { outlines.getOrPut(n) { PathParser.createPathFromPathData(d.jsonPrimitive.content) } }
        }
        return Formula(json.f("width"), json.f("height"), json.f("depth"), json.getValue("items").jsonArray.map { it.jsonObject }, glyphs).also { formulas.put(key, it) }
    }

    /** A diagram, or null for a kind the kernel does not lay out (shown as its source). */
    fun diagram(source: String): Diagram? {
        diagrams.get(source)?.let { return it[0] }
        val laid = top.hicancan.docstream.diagram(source)?.let { text ->
            val json = Json.parseToJsonElement(text).jsonObject
            Diagram(json.f("x"), json.f("y"), json.f("width"), json.f("height"), json.getValue("items").jsonArray.map { it.jsonObject })
        }
        diagrams.put(source, arrayOf(laid))
        return laid
    }

    internal fun JsonObject.f(key: String) = getValue(key).jsonPrimitive.float
    internal fun JsonObject.s(key: String) = getValue(key).jsonPrimitive.content
}

/** Where the middle of a line of text sits above its baseline, in ems: what an inline formula is centred on. */
const val TEXT_MIDDLE = 0.32f

/** The height an inline formula takes in a line, centred on the text's middle, in ems. */
fun Drawings.Formula.lineHeight() = 2f * maxOf(height - TEXT_MIDDLE, depth + TEXT_MIDDLE)

/** A formula drawn at `em` pixels to the em, its baseline `baseline` pixels from the top. */
fun DrawScope.drawFormula(f: Drawings.Formula, em: Float, baseline: Float, color: Color) {
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color.toArgb(); style = Paint.Style.FILL }
    val canvas = drawContext.canvas.nativeCanvas
    for (item in f.items) with(Drawings) {
        when (item.s("type")) {
            "glyph" -> {
                val path = f.glyphs[item.getValue("id").jsonPrimitive.int] ?: continue
                canvas.save()
                canvas.translate(item.f("x") * em, baseline - item.f("y") * em)
                val scale = item.f("scale") * em
                canvas.scale(scale, scale)
                canvas.drawPath(path, paint)
                canvas.restore()
            }
            "rule" -> {
                val top = baseline - item.f("y") * em
                canvas.drawRect(item.f("x") * em, top, (item.f("x") + item.f("width")) * em, top + item.f("height") * em, paint)
            }
            "text" -> {
                paint.textSize = item.f("size") * em
                canvas.drawText(item.s("text"), item.f("x") * em, baseline - item.f("y") * em, paint)
            }
        }
    }
}

/** A formula on a line of its own, centred, scrolling sideways when wider than the page. */
@Composable fun MathBlock(tex: String, size: TextUnit, color: Color = Ink.text) {
    val f = Drawings.formula(tex, true)
    val em = with(LocalDensity.current) { size.toPx() } * 1.08f
    val width = with(LocalDensity.current) { (f.width * em).toDp() }
    val height = with(LocalDensity.current) { ((f.height + f.depth) * em).toDp() }
    BoxWithConstraints(Modifier.fillMaxWidth().padding(vertical = 4.dp), contentAlignment = Alignment.Center) {
        val wide = width > maxWidth
        Box(Modifier.then(if (wide) Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()) else Modifier)) {
            Canvas(Modifier.size(width.coerceAtLeast(1.dp), height.coerceAtLeast(1.dp)).semantics { contentDescription = tex }) { drawFormula(f, em, f.height * em, color) }
        }
    }
}

/** A diagram, drawn to fit the page's width (never larger than laid out). */
@Composable fun DiagramView(d: Drawings.Diagram, source: String, color: Color = Ink.text) {
    val density = LocalDensity.current.density
    BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        val fit = minOf(1f, maxWidth.value / d.width)
        Canvas(Modifier.size((d.width * fit).dp, (d.height * fit).dp).semantics { contentDescription = source }) {
            val unit = density * fit
            val canvas = drawContext.canvas.nativeCanvas
            val ink = color.toArgb()
            val soft = color.copy(alpha = .06f).toArgb()
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
            val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = ink; textAlign = Paint.Align.CENTER }
            canvas.save()
            canvas.scale(unit, unit)
            canvas.translate(-d.x, -d.y)
            for (item in d.items) with(Drawings) {
                when (item.s("type")) {
                    "path" -> {
                        val path = PathParser.createPathFromPathData(item.s("d"))
                        when (item.s("fill")) {
                            "soft" -> { paint.style = Paint.Style.FILL; paint.color = soft; paint.pathEffect = null; canvas.drawPath(path, paint) }
                            "solid" -> { paint.style = Paint.Style.FILL; paint.color = ink; paint.pathEffect = null; canvas.drawPath(path, paint) }
                        }
                        val stroke = item.f("stroke")
                        if (stroke > 0f) {
                            paint.style = Paint.Style.STROKE; paint.color = ink; paint.strokeWidth = stroke
                            paint.pathEffect = if (item.getValue("dash").jsonPrimitive.boolean) DashPathEffect(floatArrayOf(5f, 4f), 0f) else null
                            canvas.drawPath(path, paint)
                        }
                    }
                    "text" -> {
                        text.textSize = item.f("size")
                        text.typeface = if (item.getValue("bold").jsonPrimitive.boolean) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
                        val middle = (text.descent() + text.ascent()) / 2f
                        canvas.drawText(item.s("text"), item.f("x"), item.f("y") - middle, text)
                    }
                }
            }
            canvas.restore()
        }
    }
}
