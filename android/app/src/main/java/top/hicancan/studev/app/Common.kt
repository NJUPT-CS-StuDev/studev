package top.hicancan.studev.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object Ink {
    val line @Composable get() = MaterialTheme.colorScheme.outlineVariant
    val text @Composable get() = MaterialTheme.colorScheme.onSurface
    val muted @Composable get() = MaterialTheme.colorScheme.onSurfaceVariant
    val faint @Composable get() = MaterialTheme.colorScheme.outline
    val sunken @Composable get() = MaterialTheme.colorScheme.surfaceDim
    val brand @Composable get() = MaterialTheme.colorScheme.primary
    val paper @Composable get() = MaterialTheme.colorScheme.background
}
@Composable fun Plain(text: String, size: TextUnit = 15.sp, color: Color = Ink.text, weight: FontWeight = FontWeight.Normal, modifier: Modifier = Modifier, maxLines: Int = Int.MAX_VALUE) =
    Text(text, modifier, color = color, style = TextStyle(fontSize = size, fontWeight = weight, lineHeight = size * 1.4f), maxLines = maxLines, overflow = TextOverflow.Ellipsis)
fun Modifier.topHairline(color: Color) = drawBehind { drawLine(color, Offset(0f, 0f), Offset(size.width, 0f), 1f) }
fun Modifier.bottomHairline(color: Color) = drawBehind { drawLine(color, Offset(0f, size.height), Offset(size.width, size.height), 1f) }

/** A plain row under a hairline, the one list item used everywhere. */
@Composable fun KeyRow(key: String?, value: String, note: String? = null, color: Color = Ink.text, chevron: Boolean = false, onClick: (() -> Unit)? = null, trailing: @Composable (() -> Unit)? = null) {
    val base = Modifier.fillMaxWidth().topHairline(Ink.line)
    Row((if (onClick != null) base.clickable(onClick = onClick) else base).padding(vertical = 11.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        if (key != null) Plain(key, 12.5.sp, Ink.faint, modifier = Modifier.width(40.dp))
        Column(Modifier.weight(1f)) { Plain(value, 14.sp, color); if (note != null) Plain(note, 12.sp, Ink.muted) }
        trailing?.invoke()
        if (chevron) Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, Modifier.size(16.dp), tint = Ink.faint)
    }
}
@Composable fun TextTabs(items: List<Pair<String, String>>, selected: String, gap: Dp = 22.dp, onSelect: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().bottomHairline(Ink.line), horizontalArrangement = Arrangement.spacedBy(gap)) {
        for ((key, label) in items) {
            val on = key == selected
            val ink = Ink.text
            Box(Modifier.height(36.dp).clickable { onSelect(key) }.drawBehind { if (on) drawRect(ink, Offset(0f, size.height - 2.dp.toPx()), androidx.compose.ui.geometry.Size(size.width, 2.dp.toPx())) }, contentAlignment = Alignment.Center) {
                Plain(label, 14.sp, if (on) Ink.text else Ink.muted, if (on) FontWeight.SemiBold else FontWeight.Normal)
            }
        }
    }
}
/** One of a few, all in view. */
@Composable fun Choice(items: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit) {
    Row(Modifier.clip(RoundedCornerShape(8.dp)).background(Ink.sunken).padding(2.dp)) {
        items.forEach { (key, label) ->
            val on = key == selected
            Box(Modifier.clip(RoundedCornerShape(6.dp)).background(if (on) Ink.paper else Color.Transparent).clickable { onSelect(key) }.padding(horizontal = 14.dp, vertical = 6.dp)) {
                Plain(label, 13.sp, if (on) Ink.text else Ink.muted, if (on) FontWeight.Medium else FontWeight.Normal)
            }
        }
    }
}

@Composable fun Toggle(on: Boolean, onChange: (Boolean) -> Unit) = androidx.compose.material3.Switch(on, onChange, colors = androidx.compose.material3.SwitchDefaults.colors(checkedTrackColor = Ink.brand))

@Composable fun Chip(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) =
    Surface(onClick, modifier.heightIn(min = 32.dp), shape = RoundedCornerShape(8.dp), color = Ink.paper, border = BorderStroke(1.dp, Ink.line)) {
        Box(Modifier.padding(horizontal = 10.dp, vertical = 6.dp), contentAlignment = Alignment.Center) { Plain(text, 13.sp) }
    }
@Composable fun ActionButton(text: String, go: Boolean = false, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) =
    Surface(onClick, modifier.heightIn(min = 40.dp), enabled = enabled, shape = RoundedCornerShape(8.dp), color = if (go) Ink.brand else Ink.paper, border = if (go) null else BorderStroke(1.dp, Ink.line)) {
        Box(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), contentAlignment = Alignment.Center) { Plain(text, 14.sp, if (go) MaterialTheme.colorScheme.onPrimary else Ink.text, FontWeight.Medium, maxLines = 1) }
    }
@Composable fun SmallTag(text: String, bg: Color, fg: Color) =
    Box(Modifier.padding(end = 6.dp).clip(RoundedCornerShape(4.dp)).background(bg).padding(horizontal = 6.dp, vertical = 1.dp)) { Plain(text, 11.sp, fg, FontWeight.SemiBold) }
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun PlainSheet(title: String, onClose: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    ModalBottomSheet(onDismissRequest = onClose, containerColor = Ink.paper, shape = RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp), dragHandle = null, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 18.dp, bottom = 24.dp).navigationBarsPadding()) {
            Plain(title, 20.sp, weight = FontWeight.SemiBold, modifier = Modifier.padding(bottom = 4.dp))
            content()
        }
    }
}
