package top.hicancan.studev.ai

/**
 * What the AI keeps in mind about the person asking, as src/campus/ai/memory.ts: plain lines kept on this device, shown
 * and changed in “记忆”, turned off there too (then nothing is sent and nothing is kept).
 */
data class Memory(val on: Boolean = true, val text: String = "") {
    companion object {
        /** As long as it may grow; past this the AI is told to make room. */
        const val LIMIT = 4000
        private fun plain(line: String) = line.replace(Regex("^[-*•]\\s*"), "").replace(Regex("[ \\t\\n\\r\u3000，。,.！!？?；;：:“”\"']"), "").lowercase()

        /** The memory with one more thing in it, as a line of its own; the same thing again changes nothing. */
        fun remembered(text: String, fact: String): String {
            val said = fact.replace(Regex("[ \\t\\n\\r\u3000]+"), " ").trim()
            require(said.isNotEmpty()) { "要记住的话是空的。" }
            val lines = text.split("\n").map { it.trimEnd() }.filter { it.isNotEmpty() }
            if (lines.any { plain(it) == plain(said) }) return lines.joinToString("\n")
            val next = (lines + "- $said").joinToString("\n")
            require(next.length <= LIMIT) { "记忆已经满了，请对方在“记忆”里删掉一些再记。" }
            return next
        }
        fun read(prefs: android.content.SharedPreferences) = Memory(prefs.getBoolean("on", true), prefs.getString("text", null).orEmpty())
        fun write(prefs: android.content.SharedPreferences, memory: Memory) = prefs.edit().putBoolean("on", memory.on).putString("text", memory.text).apply()
    }
}
