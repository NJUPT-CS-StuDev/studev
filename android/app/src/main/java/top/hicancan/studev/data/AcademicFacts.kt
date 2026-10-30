package top.hicancan.studev.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable data class DataRelease(val version: String, val base: String, val built_at: String, val teaching: String, val exams: String? = null, val rooms: String)
@Serializable data class TeachingWeek(val week: Int, val start: String, val end: String)
@Serializable data class TeachingTerm(val term: String, val year: Int, val number: Int, val weeks: List<TeachingWeek>, val observed_at: String)
@Serializable data class TeachingPeriod(val period: Int, val start: String, val end: String, val part: String?)
@Serializable data class TeachingClass(val id: String, val name: String, val grade: String?, val college: String?, val major: String?, val campus: String?, val students: Int?, val practice: List<String>)
@Serializable data class Course(val code: String?, val name: String, val category: String?, val nature: String?, val credits: Double?, val hours: Double?, val hours_composition: String?, val assessment: String?, val exam: String?)
@Serializable data class Teacher(val name: String, val title: String?, val role: String?, val weeks: List<Int>)
@Serializable data class TeachingGroup(val id: String?, val name: String?, val size: Int?, val enrolled: Int?, val capacity: Int?)
@Serializable data class TeachingMeeting(val id: String, val course: Course, val teachers: List<Teacher>, val teaching_class: TeachingGroup, val campus: String?, val location: String?, val room: String?, val weekday: Int, val periods: List<Int>, val weeks: List<Int>, val method: String?, val classes: List<String>)
@Serializable data class ClassSchedule(@SerialName("class") val klass: TeachingClass, val meetings: List<TeachingMeeting>)
@Serializable data class ExamCourse(val code: String?, val name: String)
@Serializable data class Exam(val id: String, @SerialName("class") val klass: String, val course: ExamCourse, val teacher: String?, val campus: String?, val location: String?, val room: String?, val date: String, val start: String, val end: String, val students: Int?, val note: String?)
@Serializable data class ExamSource(val file: String, val url: String, val notice: String, val title: String)
@Serializable data class ExamIndex(val classes: List<String>, val sources: List<ExamSource>)
@Serializable data class ClassExams(val exams: List<Exam>, val changes: List<JsonObject>)
@Serializable data class Room(val id: String, val building: String, val floor: String, val number: String, val campus: String, val kinds: List<String>, val names: List<String>, val listed: Boolean = false, val seats: Int? = null, val exam_seats: Int? = null)
@Serializable data class Building(val id: String, val campus: String, val floors: List<String>)
@Serializable data class AcademicCampus(val id: String, val aliases: List<String>)
@Serializable data class RoomIndex(val term: String, val weeks: List<TeachingWeek>, val periods: List<TeachingPeriod>, val rooms: List<Room>, val buildings: List<Building>, val campuses: List<AcademicCampus>)
@Serializable data class RoomOccupant(val kind: String, val id: String, val course: String, val teachers: List<String>, val classes: List<String>, val periods: List<Int>)
@Serializable data class RoomDay(val date: String, val observed_at: String? = null, val week: Int, val weekday: Int, val free: Map<String, List<String>>? = null, val occupied: Map<String, List<RoomOccupant>>)
