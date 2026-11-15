// Where the sun is over the campus at a moment, as src/campus/map/model/sun.ts and Android's Sun say it: the scene's
// light and the buildings' shadows on the map follow it.
namespace StuDev.World;

public static class Sun
{
    /** Altitude above the horizon and azimuth clockwise from north, in degrees. */
    public static (double Altitude, double Azimuth) At(DateOnly date, int minutes, double longitude, double latitudeDegrees)
    {
        const double radian = Math.PI / 180;
        var latitude = latitudeDegrees * radian;
        double day = date.DayOfYear;
        var declination = 23.44 * Math.Sin(2 * Math.PI * (284 + day) / 365) * radian;
        var b = 2 * Math.PI * (day - 81) / 364;
        var equation = 9.87 * Math.Sin(2 * b) - 7.53 * Math.Cos(b) - 1.5 * Math.Sin(b);
        var hour = ((minutes + 4 * (longitude - 120) + equation) / 4 - 180) * radian;
        var altitude = Math.Asin(Math.Sin(latitude) * Math.Sin(declination) + Math.Cos(latitude) * Math.Cos(declination) * Math.Cos(hour));
        var azimuth = Math.Atan2(-Math.Sin(hour) * Math.Cos(declination), Math.Cos(latitude) * Math.Sin(declination) - Math.Sin(latitude) * Math.Cos(declination) * Math.Cos(hour));
        return (altitude / radian, (azimuth / radian + 360) % 360);
    }
}
