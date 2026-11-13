// Time on campus, as src/campus/world/time.ts and android world/CampusLine.kt say it: China time, a date and the minute
// of the day, 11月16日, 周一, 08:00.
namespace StuDev.World;

public readonly record struct Moment(DateOnly Date, int Min)
{
    public static Moment Now() { var at = CampusDay.Now(); return new(DateOnly.FromDateTime(at), at.Hour * 60 + at.Minute); }
}

public static class CampusDay
{
    public static readonly TimeZoneInfo Zone = TimeZoneInfo.FindSystemTimeZoneById("China Standard Time");
    public static DateTime Now() => TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Zone);
    public static DateOnly Today() => DateOnly.FromDateTime(Now());
}

public static class Clock
{
    public static readonly string[] Weekdays = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
    public static int Minutes(string value) => int.Parse(value[..2]) * 60 + int.Parse(value[3..5]);
    public static string Hm(int minutes) => $"{minutes / 60:00}:{minutes % 60:00}";
    public static string DateLabel(DateOnly date) => $"{date.Month}月{date.Day}日";
    /** Monday 1 to Sunday 7. */
    public static int Weekday(DateOnly date) => date.DayOfWeek == DayOfWeek.Sunday ? 7 : (int)date.DayOfWeek;
    public static DateOnly Parse(string date) => DateOnly.ParseExact(date, "yyyy-MM-dd");
    public static string Text(DateOnly date) => date.ToString("yyyy-MM-dd");
    public static DateOnly WeekStart(DateOnly date) => date.AddDays(1 - Weekday(date));
    /** A day said from today: 今天, 明天, 昨天, a weekday within the week ahead, else its date (time.ts dayWord). */
    public static string DayWord(DateOnly date, DateOnly today)
    {
        var days = date.DayNumber - today.DayNumber;
        return days switch { 0 => "今天", 1 => "明天", -1 => "昨天", > 1 and < 7 => Weekdays[Weekday(date)], _ => DateLabel(date) };
    }
    public static string DayWord(string date, DateOnly today) => DayWord(Parse(date), today);
    public static string Duration(int minutes) => minutes >= 60 ? $"{minutes / 60} 小时{(minutes % 60 > 0 ? $" {minutes % 60} 分" : "")}" : $"{minutes} 分钟";
}
