package top.hicancan.studev.baselineprofile

import androidx.benchmark.macro.BaselineProfileMode
import androidx.benchmark.macro.CompilationMode
import androidx.benchmark.macro.StartupMode
import androidx.benchmark.macro.StartupTimingMetric
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Cold start with nothing compiled ahead of time against cold start with the baseline profile. */
@RunWith(AndroidJUnit4::class)
class StartupBenchmark {
    @get:Rule val rule = MacrobenchmarkRule()

    @Test fun withoutProfile() = start(CompilationMode.None())
    @Test fun withProfile() = start(CompilationMode.Partial(BaselineProfileMode.Require))

    private fun start(mode: CompilationMode) = rule.measureRepeated(
        packageName = "top.hicancan.studev", metrics = listOf(StartupTimingMetric()), compilationMode = mode,
        startupMode = StartupMode.COLD, iterations = 10,
    ) {
        pressHome()
        startActivityAndWait()
    }
}
