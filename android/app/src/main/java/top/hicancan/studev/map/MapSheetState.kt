package top.hicancan.studev.map

internal enum class MapSheetState { Collapsed, Half, Full }

internal fun sheetHeight(state: MapSheetState, viewport: Float, safeBottom: Float = 0f): Float {
    val available = (viewport - safeBottom).coerceAtLeast(320f)
    val collapsed = (available * .14f).coerceIn(72f, 112f)
    val half = (available * .52f).coerceIn(collapsed + 48f, available * .78f)
    return when (state) {
        MapSheetState.Collapsed -> collapsed
        MapSheetState.Half -> half
        MapSheetState.Full -> maxOf(half + 24f, minOf(available - 12f, maxOf(half + 24f, available * .88f)))
    }
}

/** `deltaY` is negative when the finger moves upward. */
internal fun snapSheet(current: MapSheetState, deltaY: Float, velocityY: Float): MapSheetState {
    val fast = kotlin.math.abs(velocityY) > 650f
    val direction = when {
        fast -> if (velocityY < 0) 1 else -1
        kotlin.math.abs(deltaY) >= 48f -> if (deltaY < 0) 1 else -1
        else -> 0
    }
    return MapSheetState.entries[(current.ordinal + direction).coerceIn(0, MapSheetState.entries.lastIndex)]
}

