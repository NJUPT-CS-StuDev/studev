import groovy.json.JsonSlurper
import java.net.URI
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.file.FileSystemOperations
import javax.inject.Inject

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)
    alias(libs.plugins.serialization)
}

val product = JsonSlurper().parse(rootProject.file("../product.json")) as Map<*, *>
val androidProduct = product["android"] as Map<*, *>
val productOrigin = product["origin"] as String

abstract class DesignTokensTask : DefaultTask() {
    @get:InputFile abstract val tokensFile: RegularFileProperty
    @get:OutputDirectory abstract val kotlinDir: DirectoryProperty
    @get:OutputDirectory abstract val resourceDir: DirectoryProperty
    @TaskAction fun generate() {
        val tokens = JsonSlurper().parse(tokensFile.get().asFile) as Map<*, *>
        val source = buildString {
            appendLine("package top.hicancan.studev.ui.theme")
            appendLine("// Generated from design/tokens.json. Do not edit.")
            appendLine("internal object Tokens {")
            fun emit(name: String, values: Map<*, *>) {
                appendLine("object $name {")
                values.forEach { (key, value) ->
                    if (value is Map<*, *>) emit(key.toString().replaceFirstChar { it.uppercase() }, value)
                    else if (value is String && value.startsWith("#")) {
                        val hex = value.drop(1)
                        val argb = if (hex.length == 8) hex.takeLast(2) + hex.take(6) else "ff$hex"
                        appendLine("val $key = androidx.compose.ui.graphics.Color(0x${argb}L)")
                    } else appendLine("const val $key = $value")
                }
                appendLine("}")
            }
            tokens.filterKeys { it != "_" }.forEach { (key, value) ->
                emit(key.toString().replaceFirstChar { it.uppercase() }, value as Map<*, *>)
            }
            appendLine("}")
        }
        kotlinDir.file("top/hicancan/studev/ui/theme/Tokens.kt").get().asFile.apply {
            parentFile.mkdirs(); writeText(source)
        }
        val colors = tokens["color"] as Map<*, *>
        for ((theme, folder) in listOf("light" to "values", "dark" to "values-night")) {
            val palette = colors[theme] as Map<*, *>
            resourceDir.file("$folder/colors.xml").get().asFile.apply {
                parentFile.mkdirs()
                writeText("<resources><color name=\"studev_paper\">${palette["paper"]}</color><color name=\"studev_brand\">${palette["brand"]}</color><color name=\"studev_on_brand\">${palette["onBrand"]}</color></resources>")
            }
        }
    }
}
abstract class CampusDataTask @Inject constructor(private val fs: FileSystemOperations) : DefaultTask() {
    @get:InputDirectory abstract val releases: DirectoryProperty
    @get:InputFile abstract val releaseManifest: RegularFileProperty
    @get:OutputDirectory abstract val assetDir: DirectoryProperty
    @get:Input abstract val bundleAllData: Property<Boolean>
    @TaskAction fun copyPackage() {
        val metadata = JsonSlurper().parse(releaseManifest.get().asFile) as Map<*, *>
        val version = metadata["version"] as String
        check(version.matches(Regex("[A-Za-z0-9._-]+"))) { "Invalid campus release version" }
        val release = releases.get().asFile.resolve(version)
        check(release.resolve("space/仙林").isDirectory) { "Campus package missing. Run npm run digest in the repository root." }
        fs.sync {
            from(release)
            into(assetDir.dir("data"))
            // The map is usable on first launch. Large class, room-day and search
            // shards are fetched by AcademicRepository and retained in files/.
            if (!bundleAllData.get()) {
                include("space/**")
                include("teaching/${metadata["teaching"]}/term.json", "teaching/${metadata["teaching"]}/periods.json",
                    "teaching/${metadata["teaching"]}/classes.json", "rooms/index.json")
                metadata["exams"]?.let { include("exams/$it/index.json") }
            }
        }
        releaseManifest.get().asFile.copyTo(assetDir.file("data/release.json").get().asFile, overwrite = true)
        assetDir.file("data/version.txt").get().asFile.writeText(release.name)
    }
}
abstract class VerifyMapInputsTask : DefaultTask() {
    @get:Internal abstract val mapDir: DirectoryProperty
    @get:Internal abstract val kernelDir: DirectoryProperty
    @TaskAction fun verify() {
        val map = mapDir.get().asFile
        check(map.resolve("fonts").isDirectory && map.resolve("sprites").isDirectory) {
            "Map assets missing. Run node design/map/generate.mjs in the repository root."
        }
        val kernels = kernelDir.get().asFile
        for (abi in listOf("arm64-v8a", "x86_64")) for (kernel in listOf("wasm_search", "wayfind")) {
            check(kernels.resolve("jniLibs/$abi/lib${kernel}_android.so").isFile) {
                "Native kernels missing. Run pwsh ./kernels.ps1 from android/."
            }
        }
        check(kernels.resolve("kotlin").walkTopDown().any { it.extension == "kt" }) {
            "Generated kernel bindings missing. Run pwsh ./kernels.ps1 from android/."
        }
    }
}
val generateDesignTokens = tasks.register<DesignTokensTask>("generateDesignTokens") {
    tokensFile.set(rootProject.layout.projectDirectory.file("../design/tokens.json"))
    kotlinDir.set(layout.buildDirectory.dir("generated/design/kotlin"))
    resourceDir.set(layout.buildDirectory.dir("generated/design/res"))
}
val packageCampusData = tasks.register<CampusDataTask>("packageCampusData") {
    bundleAllData.set(providers.gradleProperty("studev.bundleAllData").map(String::toBoolean).orElse(false))
    releases.set(rootProject.layout.projectDirectory.dir("../public/data"))
    releaseManifest.set(rootProject.layout.projectDirectory.file("../src/data/campus-release.json"))
    assetDir.set(layout.buildDirectory.dir("generated/campus/assets"))
}
val packageAcademicTestFixtures = tasks.register<Sync>("packageAcademicTestFixtures") {
    val manifest = rootProject.layout.projectDirectory.file("../src/data/campus-release.json")
    inputs.file(manifest)
    from(provider {
        val metadata = JsonSlurper().parse(manifest.asFile) as Map<*, *>
        rootProject.file("../public/data/${metadata["version"]}")
    }) {
        include("teaching/*/classes/B240402.json", "exams/*/classes/B240402.json")
    }
    into(layout.buildDirectory.dir("generated/academic-test/data"))
}
val verifyMapInputs = tasks.register<VerifyMapInputsTask>("verifyMapInputs") {
    mapDir.set(layout.projectDirectory.dir("src/main/assets/map"))
    kernelDir.set(rootProject.layout.projectDirectory.dir("kernels"))
}
tasks.named("preBuild") { dependsOn(verifyMapInputs) }
tasks.matching { it.name in setOf("mergeDebugAndroidTestAssets", "lintAnalyzeDebugAndroidTest", "generateDebugAndroidTestLintModel") }
    .configureEach { dependsOn(packageAcademicTestFixtures) }
tasks.matching { it.name.contains("UnitTest") && it.name.contains("JavaRes") }.configureEach { dependsOn(packageCampusData, packageAcademicTestFixtures) }
androidComponents.onVariants { variant ->
    variant.sources.kotlin?.addGeneratedSourceDirectory(generateDesignTokens, DesignTokensTask::kotlinDir)
    variant.sources.res?.addGeneratedSourceDirectory(generateDesignTokens, DesignTokensTask::resourceDir)
    variant.sources.assets?.addGeneratedSourceDirectory(packageCampusData, CampusDataTask::assetDir)
}

android {
    namespace = "top.hicancan.studev"
    compileSdk {
        version = release(37) { minorApiLevel = 0 }
    }
    buildToolsVersion = "36.1.0"

    defaultConfig {
        applicationId = "top.hicancan.studev"
        minSdk = (androidProduct["minSdk"] as Number).toInt()
        targetSdk = 36
        // Production distribution is arm64 only. Debug keeps x86_64 so the
        // emulator remains a first-class development target.
        ndk { abiFilters += listOf("arm64-v8a") }
        buildConfigField("String", "SITE_ORIGIN", "\"$productOrigin\"")
        buildConfigField("String", "CAMPUS_TIME_ZONE", "\"${product["timeZone"]}\"")
        val campus = product["campus"] as Map<*, *>
        val centre = campus["centre"] as List<*>
        buildConfigField("String", "DEFAULT_CAMPUS", "\"${campus["id"]}\"")
        buildConfigField("double", "CAMPUS_LONGITUDE", centre[0].toString())
        buildConfigField("double", "CAMPUS_LATITUDE", centre[1].toString())
        versionCode = (androidProduct["versionCode"] as Number).toInt()
        versionName = androidProduct["versionName"] as String
        manifestPlaceholders["siteHost"] = URI(productOrigin).host
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        create("release") {
            // Signing material stays outside the repository; debug retains Android's default.
            storeFile = providers.gradleProperty("studev.keystore").orNull?.let(::file)
            keyAlias = providers.gradleProperty("studev.keyAlias").orNull
            storePassword = providers.gradleProperty("studev.storePassword").orNull
            keyPassword = providers.gradleProperty("studev.storePassword").orNull
        }
    }

    buildTypes {
        debug {
            ndk { abiFilters += listOf("x86_64") }
            buildConfigField("String", "DATA_HOST", "\"${providers.gradleProperty("studev.dataHost").getOrElse(productOrigin).trimEnd('/')}\"")
        }
        release {
            buildConfigField("String", "DATA_HOST", "\"$productOrigin\"")
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = if (providers.gradleProperty("studev.keystore").isPresent) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    // Target 36 is the product contract; dependency upgrades are reviewed separately.
    lint { disable += setOf("OldTargetApi", "GradleDependency", "NewerVersionAvailable") }
    buildFeatures { compose = true; buildConfig = true }
    androidResources { noCompress += "pmtiles" }
    sourceSets {
        getByName("main") {
            kotlin.directories.add(rootProject.file("kernels/kotlin").absolutePath)
            jniLibs.directories.add(rootProject.file("kernels/jniLibs").absolutePath)
        }
        getByName("test").resources.directories.add(layout.buildDirectory.dir("generated/campus/assets").get().asFile.absolutePath)
        getByName("test").resources.directories.add(layout.buildDirectory.dir("generated/academic-test").get().asFile.absolutePath)
        getByName("androidTest").assets.directories.add(layout.buildDirectory.dir("generated/academic-test").get().asFile.absolutePath)
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

dependencies {
    implementation(libs.androidx.core)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.maplibre)
    implementation(libs.androidx.viewmodel.compose)
    implementation(libs.serialization.json)
    implementation(libs.navigation.compose)
    implementation(libs.datastore.preferences)
    implementation(libs.material.icons)
    implementation(libs.jna) { artifact { type = "aar" } }
    implementation(libs.work.runtime)
    implementation(libs.glance.appwidget)
    implementation(libs.glance.material3)
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.ui.test)
    debugImplementation(libs.compose.ui.test.manifest)
    debugImplementation(libs.compose.ui.tooling)
}
