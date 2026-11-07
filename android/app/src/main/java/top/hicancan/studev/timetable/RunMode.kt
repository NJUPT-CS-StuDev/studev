package top.hicancan.studev.timetable

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import top.hicancan.studev.app.*
import top.hicancan.studev.world.*
import java.time.LocalDate

/** The count, the bonus or penalty and the automatic plan, above the term's mornings. */
@Composable fun RunPanel(plan: RunPlan, line: CampusLine, now: Moment, model: CampusModel) {
    val tally = CampusLine.tally(plan)
    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Plain(tally.count.toString(), 34.sp, weight = FontWeight.SemiBold)
        Plain("/ ${plan.rule.required} 次", 14.sp, Ink.muted, modifier = Modifier.padding(bottom = 6.dp))
    }
    val adjustText = if (plan.adjust != 0) " · 奖惩 ${if (plan.adjust > 0) "+" else ""}${plan.adjust}" else ""
    Plain("已跑 ${tally.done}$adjustText · 计划 ${tally.planned} · ${if (tally.need > 0) "还差 ${tally.need}" else "够了"}" + (tally.nextBonus?.let { " · 跑到 ${it[0]} 次加 ${it[1]} 分" } ?: ""), 13.5.sp, Ink.muted, modifier = Modifier.padding(bottom = 8.dp))
    ActionButton("自动排好剩下的", go = true, modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp), enabled = tally.need > 0 || tally.planned > 0) {
        model.setRun { it.copy(runDays = CampusLine.planRuns(plan, line, now)) }
    }
    KeyRow(null, "奖惩次数", "对照南邮小程序的奖惩记录", trailing = {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Chip("−", { model.setRun { it.copy(runAdjust = it.runAdjust - 1) } })
            Plain(if (plan.adjust > 0) "+${plan.adjust}" else plan.adjust.toString(), 14.sp)
            Chip("+", { model.setRun { it.copy(runAdjust = it.runAdjust + 1) } })
        }
    })
    Spacer(Modifier.height(12.dp))
}

/** One morning in the term grid: run, planned, open or gone. Tapping it moves it on. */
@Composable fun RunCell(date: LocalDate, plan: RunPlan, runnable: Boolean, now: Moment, model: CampusModel, modifier: Modifier = Modifier) {
    val free = marks().free
    val state = plan.days[date.toString()]
    val gone = runnable && state == null && date < now.date
    val shape = RoundedCornerShape(4.dp)
    Box(modifier.height(30.dp).padding(horizontal = 1.5.dp).clip(shape)
        .background(when { !runnable -> Color.Transparent; state == "done" -> free; state == "plan" -> free.copy(alpha = .22f); else -> Color.Transparent })
        .then(if (date == now.date) Modifier.border(1.5.dp, marks().now, shape) else if (state == "plan") Modifier.border(1.dp, free, shape) else if (runnable && !gone && state == null) Modifier.border(1.dp, Ink.faint, shape) else Modifier)
        .then(if (runnable) Modifier.clickable { model.setRun { it.copy(runDays = CampusLine.nextRunMark(it.runDays, date, now.date)) } } else Modifier),
        contentAlignment = Alignment.Center) {
        Plain(date.dayOfMonth.toString(), 12.sp, when { !runnable -> Ink.line; state == "done" -> Color.White; state == "plan" -> free; gone -> Ink.faint; else -> Ink.text })
    }
}
