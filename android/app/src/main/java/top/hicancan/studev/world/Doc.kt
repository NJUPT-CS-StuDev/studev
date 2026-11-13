package top.hicancan.studev.world

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.BaselineShift
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlinx.serialization.json.*
import top.hicancan.studev.app.Ink
import top.hicancan.studev.app.Plain
import top.hicancan.studev.app.marks

/**
 * A document as docstream reads it, drawn as Compose: the same reading of Markdown as the web's (src/campus/world/doc.tsx);
 * the kernel is Rust (NJUPT-CS-StuDev/docstream). Each top-level block is keyed, so streaming text redraws only the
 * block being written. A link inside the site is opened by `onLink`; one outside it in the browser.
 */
object Docs {
    /** A whole text, read at once into keyed blocks. */
    fun read(text: String): List<JsonObject> = top.hicancan.docstream.Stream().use { stream -> stream.push(text); blocksOf(stream.finish()) }
    /** The blocks of an update the kernel gives as JSON. */
    fun blocksOf(update: String): List<JsonObject> = Json.parseToJsonElement(update).jsonObject.getValue("blocks").jsonArray.map { it.jsonObject }
}

private val ALERTS = mapOf("note" to "说明", "tip" to "提示", "important" to "重要", "warning" to "注意", "caution" to "小心")
private val JsonObject.type get() = getValue("type").jsonPrimitive.content
private fun JsonObject.list(key: String) = get(key)?.jsonArray.orEmpty().map { it.jsonObject }
private fun JsonObject.str(key: String) = get(key)?.jsonPrimitive?.contentOrNull.orEmpty()

private sealed interface Run { class Text(val inlines: List<JsonObject>) : Run; class Display(val tex: String) : Run }

/** A paragraph's inlines cut at each display formula; the line breaks beside a formula go with it. */
private fun displayRuns(inlines: List<JsonObject>): List<Run> {
    val runs = mutableListOf<Run>()
    var text = mutableListOf<JsonObject>()
    fun flush() {
        val trimmed = text.toMutableList()
        trimmed.firstOrNull()?.takeIf { it.type == "text" }?.let { trimmed[0] = JsonObject(it + ("text" to JsonPrimitive(it.str("text").trimStart('\n')))) }
        trimmed.lastOrNull()?.takeIf { it.type == "text" }?.let { trimmed[trimmed.lastIndex] = JsonObject(it + ("text" to JsonPrimitive(it.str("text").trimEnd('\n')))) }
        if (trimmed.any { it.type != "text" || it.str("text").isNotBlank() }) runs += Run.Text(trimmed)
        text = mutableListOf()
    }
    for (inline in inlines) {
        if (inline.type == "math" && inline["display"]?.jsonPrimitive?.booleanOrNull == true) { flush(); runs += Run.Display(inline.str("tex")) } else text += inline
    }
    flush()
    return runs
}

@Composable fun Doc(blocks: List<JsonObject>, live: Boolean = false, onLink: (String) -> Unit = {}) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        blocks.forEachIndexed { at, keyed ->
            key(at, keyed.str("key")) { BlockView(keyed.getValue("block").jsonObject, onLink, live && at == blocks.lastIndex) }
        }
    }
}

@Composable private fun InlineText(inlines: List<JsonObject>, size: Float = 15.5f, weight: FontWeight = FontWeight.Normal, color: Color = Ink.text, caret: Boolean = false, onLink: (String) -> Unit, align: TextAlign? = null) {
    val code = Ink.sunken; val brand = Ink.brand
    val uri = LocalUriHandler.current
    val (text, drawings) = remember(inlines, caret, code, brand, size, color, onLink, uri) {
        val drawings = mutableMapOf<String, InlineTextContent>()
        val text = buildAnnotatedString {
            fun walk(items: List<JsonObject>) {
                for (inline in items) when (inline.type) {
                    "text" -> append(inline.str("text"))
                    "strong" -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { walk(inline.list("children")) }
                    "emphasis" -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { walk(inline.list("children")) }
                    "strike" -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { walk(inline.list("children")) }
                    "highlight" -> withStyle(SpanStyle(background = Color(0x61F5C542))) { walk(inline.list("children")) }
                    "superscript" -> withStyle(SpanStyle(baselineShift = BaselineShift.Superscript, fontSize = (size * .72f).sp)) { walk(inline.list("children")) }
                    "subscript" -> withStyle(SpanStyle(baselineShift = BaselineShift.Subscript, fontSize = (size * .72f).sp)) { walk(inline.list("children")) }
                    "code" -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = code, fontSize = (size * .88f).sp)) { append(" ${inline.str("text")} ") }
                    "math" -> {
                        val tex = inline.str("tex")
                        val formula = Drawings.formula(tex, inline["display"]?.jsonPrimitive?.boolean == true)
                        val id = "math-${drawings.size}"
                        drawings[id] = InlineTextContent(Placeholder(
                            width = formula.width.coerceAtLeast(.001f).em,
                            height = formula.lineHeight().em,
                            placeholderVerticalAlign = PlaceholderVerticalAlign.TextCenter,
                        )) {
                            Canvas(Modifier.fillMaxSize()) {
                                val em = size.sp.toPx()
                                drawFormula(formula, em, formula.lineHeight() * em / 2f + TEXT_MIDDLE * em, color)
                            }
                        }
                        appendInlineContent(id, tex.ifEmpty { "公式" })
                    }
                    "link" -> {
                        val href = inline.str("href")
                        withLink(LinkAnnotation.Clickable(href, TextLinkStyles(SpanStyle(color = brand, textDecoration = TextDecoration.Underline))) { if (href.startsWith("/")) onLink(href) else runCatching { uri.openUri(href) } }) { walk(inline.list("children")) }
                    }
                    "image" -> append("［图片：${inline.str("alt")}］")
                    "break" -> append("\n")
                }
            }
            walk(inlines)
            if (caret) withStyle(SpanStyle(color = brand)) { append(" ▍") }
        }
        text to drawings.toMap()
    }
    Text(text, if (align != null) Modifier.fillMaxWidth() else Modifier, color = color, style = TextStyle(fontSize = size.sp, lineHeight = (size * 1.7f).sp, fontWeight = weight), textAlign = align, inlineContent = drawings)
}

@Composable private fun BlockView(block: JsonObject, onLink: (String) -> Unit, caret: Boolean = false) {
    val shape = RoundedCornerShape(10.dp)
    when (block.type) {
        "paragraph" -> {
            // Display math written amid the text is set on a line of its own, between the text before and after it.
            val runs = displayRuns(block.list("inlines"))
            if (runs.size == 1 && runs[0] !is Run.Display) InlineText(block.list("inlines"), caret = caret, onLink = onLink)
            else Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                runs.forEachIndexed { at, run ->
                    when (run) {
                        is Run.Display -> MathBlock(run.tex, 15.5.sp)
                        is Run.Text -> InlineText(run.inlines, caret = caret && at == runs.lastIndex, onLink = onLink)
                    }
                }
            }
        }
        "heading" -> InlineText(block.list("inlines"), size = when (block.getValue("level").jsonPrimitive.int) { 1 -> 20f; 2 -> 18f; else -> 16.5f }, weight = FontWeight.SemiBold, caret = caret, onLink = onLink)
        "quote" -> Row(Modifier.height(IntrinsicSize.Min)) {
            Box(Modifier.width(3.dp).fillMaxHeight().background(Ink.line))
            Column(Modifier.padding(start = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { block.list("blocks").forEach { BlockView(it, onLink) } }
        }
        "alert" -> {
            val danger = block.str("kind") in setOf("warning", "caution")
            val tone = if (danger) marks().danger else Ink.brand
            Column(Modifier.fillMaxWidth().clip(shape).background(tone.copy(alpha = .07f)).padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Plain(ALERTS[block.str("kind")].orEmpty(), 13.sp, tone, FontWeight.SemiBold)
                block.list("blocks").forEach { BlockView(it, onLink) }
            }
        }
        "list" -> {
            val ordered = block.getValue("ordered").jsonPrimitive.boolean
            val start = block.getValue("start").jsonPrimitive.long
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                block.list("items").forEachIndexed { at, item ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        val checked = item["checked"]?.jsonPrimitive?.booleanOrNull
                        Box(Modifier.width(22.dp).padding(top = 4.dp), contentAlignment = Alignment.TopEnd) {
                            when {
                                checked != null -> Box(Modifier.size(14.dp).clip(RoundedCornerShape(4.dp)).background(if (checked) Ink.brand else Color.Transparent).border(1.5.dp, if (checked) Ink.brand else Ink.faint, RoundedCornerShape(4.dp)))
                                ordered -> Plain("${start + at}.", 15.5.sp, Ink.muted)
                                else -> Plain("•", 15.5.sp, Ink.muted)
                            }
                        }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) { item.list("blocks").forEach { BlockView(it, onLink) } }
                    }
                }
            }
        }
        "code" -> {
            val drawing = if (block.str("language") == "mermaid") Drawings.diagram(block.str("text")) else null
            if (drawing != null) {
                DiagramView(drawing, source = block.str("text"))
            } else {
                val clipboard = LocalClipboardManager.current
                var copied by remember { mutableStateOf(false) }
                Column(Modifier.fillMaxWidth().clip(shape).border(1.dp, Ink.line, shape)) {
                    Row(Modifier.fillMaxWidth().background(Ink.sunken).padding(horizontal = 12.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Plain(block.str("language").ifEmpty { "代码" }, 12.sp, Ink.muted, modifier = Modifier.weight(1f))
                        Plain(if (copied) "已复制" else "复制", 12.sp, Ink.muted, modifier = Modifier.clickable { clipboard.setText(AnnotatedString(block.str("text"))); copied = true })
                    }
                    Text(block.str("text"), Modifier.horizontalScroll(rememberScrollState()).padding(12.dp), color = Ink.text, style = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 13.sp, lineHeight = 20.sp), softWrap = false)
                }
            }
        }
        "math" -> MathBlock(block.str("tex"), 15.5.sp)
        "table" -> {
            val head = block.getValue("head").jsonArray.map { cell -> cell.jsonArray.map { it.jsonObject } }
            val rows = block.getValue("rows").jsonArray.map { row -> row.jsonArray.map { cell -> cell.jsonArray.map { it.jsonObject } } }
            val align = block.getValue("align").jsonArray.map { when (it.jsonPrimitive.content) { "center" -> TextAlign.Center; "right" -> TextAlign.End; else -> TextAlign.Start } }
            fun plain(cell: List<JsonObject>): String = cell.joinToString("") { inline -> when (inline.type) { "text", "code" -> inline.str("text"); "math" -> inline.str("tex"); else -> plain(inline.list("children")) } }
            // Each column as wide as its widest cell, within reason; a wide table scrolls sideways.
            val widths = head.indices.map { column -> ((listOf(head) + rows).maxOf { row -> row.getOrNull(column)?.let(::plain)?.length ?: 0 } * 15 + 28).coerceIn(72, 240).dp }
            Column(Modifier.clip(shape).border(1.dp, Ink.line, shape).horizontalScroll(rememberScrollState())) {
                (listOf(head) + rows).forEachIndexed { r, row ->
                    Row(Modifier.then(if (r == 0) Modifier.background(Ink.sunken) else Modifier)) {
                        head.indices.forEach { column ->
                            Box(Modifier.width(widths[column]).padding(horizontal = 12.dp, vertical = 8.dp)) {
                                InlineText(row.getOrNull(column).orEmpty(), size = 14f, weight = if (r == 0) FontWeight.SemiBold else FontWeight.Normal, onLink = onLink, align = align.getOrNull(column))
                            }
                        }
                    }
                    if (r < rows.size) HorizontalDivider(color = Ink.line)
                }
            }
        }
        "rule" -> HorizontalDivider(color = Ink.line)
        "html" -> Plain(block.str("text"), 13.sp, Ink.muted)
    }
}

/** A whole text, read at once and drawn. */
@Composable fun DocText(text: String, onLink: (String) -> Unit = {}) {
    val blocks = remember(text) { Docs.read(text) }
    Doc(blocks, onLink = onLink)
}
