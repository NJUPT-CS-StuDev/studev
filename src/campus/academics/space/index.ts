// Places as studev serves them: campuses, buildings, floors and rooms with
// readable ids ("仙林", "教1", "教1/1", "教1-101").

export interface Campus {
    campus_id: string;
    name: string;
}

export interface Building {
    building_id: string;
    campus_id: string;
    name: string;
    aliases: string[];
}

export interface Floor {
    floor_id: string;
    building_id: string;
    level: string;
}

export interface SpaceFamily {
    space_family_id: string;
    building_id: string;
    floor_id: string;
    room_number: string;
    aliases: string[];
    kinds: string[];
    availability_eligible: 'eligible' | 'ineligible';
    /** Seats, when the free-room page lists the room. */
    seats?: number;
}

export interface SpaceIndex {
    campuses: Campus[];
    buildings: Building[];
    floors: Floor[];
    families: SpaceFamily[];
}
