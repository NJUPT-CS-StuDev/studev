package top.hicancan.studev

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import top.hicancan.studev.map.MapSheetState
import top.hicancan.studev.map.sheetHeight
import top.hicancan.studev.map.snapSheet

class MapSheetStateTest {
    @Test fun heightsAreOrderedAndSafe() {
        assertTrue(sheetHeight(MapSheetState.Collapsed, 844f) < sheetHeight(MapSheetState.Half, 844f))
        assertTrue(sheetHeight(MapSheetState.Half, 844f) < sheetHeight(MapSheetState.Full, 844f))
        assertTrue(sheetHeight(MapSheetState.Full, 844f, 34f) <= 798f)
    }

    @Test fun compactViewportStillHasOrderedAnchors() {
        assertTrue(sheetHeight(MapSheetState.Collapsed, 320f) < sheetHeight(MapSheetState.Half, 320f))
        assertTrue(sheetHeight(MapSheetState.Half, 320f) < sheetHeight(MapSheetState.Full, 320f))
        assertTrue(sheetHeight(MapSheetState.Full, 320f) <= 320f)
    }

    @Test fun releaseUsesVelocityAndClamps() {
        assertEquals(MapSheetState.Full, snapSheet(MapSheetState.Half, -140f, 0f))
        assertEquals(MapSheetState.Collapsed, snapSheet(MapSheetState.Half, 140f, 0f))
        assertEquals(MapSheetState.Full, snapSheet(MapSheetState.Half, 0f, -900f))
        assertEquals(MapSheetState.Collapsed, snapSheet(MapSheetState.Half, 0f, 900f))
        assertEquals(MapSheetState.Collapsed, snapSheet(MapSheetState.Collapsed, 140f, 900f))
        assertEquals(MapSheetState.Full, snapSheet(MapSheetState.Full, -140f, -900f))
    }
}

