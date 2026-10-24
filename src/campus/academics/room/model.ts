/** An exam held in a room. */
export interface RoomBooking {
    exam_id: string;
    stable_key: string;
    class_name: string;
    course_name: string;
    course_code: string;
    teacher: string;
    count: number;
    date: string;
    start_timestamp: string;
    end_timestamp: string;
    duration_minutes: number;
    location: string;
    campus: string;
    space_family_id: string;
    floor_id: string;
}
