package top.hicancan.studev.navigation

/** Canonical IDs stay in the map package; the campus prefix is not user text. */
fun visibleRouteText(text: String): String = text.replace("仙林/", "")
