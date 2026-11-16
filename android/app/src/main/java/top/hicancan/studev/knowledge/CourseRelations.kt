package top.hicancan.studev.knowledge

internal data class CourseEdge(val from: String, val to: String)
internal data class CourseRelations(val nodes: List<CurriculumCourse>, val edges: List<CourseEdge>, val choices: List<CurriculumCourse>, val unlinked: Int)

internal fun catalogScope(curriculum: List<CurriculumCourse>, grade: String?, major: String?, explicitCohort: String?, explicitMajor: String?): Pair<String, String> {
    val cohorts = curriculum.flatMap { it.plans.map { plan -> plan.grade } }.distinct().sortedDescending()
    val cohort = explicitCohort?.takeIf { it in cohorts } ?: grade?.takeIf { it in cohorts } ?: cohorts.firstOrNull().orEmpty()
    val majors = curriculum.flatMap { it.plans.filter { plan -> plan.grade == cohort }.map { plan -> plan.major } }.toSet()
    return cohort to ((explicitMajor ?: major)?.takeIf { it in majors } ?: "全部专业")
}

/** Display recorded links, retaining direct context outside a filter without inferring missing links. */
internal fun courseRelations(curriculum: List<CurriculumCourse>, selected: List<CurriculumCourse>, focus: String = "all"): CourseRelations {
    val byCode = curriculum.associateBy { it.code }
    val selectedCodes = selected.map { it.code }.toSet()
    val edges = curriculum.flatMap { course -> course.requires.filter { it in byCode }.map { CourseEdge(it, course.code) } }
        .filter { it.from in selectedCodes || it.to in selectedCodes }
    val connected = edges.flatMap { listOf(it.from, it.to) }.toSet()
    val shown = if (focus == "all") edges else edges.filter { it.from == focus || it.to == focus }
    val codes = shown.flatMap { listOf(it.from, it.to) }.toSet()
    return CourseRelations(curriculum.filter { it.code in codes }, shown, selected.filter { it.code in connected }, selected.count { it.code !in connected })
}
