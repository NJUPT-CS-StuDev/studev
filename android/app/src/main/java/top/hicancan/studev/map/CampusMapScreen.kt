package top.hicancan.studev.map

import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import top.hicancan.studev.R
import top.hicancan.studev.location.LocationStatus
import top.hicancan.studev.location.rememberLocationPermission

@Composable
fun CampusMapScreen() {
    val context = LocalContext.current
    val controller = remember { CampusMapController() }
    val (access, requestLocation) = rememberLocationPermission { controller.recenter() }
    var status by remember { mutableStateOf(LocationStatus.Waiting) }
    var mapError by remember { mutableStateOf(false) }

    Box(Modifier.fillMaxSize()) {
        CampusMap(
            controller = controller,
            dark = isSystemInDarkTheme(),
            locationGranted = access.granted,
            onLocationStatus = { status = it },
            onMapError = { mapError = it },
            modifier = Modifier.fillMaxSize(),
        )
        Box(Modifier.fillMaxSize().safeDrawingPadding().padding(16.dp)) {
            Surface(
                modifier = Modifier.align(Alignment.TopCenter).fillMaxWidth(),
                shape = RoundedCornerShape(24.dp),
                tonalElevation = 3.dp,
                shadowElevation = 3.dp,
            ) {
                Row(
                    Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("StuDev", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        Text(stringResource(R.string.campus_name), style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = RoundedCornerShape(12.dp)) {
                        Text(stringResource(R.string.offline_map), Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                            style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
                    }
                }
            }

            Column(
                modifier = Modifier.align(Alignment.BottomEnd).padding(bottom = 72.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                horizontalAlignment = Alignment.End,
            ) {
                Surface(shape = RoundedCornerShape(18.dp), tonalElevation = 3.dp, shadowElevation = 2.dp) {
                    Column {
                        val zoomIn = stringResource(R.string.zoom_in)
                        val zoomOut = stringResource(R.string.zoom_out)
                        IconButton(onClick = controller::zoomIn, modifier = Modifier.size(48.dp).semantics { contentDescription = zoomIn }) {
                            Text("+", style = MaterialTheme.typography.headlineSmall)
                        }
                        HorizontalDivider(Modifier.size(width = 32.dp, height = 1.dp).align(Alignment.CenterHorizontally))
                        IconButton(onClick = controller::zoomOut, modifier = Modifier.size(48.dp).semantics { contentDescription = zoomOut }) {
                            Text("−", style = MaterialTheme.typography.headlineSmall)
                        }
                    }
                }
                val locate = stringResource(R.string.my_location)
                FloatingActionButton(
                    onClick = {
                        if (access.granted && status == LocationStatus.Disabled) {
                            context.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
                        } else requestLocation()
                    },
                    modifier = Modifier.semantics { contentDescription = locate },
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ) {
                    val color = MaterialTheme.colorScheme.onPrimary
                    Canvas(Modifier.size(24.dp)) {
                        drawCircle(color, size.minDimension * 0.31f, style = Stroke(2.dp.toPx()))
                        drawCircle(color, size.minDimension * 0.12f)
                        val center = size.minDimension / 2
                        drawLine(color, Offset(center, 0f), Offset(center, center * 0.43f), 2.dp.toPx())
                        drawLine(color, Offset(center, size.height), Offset(center, center * 1.57f), 2.dp.toPx())
                        drawLine(color, Offset(0f, center), Offset(center * 0.43f, center), 2.dp.toPx())
                        drawLine(color, Offset(size.width, center), Offset(center * 1.57f, center), 2.dp.toPx())
                    }
                }
            }

            Surface(
                modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth(),
                shape = RoundedCornerShape(18.dp), tonalElevation = 3.dp,
            ) {
                Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (access.granted && status == LocationStatus.Waiting) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    }
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(when {
                            mapError -> R.string.map_error
                            !access.granted -> R.string.location_hint
                            status == LocationStatus.Disabled -> R.string.location_disabled
                            status == LocationStatus.Unavailable -> R.string.location_unavailable
                            status == LocationStatus.Waiting -> R.string.location_waiting
                            !access.precise -> R.string.location_approximate
                            else -> R.string.location_ready
                        }), style = MaterialTheme.typography.bodySmall)
                        Text(stringResource(R.string.map_credit), style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (access.granted && status == LocationStatus.Disabled) {
                        TextButton(onClick = { context.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)) }) {
                            Text(stringResource(R.string.enable_label))
                        }
                    }
                }
            }
        }
    }
}
