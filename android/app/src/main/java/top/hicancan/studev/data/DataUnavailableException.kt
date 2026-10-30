package top.hicancan.studev.data

import java.io.FileNotFoundException

/** Missing downloads never erase the bundled map or another release's cache. */
class DataUnavailableException(cause: Exception) : FileNotFoundException(
    "这份数据尚未下载，或新版本还未发布。校园地图可离线使用，请联网后重试。"
) {
    init { initCause(cause) }
}
