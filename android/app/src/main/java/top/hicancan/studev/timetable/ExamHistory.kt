package top.hicancan.studev.timetable

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import top.hicancan.studev.app.*
import top.hicancan.studev.data.ExamRecord
import top.hicancan.studev.data.ExamSource
import top.hicancan.studev.world.Exams
import top.hicancan.studev.world.Names

@Composable private fun Sources(files: List<ExamSource>) {
    val links = LocalUriHandler.current
    files.groupBy { it.notice }.forEach { (notice, adopted) ->
        val first = adopted.first()
        val attachments = adopted.filter { it.url.isNotBlank() && it.url != notice }.groupingBy { it.url }.eachCount()
        Column(Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
            Column(Modifier.fillMaxWidth().semantics { contentDescription = "官方公告：${first.title.ifBlank { "考试安排" }}" }.clickable(role = Role.Button) { links.openUri(notice) }.heightIn(min = Tokens.Size.target.dp).padding(vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Plain("${first.title.ifBlank { "官方公告" }} ↗", 13.5.sp, weight = FontWeight.Medium)
                first.published?.let { Plain("${Exams.time(it.take(10))} 官方发布", 12.sp, Ink.muted) }
            }
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).padding(start = 8.dp, top = 6.dp)) {
                Box(Modifier.width(1.dp).fillMaxHeight().background(Ink.line))
                Column(Modifier.weight(1f).padding(start = 12.dp)) {
                    adopted.forEach { source ->
                        val name = Exams.fileName(source.file)
                        if (attachments[source.url] == 1) Plain("$name ↗", 13.sp, Ink.brand, modifier = Modifier.fillMaxWidth().semantics { contentDescription = "官方附件：$name" }.clickable(role = Role.Button) { links.openUri(source.url) }.heightIn(min = Tokens.Size.target.dp).padding(vertical = 8.dp))
                        else Plain(name, 13.sp, modifier = Modifier.padding(vertical = 8.dp))
                    }
                    attachments.filterValues { it > 1 }.keys.forEach { url -> Plain("官方附件 ↗", 13.sp, Ink.brand, modifier = Modifier.clickable { links.openUri(url) }.heightIn(min = Tokens.Size.target.dp).padding(vertical = 8.dp)) }
                }
            }
        }
    }
}

/** The selected class's public history never disappears when a lesson is hidden. */
@Composable fun ExamRecordView(record: ExamRecord) {
    val versions = Exams.history(record)
    var chosen by remember(record) { mutableStateOf(versions.firstOrNull()?.id) }
    val mark = marks()
    Column(Modifier.padding(top = 24.dp, bottom = 24.dp)) {
        record.checked?.let { Plain("最近核对 ${Exams.time(it)}", 13.sp, Ink.muted, modifier = Modifier.padding(bottom = 6.dp)) }
        versions.firstOrNull { it.changes.isNotEmpty() }?.let { Plain("本班最近变更 · ${Exams.versionTime(it)}", 13.sp, Ink.muted, modifier = Modifier.padding(bottom = 6.dp)) }
        val affected = versions.count { it.changes.isNotEmpty() }
        Row(Modifier.padding(top = 20.dp, bottom = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Plain("更新记录", 17.sp, weight = FontWeight.SemiBold)
            Plain("${versions.size} 版" + if (affected > 0) " · $affected 次影响本班" else "", 12.sp, Ink.muted)
        }
        versions.forEachIndexed { index, version -> key(version.id) {
            val current = index == 0
            val open = chosen == version.id
            val shape = RoundedCornerShape(Tokens.Radius.card.dp)
            val colors = MaterialTheme.colorScheme
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Box(Modifier.width(16.dp).fillMaxHeight()) {
                    if (index < versions.lastIndex) Box(Modifier.align(Alignment.TopCenter).padding(top = 28.dp).width(1.dp).fillMaxHeight().background(Ink.line))
                    Box(Modifier.align(Alignment.TopCenter).padding(top = 20.dp).size(20.dp).then(if (current) Modifier.background(colors.primaryContainer, CircleShape) else Modifier), contentAlignment = Alignment.Center) {
                        Box(Modifier.size(12.dp).background(if (current) Ink.brand else Ink.paper, CircleShape).border(2.dp, if (current) Ink.brand else Ink.muted, CircleShape))
                    }
                }
                Column(Modifier.weight(1f).padding(bottom = 14.dp).clip(shape).background(if (current && open) lerp(colors.surfaceContainerHigh, Ink.brand, .07f) else if (open) colors.surfaceContainerHigh else colors.surfaceContainer).border(1.dp, if (current) Ink.brand.copy(alpha = .4f) else Ink.line, shape)) {
                    Row(Modifier.fillMaxWidth().semantics { stateDescription = if (open) "已展开" else "已收起" }.clickable(role = Role.Button) { chosen = version.id }.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Plain(Exams.versionTime(version), 15.sp, weight = FontWeight.SemiBold)
                            if (current) SmallTag("当前版本", colors.primaryContainer, colors.onPrimaryContainer)
                            Plain(Exams.impact(version.baseline, version.changes), 12.5.sp, Ink.muted)
                        }
                        Plain(if (open) "⌃" else "⌄", 17.sp, Ink.muted)
                    }
                    if (open) Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 12.dp)) {
                        if (version.changes.isNotEmpty()) Column(Modifier.fillMaxWidth().topHairline(Ink.line).padding(top = 12.dp, bottom = 16.dp)) {
                            Plain("对本班的影响", 13.sp, weight = FontWeight.SemiBold)
                            version.changes.forEach { change ->
                                Row(Modifier.padding(vertical = 7.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    Plain(Exams.changeNames.getValue(change.change), 11.5.sp, when (change.change) { "added" -> mark.free; "changed" -> mark.warning; else -> colors.error }, FontWeight.Medium)
                                    Column(Modifier.weight(1f)) {
                                        Plain(Names.course(change.course.name), 14.sp)
                                        Exams.changeLines(change).forEach { Plain(it, 12.5.sp, Ink.muted) }
                                    }
                                }
                            }
                        }
                        Column(Modifier.fillMaxWidth().topHairline(Ink.line).padding(top = 12.dp)) {
                            Plain("本版采用的文件 · ${version.files.size} 份", 13.sp, weight = FontWeight.SemiBold, modifier = Modifier.padding(bottom = 8.dp))
                            Sources(version.files)
                        }
                    }
                }
            } }
        }
    }
}
