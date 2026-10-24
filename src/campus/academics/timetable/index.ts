// Teaching data as studev serves it: data/<release>/timetable/.

export interface TeachingWeek {
    week: number;
    start_date: string;
    end_date: string;
}

export interface TeachingPeriod {
    period: number;
    start_time: string;
    end_time: string;
    day_part: string;
}

export interface TeachingTerm {
    academic_year: string;
    term_number: number;
    weeks: TeachingWeek[];
}

export interface TeachingPeriods {
    periods: TeachingPeriod[];
}

export interface TeachingClassIndexEntry {
    class_id: string;
    class_name: string;
    meeting_count: number;
}

export interface TeachingClass {
    class_id: string;
    class_name: string;
    grade: string | null;
    college: string | null;
    major: string | null;
    campus: string | null;
    students: number | null;
    practice: string[];
    meeting_ids: string[];
}

export interface TeachingMeeting {
    meeting_id: string;
    teaching_class_id: string | null;
    teaching_class_name: string | null;
    course_code: string | null;
    course_name: string;
    course_category: string | null;
    course_nature: string | null;
    teacher: string | null;
    teacher_title: string | null;
    instructor_role: string | null;
    campus: string | null;
    room_id: string | null;
    location: string | null;
    weekday: number;
    start_period: number;
    end_period: number;
    week_numbers: number[];
    teaching_method: string | null;
    assessment_method: string | null;
    exam_method: string | null;
    credits: number | null;
    class_hours: number | null;
    course_total_hours: number | null;
    class_hours_composition: string | null;
    teaching_class_size: number | null;
    enrollment_count: number | null;
    capacity: number | null;
    enrollment_note: string | null;
    direction: string | null;
    online_information: string | null;
    class_ids: string[];
}

/** timetable/index.json */
export interface TimetableIndexFile {
    observed_at: string;
    term: TeachingTerm;
    periods: TeachingPeriod[];
    classes: TeachingClassIndexEntry[];
}

/** timetable/classes/<class_id>.json */
export interface TimetableClassFile {
    class: TeachingClass;
    meetings: TeachingMeeting[];
}

/** A course meeting in a room on one day. */
export interface TeachingRoomBooking {
    meeting_id: string;
    course_name: string;
    course_code: string | null;
    class_ids: string[];
    teacher: string | null;
    location: string | null;
    space_family_id: string;
    floor_id: string;
    start_period: number;
    end_period: number;
}

/** Course bookings of one day, keyed by period number. */
export interface TeachingRoomDay {
    periods: Record<string, TeachingRoomBooking[]>;
}
