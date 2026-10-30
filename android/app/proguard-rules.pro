# UniFFI calls exported Rust symbols through JNA reflection. Keep generated ABI names.
-keep class top.hicancan.search.** { *; }
-keep class top.hicancan.wayfind.** { *; }
-keep class com.sun.jna.** { *; }
# JNA's optional desktop window helpers are unreachable on Android.
-dontwarn java.awt.Component
-dontwarn java.awt.GraphicsEnvironment
-dontwarn java.awt.HeadlessException
-dontwarn java.awt.Window
