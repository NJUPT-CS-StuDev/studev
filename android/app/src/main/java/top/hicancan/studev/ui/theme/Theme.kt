package top.hicancan.studev.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val light = Tokens.Color.Light
private val dark = Tokens.Color.Dark
internal val LightColors = lightColorScheme(
    primary = light.brand, onPrimary = light.onBrand,
    primaryContainer = light.brandContainer, onPrimaryContainer = light.onBrandContainer,
    secondary = light.muted, onSecondary = light.paper,
    secondaryContainer = light.surfaceSunken, onSecondaryContainer = light.ink,
    tertiary = light.success, onTertiary = light.paper,
    tertiaryContainer = light.brandContainer, onTertiaryContainer = light.onBrandContainer,
    background = light.paper, onBackground = light.ink,
    surface = light.paper, onSurface = light.ink, surfaceVariant = light.surfaceSunken,
    onSurfaceVariant = light.muted, surfaceTint = light.brand,
    surfaceBright = light.surfaceRaised, surfaceDim = light.surfaceSunken,
    surfaceContainerLowest = light.paper, surfaceContainerLow = light.surface,
    surfaceContainer = light.surface, surfaceContainerHigh = light.surfaceRaised,
    surfaceContainerHighest = light.surfaceSunken,
    outline = light.faint, outlineVariant = light.line,
    error = light.danger, onError = light.paper,
    errorContainer = light.surfaceSunken, onErrorContainer = light.danger,
    inverseSurface = dark.paper, inverseOnSurface = dark.ink, inversePrimary = dark.brand,
    scrim = light.scrim,
)
internal val DarkColors = darkColorScheme(
    primary = dark.brand, onPrimary = dark.onBrand,
    primaryContainer = dark.brandContainer, onPrimaryContainer = dark.onBrandContainer,
    secondary = dark.muted, onSecondary = dark.paper,
    secondaryContainer = dark.surfaceSunken, onSecondaryContainer = dark.ink,
    tertiary = dark.success, onTertiary = dark.paper,
    tertiaryContainer = dark.brandContainer, onTertiaryContainer = dark.onBrandContainer,
    background = dark.paper, onBackground = dark.ink,
    surface = dark.paper, onSurface = dark.ink, surfaceVariant = dark.surfaceRaised,
    onSurfaceVariant = dark.muted, surfaceTint = dark.brand,
    surfaceBright = dark.surfaceRaised, surfaceDim = dark.surfaceSunken,
    surfaceContainerLowest = dark.surfaceSunken, surfaceContainerLow = dark.surface,
    surfaceContainer = dark.surface, surfaceContainerHigh = dark.surfaceRaised,
    surfaceContainerHighest = dark.surfaceRaised,
    outline = dark.faint, outlineVariant = dark.line,
    error = dark.danger, onError = dark.paper,
    errorContainer = dark.surfaceSunken, onErrorContainer = dark.danger,
    inverseSurface = light.paper, inverseOnSurface = light.ink, inversePrimary = light.brand,
    scrim = dark.scrim,
)
private fun type(size: Int, line: Int, weight: Int) = TextStyle(
    fontFamily = FontFamily.Default, fontSize = size.sp, lineHeight = line.sp, fontWeight = FontWeight(weight),
)
private val display = Tokens.Type.Display.let { type(it.size, it.line, it.weight) }
private val title = Tokens.Type.Title.let { type(it.size, it.line, it.weight) }
private val heading = Tokens.Type.Heading.let { type(it.size, it.line, it.weight) }
private val body = Tokens.Type.Body.let { type(it.size, it.line, it.weight) }
private val label = Tokens.Type.Label.let { type(it.size, it.line, it.weight) }
private val caption = Tokens.Type.Caption.let { type(it.size, it.line, it.weight) }
private val typography = Typography(
    displayLarge = display, displayMedium = display, displaySmall = display,
    headlineLarge = display, headlineMedium = title, headlineSmall = title,
    titleLarge = title, titleMedium = heading, titleSmall = heading,
    bodyLarge = body, bodyMedium = body, bodySmall = caption,
    labelLarge = label, labelMedium = label, labelSmall = caption,
)
private val shapes = Shapes(
    extraSmall = RoundedCornerShape(Tokens.Radius.control.dp),
    small = RoundedCornerShape(Tokens.Radius.control.dp),
    medium = RoundedCornerShape(Tokens.Radius.card.dp),
    large = RoundedCornerShape(Tokens.Radius.sheet.dp),
    extraLarge = RoundedCornerShape(Tokens.Radius.sheet.dp),
)
@Composable
fun StuDevTheme(content: @Composable () -> Unit) {
    val colors = if (isSystemInDarkTheme()) DarkColors else LightColors
    MaterialTheme(colorScheme = colors, typography = typography, shapes = shapes) {
        CompositionLocalProvider(LocalContentColor provides colors.onSurface, content = content)
    }
}
