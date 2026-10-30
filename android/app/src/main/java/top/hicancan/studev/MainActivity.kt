package top.hicancan.studev

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import top.hicancan.studev.map.CampusMapScreen
import top.hicancan.studev.ui.theme.StuDevTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            StuDevTheme { CampusMapScreen() }
        }
    }
}
