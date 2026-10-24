import type { Building, Campus, Floor, SpaceFamily, SpaceIndex } from '@/academics/space';

export type { SpaceIndex } from '@/academics/space';

export interface SpaceFamilyView {
    family: SpaceFamily;
    campus: Campus;
    building: Building;
    floor: Floor;
}

export interface SpaceFilters {
    campus?: string | null;
    building?: string | null;
    floor?: string | null;
    query?: string | null;
}

/** Rooms matching campus/building/floor names and a free-text query. */
export const listFamilies = (index: SpaceIndex, filters: SpaceFilters): SpaceFamilyView[] => {
    const campuses = new Map(index.campuses.map(item => [item.campus_id, item]));
    const buildings = new Map(index.buildings.map(item => [item.building_id, item]));
    const floors = new Map(index.floors.map(item => [item.floor_id, item]));
    const query = filters.query?.trim().toLocaleLowerCase('zh-CN') ?? '';
    return index.families.flatMap(family => {
        const building = buildings.get(family.building_id);
        const floor = floors.get(family.floor_id);
        const campus = building ? campuses.get(building.campus_id) : undefined;
        if (!campus || !building || !floor) return [];
        const searchable = [campus.name, building.name, ...building.aliases, floor.level, family.room_number, family.space_family_id, ...family.aliases]
            .join(' ').toLocaleLowerCase('zh-CN');
        if (
            (filters.campus && campus.name !== filters.campus)
            || (filters.building && building.name !== filters.building)
            || (filters.floor && floor.level !== filters.floor)
            || (query && !searchable.includes(query))
        ) return [];
        return [{ family, campus, building, floor }];
    });
};
