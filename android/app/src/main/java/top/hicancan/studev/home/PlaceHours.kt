package top.hicancan.studev.home

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import top.hicancan.studev.data.Place

@Composable
fun PlaceHours(place: Place) {
    if (place.hours == null) return
    val now = CampusClock.now()
    val status = openingStatus(place.hours, now)
    var expanded by rememberSaveable(place.id) { mutableStateOf(false) }
    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Icon(Icons.Outlined.Schedule, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.primary)
                Text(status.state.label, Modifier.weight(1f), style = MaterialTheme.typography.labelLarge,
                    color = if (status.state in listOf(OpenState.Open, OpenState.Closing)) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                if (place.hours != null) TextButton(onClick = { expanded = !expanded }, contentPadding = PaddingValues(horizontal = 8.dp), modifier = Modifier.height(32.dp)) {
                    Text("一周时间"); Icon(if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, null, Modifier.size(16.dp))
                }
            }
            Text(if (place.hours == null) status.today else "今日  ${status.today}", style = MaterialTheme.typography.bodyMedium)
            if (status.state == OpenState.Closing) Text("${status.closesAt} 关闭，请留意时间", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            if (expanded) {
                HorizontalDivider(Modifier.padding(vertical = 7.dp))
                (1..7).forEach { day ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
                        Text("周${"一二三四五六日"[day - 1]}", Modifier.width(48.dp), style = MaterialTheme.typography.bodyMedium,
                            color = if (day == now.dayOfWeek.value) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(place.hours!!.week[day.toString()].orEmpty().joinToString("  ·  ") { "${it[0]}–${it[1]}" }.ifEmpty { "不开放" }, style = MaterialTheme.typography.bodyMedium)
                    }
                }
                place.hours?.note?.let { Text(it, Modifier.padding(top = 8.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                Text(if (place.sources.any { it.startsWith("hours:https://lib.") }) "来源：南京邮电大学图书馆" else "来源：高德地图 POI / 开放街图",
                    style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
