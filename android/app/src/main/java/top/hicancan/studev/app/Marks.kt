package top.hicancan.studev.app

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** The states that have their own colour: blue is now, teal is free, amber is an exam, red is a day off
 *  (as on a Chinese calendar) and red is also what cannot be undone. */
data class Marks(val now: Color, val free: Color, val exam: Color, val onExam: Color, val holiday: Color, val danger: Color, val warning: Color)
@Composable fun marks() = if (isSystemInDarkTheme()) Tokens.Color.Dark.let { Marks(it.now, it.free, it.exam, it.onExam, it.holiday, it.danger, it.warning) }
    else Tokens.Color.Light.let { Marks(it.now, it.free, it.exam, it.onExam, it.holiday, it.danger, it.warning) }

/** One course keeps one tone everywhere. */
data class Tone(val bg: Color, val border: Color, val fg: Color)
fun lightTone(index: Int) = when (index) {
    0 -> Tone(Tokens.Course.Light.Tone0.bg, Tokens.Course.Light.Tone0.border, Tokens.Course.Light.Tone0.fg)
    1 -> Tone(Tokens.Course.Light.Tone1.bg, Tokens.Course.Light.Tone1.border, Tokens.Course.Light.Tone1.fg)
    2 -> Tone(Tokens.Course.Light.Tone2.bg, Tokens.Course.Light.Tone2.border, Tokens.Course.Light.Tone2.fg)
    3 -> Tone(Tokens.Course.Light.Tone3.bg, Tokens.Course.Light.Tone3.border, Tokens.Course.Light.Tone3.fg)
    4 -> Tone(Tokens.Course.Light.Tone4.bg, Tokens.Course.Light.Tone4.border, Tokens.Course.Light.Tone4.fg)
    5 -> Tone(Tokens.Course.Light.Tone5.bg, Tokens.Course.Light.Tone5.border, Tokens.Course.Light.Tone5.fg)
    6 -> Tone(Tokens.Course.Light.Tone6.bg, Tokens.Course.Light.Tone6.border, Tokens.Course.Light.Tone6.fg)
    7 -> Tone(Tokens.Course.Light.Tone7.bg, Tokens.Course.Light.Tone7.border, Tokens.Course.Light.Tone7.fg)
    8 -> Tone(Tokens.Course.Light.Tone8.bg, Tokens.Course.Light.Tone8.border, Tokens.Course.Light.Tone8.fg)
    9 -> Tone(Tokens.Course.Light.Tone9.bg, Tokens.Course.Light.Tone9.border, Tokens.Course.Light.Tone9.fg)
    10 -> Tone(Tokens.Course.Light.Tone10.bg, Tokens.Course.Light.Tone10.border, Tokens.Course.Light.Tone10.fg)
    else -> Tone(Tokens.Course.Light.Tone11.bg, Tokens.Course.Light.Tone11.border, Tokens.Course.Light.Tone11.fg)
}
fun darkTone(index: Int) = when (index) {
    0 -> Tone(Tokens.Course.Dark.Tone0.bg, Tokens.Course.Dark.Tone0.border, Tokens.Course.Dark.Tone0.fg)
    1 -> Tone(Tokens.Course.Dark.Tone1.bg, Tokens.Course.Dark.Tone1.border, Tokens.Course.Dark.Tone1.fg)
    2 -> Tone(Tokens.Course.Dark.Tone2.bg, Tokens.Course.Dark.Tone2.border, Tokens.Course.Dark.Tone2.fg)
    3 -> Tone(Tokens.Course.Dark.Tone3.bg, Tokens.Course.Dark.Tone3.border, Tokens.Course.Dark.Tone3.fg)
    4 -> Tone(Tokens.Course.Dark.Tone4.bg, Tokens.Course.Dark.Tone4.border, Tokens.Course.Dark.Tone4.fg)
    5 -> Tone(Tokens.Course.Dark.Tone5.bg, Tokens.Course.Dark.Tone5.border, Tokens.Course.Dark.Tone5.fg)
    6 -> Tone(Tokens.Course.Dark.Tone6.bg, Tokens.Course.Dark.Tone6.border, Tokens.Course.Dark.Tone6.fg)
    7 -> Tone(Tokens.Course.Dark.Tone7.bg, Tokens.Course.Dark.Tone7.border, Tokens.Course.Dark.Tone7.fg)
    8 -> Tone(Tokens.Course.Dark.Tone8.bg, Tokens.Course.Dark.Tone8.border, Tokens.Course.Dark.Tone8.fg)
    9 -> Tone(Tokens.Course.Dark.Tone9.bg, Tokens.Course.Dark.Tone9.border, Tokens.Course.Dark.Tone9.fg)
    10 -> Tone(Tokens.Course.Dark.Tone10.bg, Tokens.Course.Dark.Tone10.border, Tokens.Course.Dark.Tone10.fg)
    else -> Tone(Tokens.Course.Dark.Tone11.bg, Tokens.Course.Dark.Tone11.border, Tokens.Course.Dark.Tone11.fg)
}
@Composable fun tone(index: Int) = if (isSystemInDarkTheme()) darkTone(index) else lightTone(index)
