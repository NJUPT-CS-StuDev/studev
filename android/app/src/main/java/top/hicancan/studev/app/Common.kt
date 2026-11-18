package top.hicancan.studev.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
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
import androidx.compose.ui.platform.testTag

object Ink {
    val line @Composable get() = MaterialTheme.colorScheme.outlineVariant
    val text @Composable get() = MaterialTheme.colorScheme.onSurface
    val muted @Composable get() = MaterialTheme.colorScheme.onSurfaceVariant
    val faint @Composable get() = MaterialTheme.colorScheme.outline
    val sunken @Composable get() = MaterialTheme.colorScheme.surfaceDim
    val brand @Composable get() = MaterialTheme.colorScheme.primary
    val paper @Composable get() = MaterialTheme.colorScheme.background
}
@Composable fun Plain(text: String, size: TextUnit = 15.sp, color: Color = Ink.text, weight: FontWeight = FontWeight.Normal, modifier: Modifier = Modifier, maxLines: Int = Int.MAX_VALUE, lineHeight: TextUnit = size * 1.4f) =
    Text(text, modifier, color = color, style = TextStyle(fontSize = size, fontWeight = weight, lineHeight = lineHeight), maxLines = maxLines, overflow = TextOverflow.Ellipsis)
fun Modifier.topHairline(color: Color) = drawBehind { drawLine(color, Offset(0f, 0f), Offset(size.width, 0f), 1f) }
fun Modifier.bottomHairline(color: Color) = drawBehind { drawLine(color, Offset(0f, size.height), Offset(size.width, size.height), 1f) }

val LocalMeAction = staticCompositionLocalOf<(() -> Unit)?> { null }

/** Content and account share one measured row; the name gives way before the page controls. */
@Composable fun CampusHeader(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    val openMe = LocalMeAction.current
    BoxWithConstraints(modifier.fillMaxWidth().height(Tokens.Size.header.dp)) {
        val labelWidth = (maxWidth.value - Tokens.Size.headerContent - Tokens.Size.headerGap - Tokens.Size.accountBase).coerceAtMost(Tokens.Size.accountNameMax.toFloat())
        Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Size.headerGap.dp)) {
            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp), content = content)
            if (openMe != null) Surface(openMe, Modifier.height(Tokens.Size.search.dp).widthIn(min = Tokens.Size.target.dp).testTag("me"), shape = RoundedCornerShape(Tokens.Radius.pill.dp), color = Ink.sunken) {
                MeAvatar(labelWidth.takeIf { it >= Tokens.Size.accountNameMin }?.dp)
            }
        }
    }
}

/** A plain row under a hairline, the one list item used everywhere. A trailing lambda is what a tap does; a control
 * at its end is passed by name (trailing = …). */
@Composable fun KeyRow(key: String?, value: String, note: String? = null, color: Color = Ink.text, chevron: Boolean = false, leading: @Composable (() -> Unit)? = null, trailing: @Composable (() -> Unit)? = null, onClick: (() -> Unit)? = null) {
    val base = Modifier.fillMaxWidth().topHairline(Ink.line)
    Row((if (onClick != null) base.clickable(onClick = onClick) else base).padding(vertical = 11.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        if (key != null) Plain(key, 12.5.sp, Ink.faint, maxLines = 1, modifier = Modifier.width(56.dp))
        leading?.invoke()
        Column(Modifier.weight(1f)) { Plain(value, 14.sp, color); if (note != null) Plain(note, 12.sp, Ink.muted) }
        trailing?.invoke()
        if (chevron) Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, Modifier.size(16.dp), tint = Ink.faint)
    }
}
@Composable fun TextTabs(items: List<Pair<String, String>>, selected: String, gap: Dp = 22.dp, separateBefore: String? = null, onSelect: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().bottomHairline(Ink.line), horizontalArrangement = Arrangement.spacedBy(gap)) {
        for ((key, label) in items) {
            if (key == separateBefore) Box(Modifier.width(1.dp).height(16.dp).background(Ink.line).align(Alignment.CenterVertically))
            val on = key == selected
            val ink = Ink.brand
            Box(Modifier.height(36.dp).clickable { onSelect(key) }.drawBehind { if (on) drawRect(ink, Offset(0f, size.height - 2.dp.toPx()), androidx.compose.ui.geometry.Size(size.width, 2.dp.toPx())) }, contentAlignment = Alignment.Center) {
                Plain(label, 14.sp, if (on) Ink.brand else Ink.muted, if (on) FontWeight.SemiBold else FontWeight.Normal)
            }
        }
    }
}
/** One of a few, all in view. */
@Composable fun Choice(items: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit) {
    val padH = if (items.size >= 5) 10.dp else 14.dp
    Row(Modifier.clip(RoundedCornerShape(Tokens.Radius.control.dp)).background(Ink.sunken).padding(2.dp)) {
        items.forEach { (key, label) ->
            val on = key == selected
            Box(Modifier.clip(RoundedCornerShape((Tokens.Radius.control - 2).dp)).background(if (on) Ink.paper else Color.Transparent).clickable { onSelect(key) }.heightIn(min = Tokens.Size.search.dp).padding(horizontal = padH, vertical = 6.dp), contentAlignment = Alignment.Center) {
                Plain(label, 13.sp, if (on) Ink.text else Ink.muted, if (on) FontWeight.Medium else FontWeight.Normal, maxLines = 1)
            }
        }
    }
}

@Composable fun Toggle(on: Boolean, onChange: (Boolean) -> Unit) = androidx.compose.material3.Switch(on, onChange, colors = androidx.compose.material3.SwitchDefaults.colors(checkedTrackColor = Ink.brand))

@Composable fun Chip(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) =
    Surface(onClick, modifier.heightIn(min = 32.dp), shape = RoundedCornerShape(Tokens.Radius.pill.dp), color = Ink.paper, border = BorderStroke(1.dp, Ink.line)) {
        Box(Modifier.padding(horizontal = 10.dp, vertical = 6.dp), contentAlignment = Alignment.Center) { Plain(text, 13.sp) }
    }
@Composable fun ActionButton(text: String, go: Boolean = false, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) =
    Surface(onClick, modifier.heightIn(min = Tokens.Size.control.dp), enabled = enabled, shape = RoundedCornerShape((if (go) Tokens.Radius.pill else Tokens.Radius.control).dp), color = if (go) Ink.brand else Ink.paper, border = if (go) null else BorderStroke(1.dp, Ink.line)) {
        Box(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), contentAlignment = Alignment.Center) { Plain(text, 14.sp, if (go) MaterialTheme.colorScheme.onPrimary else Ink.text, FontWeight.Medium, maxLines = 1) }
    }

/** Secondary actions stay with the text they act on; their touch target is larger than their visible ink. */
@Composable fun TextAction(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, refresh: Boolean = false, muted: Boolean = false) =
    TextButton(onClick, modifier.heightIn(min = Tokens.Size.control.dp), enabled = enabled, shape = RoundedCornerShape(Tokens.Radius.pill.dp), contentPadding = PaddingValues(horizontal = 0.dp, vertical = 8.dp)) {
        if (refresh) { Icon(Icons.Outlined.Refresh, null, Modifier.size(16.dp), tint = if (enabled) Ink.brand else Ink.faint); Spacer(Modifier.width(5.dp)) }
        Plain(text, 14.sp, if (!enabled) Ink.faint else if (muted) Ink.muted else Ink.brand, FontWeight.Medium, maxLines = 1)
    }
@Composable fun SmallTag(text: String, bg: Color, fg: Color) =
    Box(Modifier.padding(end = 6.dp).clip(RoundedCornerShape(4.dp)).background(bg).padding(horizontal = 6.dp, vertical = 1.dp)) { Plain(text, 11.sp, fg, FontWeight.SemiBold) }
@OptIn(ExperimentalMaterial3Api::class)
/**
 * A sheet over the page. `top` sits above the title; `head` colours the title band (background, ink), as a tile's colour
 * dresses the sheet it opens.
 */
@Composable fun PlainSheet(title: String, onClose: () -> Unit, top: (@Composable () -> Unit)? = null, head: Pair<Color, Color>? = null, content: @Composable ColumnScope.() -> Unit) {
    ModalBottomSheet(onDismissRequest = onClose, containerColor = Ink.paper, shape = RoundedCornerShape(topStart = Tokens.Radius.sheet.dp, topEnd = Tokens.Radius.sheet.dp), dragHandle = null, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().padding(top = if (top != null) 12.dp else if (head != null) 0.dp else 18.dp, bottom = 24.dp).navigationBarsPadding()) {
            if (top != null) Box(Modifier.padding(horizontal = 20.dp).padding(bottom = 10.dp)) { top() }
            // A sheet whose content names itself (a task, its title editable) has no title row.
            if (title.isNotEmpty()) Box(Modifier.fillMaxWidth().then(if (head != null) Modifier.background(head.first).padding(vertical = 14.dp) else Modifier).padding(horizontal = 20.dp)) {
                Plain(title, 20.sp, head?.second ?: Ink.text, weight = FontWeight.SemiBold, modifier = Modifier.padding(bottom = 4.dp))
            }
            Column(Modifier.padding(horizontal = 20.dp).padding(top = if (head != null && title.isNotEmpty()) 12.dp else 0.dp)) { content() }
        }
    }
}
