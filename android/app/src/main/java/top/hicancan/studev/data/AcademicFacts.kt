package top.hicancan.studev.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/** The current Android app, as the website's release manifest names it. */
@Serializable data class AppRelease(val versionName: String, val versionCode: Int)
@Serializable private data class ReleaseManifest(val android: AppRelease)
/**
 * What a check of the website found: the current app; the newer data, if any could be read; and whether
 * data was published that this app cannot read, which only a newer app can.
 */
class Discovery(val app: AppRelease, val repository: AcademicRepository?, val unreadable: Boolean) {
    val appBehind get() = app.versionCode > top.hicancan.studev.BuildConfig.VERSION_CODE
}
internal fun appInManifest(text: String): AppRelease = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }.decodeFromString<ReleaseManifest>(text).android
@Serializable data class DataRelease(val version: String, val base: String, val built_at: String, val teaching: String, val exams: String? = null, val rooms: String, val map_version: String? = null, val data_version: String? = null)
@Serializable data class TeachingWeek(val week: Int, val start: String, val end: String)
@Serializable data class TeachingTerm(val term: String, val year: Int, val number: Int, val weeks: List<TeachingWeek>, val observed_at: String)
@Serializable data class TeachingPeriod(val period: Int, val start: String, val end: String, val part: String?)
@Serializable data class TeachingClass(val id: String, val name: String, val grade: String?, val college: String?, val major: String?, val campus: String?, val students: Int?, val practice: List<Practice>)
/** Coursework off the timetable (课程设计, 实践): its weeks, and its name as far as the data proves it. */
@Serializable data class Practice(val name: String, val weeks: List<Int>, val text: String)
@Serializable data class Course(val code: String?, val name: String, val category: String?, val nature: String?, val credits: Double?, val hours: Double?, val hours_composition: String?, val assessment: String?, val exam: String?)
@Serializable data class CoursePlan(val id: String, val kind: String, val subtype: String, val names: List<String>, val aliases: List<String>, val source: String? = null, val teaching_class_ids: List<String> = emptyList())
@Serializable data class InformationEntityFile(val schema_version: String, val kind: String, val items: List<JsonObject>)
@Serializable data class AgentEntity(val id: String, val kind: String, val subtype: String, val names: List<String>, val aliases: List<String>, val source: String? = null, val role: String? = null, val size: Int? = null, val enrolled: Int? = null, val capacity: Int? = null)
@Serializable data class AgentEntityFile(val schema_version: String, val kind: String, val items: List<AgentEntity>)
@Serializable data class Teacher(val id: String, val name: String, val title: String?, val role: String?, val weeks: List<Int>)
@Serializable data class TeachingGroup(val id: String, val name: String? = null, val size: Int? = null, val enrolled: Int? = null, val capacity: Int? = null)
@Serializable data class TeachingMeeting(val id: String, val course: Course, val teachers: List<Teacher>, val teaching_class: TeachingGroup, val campus: String?, val room: String?, val location: String? = null, val weekday: Int, val periods: List<Int>, val weeks: List<Int>, val method: String?, val classes: List<String>, val kind: String, val subtype: String)
@Serializable data class ClassSchedule(@SerialName("class") val klass: TeachingClass, val meetings: List<TeachingMeeting>)
@Serializable data class ExamCourse(val code: String?, val name: String)
@Serializable data class Exam(val id: String, val classes: List<String>, val course: ExamCourse, val teacher: String?, val campus: String?, val location: String, val room: String?, val date: String, val start: String, val end: String, val students: Int?, val note: String?, val source: String, val kind: String, val subtype: String)
@Serializable data class ExamSource(val file: String, val url: String, val notice: String, val title: String)
@Serializable data class ExamIndex(val classes: List<String>, val sources: List<ExamSource>, val checked: String)
@Serializable data class ExamSlot(val date: String, val start: String, val end: String, val campus: String? = null, val location: String? = null, val teacher: String? = null, val students: Int? = null)
@Serializable data class ExamChange(val observed: String, val course: ExamCourse, val change: String, val before: List<ExamSlot>? = null, val after: List<ExamSlot>? = null)
@Serializable data class ClassExams(val exams: List<Exam>, val changes: List<ExamChange>)
/** How a class's exams came to be what they are: every change seen, the sheets they were read from,
 *  and when the teaching office's site was last looked at, published or not. */
data class ExamRecord(val changes: List<ExamChange>, val sources: List<ExamSource>, val checked: String?)
@Serializable data class Room(val id: String, val building: String, val floor: String, val number: String, val campus: String, val kinds: List<String>, val names: List<String>, val listed: Boolean = false, val seats: Int? = null, val exam_seats: Int? = null)
@Serializable data class Building(val id: String, val campus: String, val floors: List<String>)
@Serializable data class AcademicCampus(val id: String, val aliases: List<String>)
@Serializable data class RoomIndex(val term: String, val weeks: List<TeachingWeek>, val periods: List<TeachingPeriod>, val rooms: List<Room>, val buildings: List<Building>, val campuses: List<AcademicCampus>)
@Serializable data class RoomOccupant(val kind: String, val id: String, val course: String, val teachers: List<String>, val classes: List<String>, val periods: List<Int>)
@Serializable data class RoomDay(val date: String, val observed_at: String? = null, val week: Int, val weekday: Int, val free: Map<String, List<String>>? = null, val occupied: Map<String, List<RoomOccupant>>)
