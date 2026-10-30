// studev's two map flavors: the Protomaps base cartography in studev's palette.
// Quiet greys for the city, the campus a shade cooler, water and parks muted so the
// brand blue of routes and the user's position stays the strongest colour on screen.
import { namedFlavor } from '@protomaps/basemaps';

export const light = {
    ...namedFlavor('light'),
    background: '#f3f4f6', earth: '#f3f4f6',
    park_a: '#dcecd6', park_b: '#d3e7cb', wood_a: '#d7e8cf', wood_b: '#cfe3c6', scrub_a: '#e0ecd8', scrub_b: '#d8e8cf',
    school: '#eaeef6', hospital: '#f6e9ea', industrial: '#eceef1', pedestrian: '#eef0f3', aerodrome: '#e9ecf0',
    sand: '#efebe0', beach: '#efebe0', glacier: '#f6f8fa', zoo: '#e1ecd7', military: '#ebe8e8',
    water: '#b4d6ef', buildings: '#e2e5ea', pier: '#e4e7eb', runway: '#e2e5ea',
    other: '#ffffff', minor_service: '#ffffff', minor_a: '#ffffff', minor_b: '#ffffff', link: '#ffffff', major: '#ffffff', highway: '#fdf0d5',
    minor_service_casing: '#dfe2e6', minor_casing: '#d9dce1', link_casing: '#d3d7dc', major_casing_early: '#d3d7dc', major_casing_late: '#cfd3d9',
    highway_casing_early: '#ead8b4', highway_casing_late: '#e3cc9f',
    railway: '#c9ced5', boundaries: '#b8bec7',
    roads_label_minor: '#5f6368', roads_label_minor_halo: '#ffffff', roads_label_major: '#4a4f55', roads_label_major_halo: '#ffffff',
    subplace_label: '#6b7178', subplace_label_halo: '#ffffff', city_label: '#3c4043', city_label_halo: '#ffffff',
    state_label: '#9aa0a6', state_label_halo: '#ffffff', country_label: '#9aa0a6', ocean_label: '#6b8fae',
    address_label: '#9aa0a6', address_label_halo: '#ffffff',
};

export const dark = {
    ...namedFlavor('dark'),
    background: '#14181d', earth: '#171c22',
    park_a: '#1c2a22', park_b: '#1e2d24', wood_a: '#1c2a21', wood_b: '#1e2c22', scrub_a: '#1d2822', scrub_b: '#1f2a23',
    school: '#1b222c', hospital: '#2a2024', industrial: '#1d2228', pedestrian: '#1e242b', aerodrome: '#1d2228',
    sand: '#252520', beach: '#252520', glacier: '#20262d', zoo: '#1c2a22', military: '#262224',
    water: '#1d3447', buildings: '#232a33', pier: '#232a33', runway: '#2a313a',
    other: '#2a313a', minor_service: '#262d36', minor_a: '#2c343e', minor_b: '#2c343e', link: '#323a45', major: '#363f4b', highway: '#4a4334',
    minor_service_casing: '#171c22', minor_casing: '#171c22', link_casing: '#171c22', major_casing_early: '#171c22', major_casing_late: '#171c22',
    highway_casing_early: '#171c22', highway_casing_late: '#171c22',
    railway: '#3a424d', boundaries: '#4a5360',
    roads_label_minor: '#9aa4b1', roads_label_minor_halo: '#14181d', roads_label_major: '#b8c1cc', roads_label_major_halo: '#14181d',
    subplace_label: '#9aa4b1', subplace_label_halo: '#14181d', city_label: '#d5dce4', city_label_halo: '#14181d',
    state_label: '#6f7985', state_label_halo: '#14181d', country_label: '#6f7985', ocean_label: '#5d7c96',
    address_label: '#6f7985', address_label_halo: '#14181d',
};
