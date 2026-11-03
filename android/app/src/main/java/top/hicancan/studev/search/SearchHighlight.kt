package top.hicancan.studev.search

import java.util.Locale

/** Returns non-overlapping ranges using the same longest-term rule as the web card. */
internal fun searchHighlightRanges(text: String, terms: List<String>): List<IntRange> {
    val lowerText = text.lowercase(Locale.ROOT)
    val selected = mutableListOf<IntRange>()
    for (term in terms.asSequence().filter { it.length >= 2 }.distinct().sortedByDescending { it.length }) {
        val needle = term.lowercase(Locale.ROOT)
        var start = lowerText.indexOf(needle)
        while (start >= 0) {
            val range = start until (start + term.length)
            if (selected.none { range.first < it.last + 1 && range.last + 1 > it.first }) selected += range
            start = lowerText.indexOf(needle, start + 1)
        }
    }
    return selected.sortedBy { it.first }
}
