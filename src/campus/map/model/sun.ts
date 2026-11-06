/** Where the sun is over the campus at a moment: altitude above the horizon and azimuth, in degrees. */
export function sunAt(date: string, minutes: number) {
    const radian = Math.PI / 180;
    const latitude = 32.11 * radian;
    const longitude = 118.92;
    const year = Number(date.slice(0, 4));
    const dayOfYear = (Date.parse(`${date}T00:00:00Z`) - Date.UTC(year, 0, 0)) / 864e5;
    const declination = 23.44 * Math.sin(2 * Math.PI * (284 + dayOfYear) / 365) * radian;
    const b = 2 * Math.PI * (dayOfYear - 81) / 364;
    const equation = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
    const hour = ((minutes + 4 * (longitude - 120) + equation) / 4 - 180) * radian;
    const altitude = Math.asin(Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(hour));
    const azimuth = Math.atan2(-Math.sin(hour) * Math.cos(declination), Math.cos(latitude) * Math.sin(declination) - Math.sin(latitude) * Math.cos(declination) * Math.cos(hour));
    return { alt: altitude / radian, az: (azimuth / radian + 360) % 360 };
}
