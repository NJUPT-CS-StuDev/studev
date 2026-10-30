import type { ClassroomIndexFile } from './ClassroomAvailabilityClient';
import type { RoomDay } from '@/academics/facts';
import { campusBuildings, isFree, roomMatches } from './campusDay';
import { selectedBuilding } from './buildingSelection';

export interface RoomSelection { campus: string; buildings: string[] | null; everything: boolean; query: string; minSeats: number; from: number; until: number }
export const matchingRooms = (index: ClassroomIndexFile, query: RoomSelection) => campusBuildings(index, query.campus, query.everything)
    .filter(building => selectedBuilding(query.buildings, building.id)).flatMap(building => building.rooms)
    .filter(room => roomMatches(room, query.query) && (!query.minSeats || (room.seats ?? 0) >= query.minSeats));
export const roomSelectionResult = (index: ClassroomIndexFile, day: RoomDay, query: RoomSelection) => {
    const rooms = matchingRooms(index, query);
    return { rooms: rooms.map(room => room.id).sort(), free: rooms.filter(room => isFree(day, room.id, query.from, query.until)).map(room => room.id).sort() };
};
