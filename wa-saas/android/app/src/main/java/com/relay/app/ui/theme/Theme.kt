package com.relay.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Status colours used by pills and the evidence ladder. */
@Immutable data class StatusColors(
    val queued: Color, val submitted: Color, val delivered: Color, val read: Color,
    val failed: Color, val unknown: Color, val skipped: Color,
    val goodSoft: Color, val warnSoft: Color, val badSoft: Color, val line: Color, val muted: Color,
)

private val LightStatus = StatusColors(
    queued = Color(0xFFC9CFCA), submitted = Color(0xFF5470A8), delivered = Color(0xFF0F6B55), read = Color(0xFF4B5BD6),
    failed = Color(0xFFB4412F), unknown = Color(0xFFB07C10), skipped = Color(0xFFDDE1DC),
    goodSoft = Color(0xFFE2F0EB), warnSoft = Color(0xFFFBF0D9), badSoft = Color(0xFFF8E3DF), line = Color(0xFFDDE1DC), muted = Color(0xFF7B8781),
)
private val DarkStatus = StatusColors(
    queued = Color(0xFF3A4741), submitted = Color(0xFF86A0D4), delivered = Color(0xFF3FAE8D), read = Color(0xFF8792F0),
    failed = Color(0xFFE27460), unknown = Color(0xFFD9A63C), skipped = Color(0xFF2E3A34),
    goodSoft = Color(0xFF1D3A31), warnSoft = Color(0xFF3B2F17), badSoft = Color(0xFF3D221D), line = Color(0xFF2E3A34), muted = Color(0xFF85918B),
)

val LocalStatusColors = staticCompositionLocalOf { LightStatus }

private val Light = lightColorScheme(
    primary = Color(0xFF0F6B55), onPrimary = Color.White, primaryContainer = Color(0xFFE2F0EB), onPrimaryContainer = Color(0xFF0B4D3D),
    secondary = Color(0xFFD99A1E), onSecondary = Color(0xFF1D2924),
    background = Color(0xFFF5F6F3), onBackground = Color(0xFF1D2924),
    surface = Color(0xFFFFFFFF), onSurface = Color(0xFF1D2924), surfaceVariant = Color(0xFFEEF0EC), onSurfaceVariant = Color(0xFF4C5953),
    surfaceContainer = Color(0xFFFFFFFF), surfaceContainerLow = Color(0xFFFFFFFF), surfaceContainerHigh = Color(0xFFEEF0EC),
    outline = Color(0xFFC3C9C4), outlineVariant = Color(0xFFDDE1DC), error = Color(0xFFB4412F), errorContainer = Color(0xFFF8E3DF),
)
private val Dark = darkColorScheme(
    primary = Color(0xFF3FAE8D), onPrimary = Color(0xFF0C1612), primaryContainer = Color(0xFF1D3A31), onPrimaryContainer = Color(0xFFBFE6D8),
    secondary = Color(0xFFE8B14A), onSecondary = Color(0xFF1A1405),
    background = Color(0xFF121815), onBackground = Color(0xFFE6EBE8),
    surface = Color(0xFF1A221E), onSurface = Color(0xFFE6EBE8), surfaceVariant = Color(0xFF222C27), onSurfaceVariant = Color(0xFFB2BDB7),
    surfaceContainer = Color(0xFF1A221E), surfaceContainerLow = Color(0xFF1A221E), surfaceContainerHigh = Color(0xFF222C27),
    outline = Color(0xFF3A4741), outlineVariant = Color(0xFF2E3A34), error = Color(0xFFE27460), errorContainer = Color(0xFF3D221D),
)

private val base = TextStyle(fontFamily = FontFamily.SansSerif, fontFeatureSettings = "tnum")
private val RelayType = Typography(
    headlineMedium = base.copy(fontSize = 26.sp, lineHeight = 32.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.3).sp),
    headlineSmall = base.copy(fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.Bold),
    titleLarge = base.copy(fontSize = 19.sp, lineHeight = 25.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = base.copy(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold),
    titleSmall = base.copy(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = base.copy(fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = base.copy(fontSize = 14.sp, lineHeight = 21.sp),
    bodySmall = base.copy(fontSize = 12.5.sp, lineHeight = 18.sp),
    labelLarge = base.copy(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold),
    labelMedium = base.copy(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.SemiBold),
    displaySmall = base.copy(fontSize = 30.sp, lineHeight = 36.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp),
)

@Composable
fun RelayTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    androidx.compose.runtime.CompositionLocalProvider(LocalStatusColors provides if (dark) DarkStatus else LightStatus) {
        MaterialTheme(
            colorScheme = if (dark) Dark else Light,
            typography = RelayType,
            shapes = Shapes(small = RoundedCornerShape(6.dp), medium = RoundedCornerShape(10.dp), large = RoundedCornerShape(14.dp)),
            content = content,
        )
    }
}
