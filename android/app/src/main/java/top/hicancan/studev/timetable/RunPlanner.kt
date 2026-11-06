package top.hicancan.studev.timetable

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import top.hicancan.studev.app.*
import top.hicancan.studev.app.CampusModel
import top.hicancan.studev.app.marks
import top.hicancan.studev.world.*
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters

/** One tap moves a morning on: ahead it can only be planned; from today back it can be run. */
private fun nextMark(days: Map<String, String>, date: LocalDate, today: LocalDate): Map<String, String> {
    val key = date.toString()
    val mark = days[key]
    return when {
        date > today -> if (mark != null) days - key else days + (key to "plan")
        mark == "done" -> days - key
        date == today && mark == null -> days + (key to "plan")
        else -> days + (key to "done")
    }
}

/** The whole term's mornings: run, planned, or still open. */
@Composable fun RunPlanner(plan: RunPlan, line: CampusLine, now: Moment, model: CampusModel, onClose: () -> Unit) {
    val mark = marks()
    val tally = CampusLine.tally(plan)
    val open = CampusLine.runDates(plan.rule, line.holidays).toSet()
    val end = LocalDate.parse(plan.rule.end)
    val weeks = generateSequence(LocalDate.parse(plan.rule.start).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))) { it.plusWeeks(1) }.takeWhile { it <= end }.toList()
    PlainSheet("早锻炼", onClose) {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Plain(tally.count.toString(), 34.sp, weight = FontWeight.SemiBold)
                Plain("/ ${plan.rule.required} 次", 14.sp, Ink.muted, modifier = Modifier.padding(bottom = 6.dp))
            }
            val adjustText = if (plan.adjust != 0) " · 奖惩 ${if (plan.adjust > 0) "+" else ""}${plan.adjust}" else ""
            Plain("已跑 ${tally.done}$adjustText · 计划 ${tally.planned} · ${if (tally.need > 0) "还差 ${tally.need}" else "够了"}" + (tally.nextBonus?.let { " · 跑到 ${it[0]} 次加 ${it[1]} 分" } ?: ""), 13.5.sp, Ink.muted, modifier = Modifier.padding(bottom = 10.dp))
            KeyRow(null, "奖惩次数", "对照南邮小程序的奖惩记录", trailing = {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Chip("−", { model.setRun { it.copy(runAdjust = it.runAdjust - 1) } })
                    Plain(if (plan.adjust > 0) "+${plan.adjust}" else plan.adjust.toString(), 14.sp)
                    Chip("+", { model.setRun { it.copy(runAdjust = it.runAdjust + 1) } })
                }
            })
            ActionButton("自动排好剩下的", go = true, modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp), enabled = tally.need > 0 || tally.planned > 0) {
                model.setRun { it.copy(runDays = CampusLine.planRuns(plan, line, now)) }
            }
            Row(Modifier.padding(top = 6.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf(mark.free to "已跑", mark.free.copy(alpha = .22f) to "计划", Ink.sunken to "可跑").forEach { (color, label) ->
                    Box(Modifier.size(10.dp).clip(RoundedCornerShape(2.dp)).background(color)); Plain(label, 12.sp, Ink.muted, modifier = Modifier.padding(end = 8.dp))
                }
            }
            Row(Modifier.fillMaxWidth().padding(bottom = 4.dp)) {
                Spacer(Modifier.width(48.dp))
                listOf("一", "二", "三", "四", "五").forEach { Box(Modifier.weight(1f), contentAlignment = Alignment.Center) { Plain(it, 12.sp, Ink.faint) } }
            }
            weeks.forEach { monday ->
                Row(Modifier.fillMaxWidth().padding(bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Plain("${monday.monthValue}/${monday.dayOfMonth}", 11.sp, Ink.faint, modifier = Modifier.width(48.dp))
                    (0L..4L).forEach { offset ->
                        val date = monday.plusDays(offset)
                        val state = plan.days[date.toString()]
                        val runnable = date in open
                        val gone = runnable && state == null && date < now.date
                        Box(Modifier.weight(1f).padding(horizontal = 2.dp).height(32.dp).clip(RoundedCornerShape(4.dp))
                            .background(when { !runnable -> Color.Transparent; state == "done" -> mark.free; state == "plan" -> mark.free.copy(alpha = .22f); gone -> Color.Transparent; else -> Ink.sunken })
                            .then(if (date == now.date) Modifier.border(1.5.dp, Ink.text, RoundedCornerShape(4.dp)) else if (state == "plan") Modifier.border(1.dp, mark.free, RoundedCornerShape(4.dp)) else if (gone) Modifier.border(1.dp, Ink.line, RoundedCornerShape(4.dp)) else Modifier)
                            .then(if (runnable) Modifier.clickable { model.setRun { it.copy(runDays = nextMark(it.runDays, date, now.date)) } } else Modifier),
                            contentAlignment = Alignment.Center) {
                            Plain(date.dayOfMonth.toString(), 13.sp, when { !runnable -> Ink.line; state == "done" -> Color.White; state == "plan" -> mark.free; gone -> Ink.faint; else -> Ink.muted })
                        }
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}
