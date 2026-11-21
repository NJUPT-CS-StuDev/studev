package top.hicancan.studev.world

import top.hicancan.studev.data.Practice

/** Course names, teachers and progress from the same off-grid teaching facts as the web. */
object Practices {
    private val duration = Regex("\\(共\\d+周\\)/.*$")
    fun name(practice: Practice) = practice.name.let { if ('”' in it && '“' !in it) "“$it" else it }
    fun teachers(practice: Practice): List<String> =
        if (practice.text.startsWith(practice.name)) practice.text.removePrefix(practice.name)
            .replace(duration, "").split(',', '，', '、').map(String::trim).filter(String::isNotEmpty)
        else emptyList()
    fun progress(weeks: List<Int>, current: Int?): String {
        val first = weeks.min()
        val last = weeks.max()
        return when {
            current == null -> "第 $first 周开始"
            current < first -> "${first - current} 周后开始"
            current > last -> "已结束"
            else -> "进行中 · 第 ${current - first + 1} / ${last - first + 1} 周"
        }
    }
    fun resources(practice: Practice) = name(practice).filterNot { it in "“”\"" }.removeSuffix("实践").trim()
}
