package top.hicancan.studev.search

import org.junit.Assert.assertEquals
import org.junit.Test

class SearchHighlightTest {
    @Test fun prefersTheFullChineseQueryAndDoesNotOverlapShorterTerms() {
        assertEquals(listOf(0 until 3), searchHighlightRanges("奖学金推荐", listOf("奖学", "学金", "奖学金")))
    }

    @Test fun highlightsRepeatedTermsAndIgnoresOneCharacterNoise() {
        assertEquals(listOf(0 until 2, 2 until 4), searchHighlightRanges("校园校园", listOf("校", "校园")))
    }
}
