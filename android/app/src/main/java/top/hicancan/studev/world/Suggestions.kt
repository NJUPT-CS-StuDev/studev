package top.hicancan.studev.world

import top.hicancan.studev.timetable.TimetablePresentation
import java.time.LocalDate

/**
 * What a person's own line suggests they write down, as src/campus/world/suggestions.ts: to revise the day before each
 * exam, and to hand in the report a week after each lab. Offered until taken or put aside; nothing is added unasked.
 */
object Suggestions {
    data class Suggestion(val key: String, val task: Task)
    private const val OFFERED = 3
    /** 实验二：组网与路由器配置 → 组网与路由器配置实验报告; Cachelab实验(上) → Cachelab实验(上)报告. */
    fun reportTitle(project: String): String {
        val name = project.replace(Regex("^实验[一二三四五六七八九十\\d]+\\s*[：:]\\s*"), "").trim().ifEmpty { project }
        return if ("实验" in name) "${name}报告" else "${name}实验报告"
    }
    fun suggest(line: CampusLine, now: Moment, setAside: Collection<String>): List<Suggestion> {
        val titles = line.tasks.filter { it.deleted != true }.mapTo(HashSet()) { it.title }
        val exams = line.upcomingExams(now.date.plusDays(1)).map { exam ->
            Suggestion("exam:${exam.id}", Task("", "复习${Names.courseShort(exam.course.name)}", course = TimetablePresentation.linked(exam.course.code, exam.course.name, line.meetings),
                due = TaskDeadline(LocalDate.parse(exam.date).minusDays(1).toString()), modified = ""))
        }
        val seen = HashSet<String>()
        val labs = line.labs.filter { it.date >= now.date.toString() }.sortedWith(compareBy({ it.date }, { it.start }))
            .filter { seen.add(TimetablePresentation.linked(it, line.meetings)) }
            .map { lab -> Suggestion("lab:${lab.id}", Task("", reportTitle(lab.project), course = TimetablePresentation.linked(lab, line.meetings), due = TaskDeadline(LocalDate.parse(lab.date).plusDays(7).toString()), modified = "")) }
        return (exams + labs).sortedWith(compareBy({ it.task.due!!.date }, { it.key }))
            .filter { it.key !in setAside && it.task.title !in titles }.take(OFFERED)
    }
    /** What one can type, offered while the list is empty, as TASK_EXAMPLES. */
    val EXAMPLES = listOf("明天下午3点 交毛概作业 !!", "周五前 交实验报告", "晚上8点到10点 自习", "下周三 答辩 #")
}
