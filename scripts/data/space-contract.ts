export const SPACE_FILES = [
    'entities.json',
    'network.json',
    'basemap.pmtiles',
    'style-light.json',
    'style-dark.json',
] as const;

export const SPACE_DIRECTORIES = ['search'] as const;

/** Source locations that consume each file or generated directory. */
export const SPACE_READERS = {
    'entities.json': [
        ['src/campus/map/model/space.ts', 'entities.json'],
        ['android/app/src/main/java/top/hicancan/studev/data/CampusPackage.kt', 'entities.json'],
    ],
    'network.json': [
        ['src/campus/map/model/space.ts', 'network.json'],
        ['android/app/src/main/java/top/hicancan/studev/navigation/Wayfind.kt', 'network.json'],
    ],
    'basemap.pmtiles': [
        ['src/campus/map/MapApp.tsx', 'pmtiles'],
        ['android/app/src/main/java/top/hicancan/studev/data/CampusPackage.kt', 'basemap.pmtiles'],
    ],
    'style-light.json': [
        ['src/campus/map/model/space.ts', 'style-${theme}.json'],
        ['android/app/src/main/java/top/hicancan/studev/data/CampusPackage.kt', 'style-light.json'],
    ],
    'style-dark.json': [
        ['src/campus/map/model/space.ts', 'style-${theme}.json'],
        ['android/app/src/main/java/top/hicancan/studev/data/CampusPackage.kt', 'style-dark.json'],
    ],
    search: [
        ['src/campus/app/App.tsx', '/search'],
        ['android/app/src/main/java/top/hicancan/studev/search/CampusSearch.kt', 'search/manifest.json'],
    ],
} as const;
