package top.hicancan.studev.baselineprofile

import androidx.benchmark.macro.junit4.BaselineProfileRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Start the app, then open each tab once: what a student does first is what is compiled ahead of time. */
@RunWith(AndroidJUnit4::class)
class StartupProfile {
    @get:Rule val rule = BaselineProfileRule()

    @Test
    fun generate() = rule.collect(packageName = "top.hicancan.studev", includeInStartupProfile = true) {
        pressHome()
        startActivityAndWait()
        for (tab in listOf("地图", "知识", "搜索", "课表")) {
            device.wait(Until.findObject(By.text(tab)), 5_000)?.click()
            device.waitForIdle()
        }
    }
}
