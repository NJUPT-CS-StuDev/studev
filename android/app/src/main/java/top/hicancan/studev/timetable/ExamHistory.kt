package top.hicancan.studev.timetable

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import top.hicancan.studev.app.*
import top.hicancan.studev.data.ExamRecord
import top.hicancan.studev.data.ExamSource
import top.hicancan.studev.world.Exams
import top.hicancan.studev.world.Names

@Composable private fun Fold(label: String, content: @Composable () -> Unit) {
    var expanded by remember(label) { mutableStateOf(false) }
    Column {
        Row(Modifier.fillMaxWidth().topHairline(Ink.line).clickable { expanded = !expanded }.padding(vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
            Plain(label, 13.5.sp, modifier = Modifier.weight(1f))
            Plain(if (expanded) "⌃" else "⌄", 14.sp, Ink.muted, modifier = Modifier.padding(start = 12.dp))
        }
        if (expanded) content()
    }
}

@Composable private fun Sources(files: List<ExamSource>) {
    val links = LocalUriHandler.current
    files.forEach { source ->
        Column(Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
            Plain(Exams.fileName(source.file), 13.sp)
            source.published?.let { Plain("${Exams.time(it.take(10))} 官方发布", 12.sp, Ink.muted) }
            Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                Plain("官方公告", 12.5.sp, Ink.brand, modifier = Modifier.clickable { links.openUri(source.notice) }.padding(vertical = 12.dp))
                Plain("官方附件", 12.5.sp, Ink.brand, modifier = Modifier.clickable { links.openUri(source.url) }.padding(vertical = 12.dp))
            }
        }
    }
    Plain("历史公告可能撤回，部分附件需连接校园网。", 12.5.sp, Ink.muted, modifier = Modifier.padding(bottom = 12.dp))
}

/** The selected class's public history never disappears when a lesson is hidden. */
@Composable fun ExamRecordView(record: ExamRecord) {
    val versions = Exams.history(record)
    val mark = marks()
    Column(Modifier.padding(top = 24.dp, bottom = 24.dp)) {
        record.checked?.let { Plain("最近核对 ${Exams.time(it)}", 13.sp, Ink.muted, modifier = Modifier.padding(bottom = 6.dp)) }
        versions.firstOrNull { it.changes.isNotEmpty() }?.let { Plain("本班最近变更 · ${Exams.versionTime(it)}", 13.sp, Ink.muted, modifier = Modifier.padding(bottom = 6.dp)) }
        versions.firstOrNull()?.takeUnless { it.baseline }?.let { Plain(Exams.impact(false, it.changes), 13.sp, Ink.muted, modifier = Modifier.padding(bottom = 6.dp)) }
        val affected = versions.count { it.changes.isNotEmpty() }
        Fold("更新记录 · ${versions.size} 版" + if (affected > 0) " · $affected 次影响本班" else "") {
            versions.forEach { version -> key(version.id) {
                Fold("${Exams.versionTime(version)} · ${Exams.impact(version.baseline, version.changes)}") {
                    version.changes.forEach { change ->
                        Row(Modifier.padding(vertical = 7.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Plain(Exams.changeNames.getValue(change.change), 11.5.sp, when (change.change) { "added" -> mark.free; "changed" -> mark.warning; else -> Ink.faint }, FontWeight.Medium)
                            Column(Modifier.weight(1f)) {
                                Plain(Names.course(change.course.name), 14.sp)
                                Exams.changeLines(change).forEach { Plain(it, 12.5.sp, Ink.muted) }
                            }
                        }
                    }
                    Fold("采用的文件 · ${version.files.size} 份") { Sources(version.files) }
                }
            } }
        }
        if (record.sources.isNotEmpty()) Fold("当前官方来源 · ${record.sources.size} 份") { Sources(record.sources) }
    }
}
