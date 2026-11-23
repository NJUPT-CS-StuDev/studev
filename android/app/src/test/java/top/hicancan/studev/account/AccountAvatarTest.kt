package top.hicancan.studev.account

import org.junit.Assert.assertEquals
import org.junit.Test

class AccountAvatarTest {
    @Test fun avatarFallbackPreservesSupplementaryCharacters() {
        assertEquals("𠮷", avatarLetter("𠮷同学"))
        assertEquals("🦆", avatarLetter("🦆同学"))
        assertEquals("🧑‍💻", avatarLetter("🧑‍💻同学"))
        assertEquals("é", avatarLetter("é同学"))
        assertEquals("灿", avatarLetter("灿"))
        assertEquals("我", avatarLetter(""))
    }
}
