package top.hicancan.studev.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LightColors = lightColorScheme(
    primary = Color(0xFF216451),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFC4ECDD),
    onPrimaryContainer = Color(0xFF092F25),
    secondary = Color(0xFF53675E),
    background = Color(0xFFF3F6EF),
    surface = Color(0xFFFAFCF7),
    onSurface = Color(0xFF18231E),
    onSurfaceVariant = Color(0xFF526159),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF96D5BA),
    onPrimary = Color(0xFF00382A),
    primaryContainer = Color(0xFF18513F),
    onPrimaryContainer = Color(0xFFC4ECDD),
    secondary = Color(0xFFB3CCC0),
    background = Color(0xFF182522),
    surface = Color(0xFF1E2E28),
    onSurface = Color(0xFFE0EAE2),
    onSurfaceVariant = Color(0xFFB4C7BC),
)

@Composable
fun StuDevTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
        typography = Typography(),
        content = content,
    )
}
