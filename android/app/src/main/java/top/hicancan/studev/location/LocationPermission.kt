package top.hicancan.studev.location

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import top.hicancan.studev.R

data class LocationAccess(val granted: Boolean, val precise: Boolean)

private fun Context.locationAccess() = LocationAccess(
    granted = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED,
    precise = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED,
)

private tailrec fun Context.activity(): Activity = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.activity()
    else -> error("Location permission requires an Activity")
}

/** Keeps the map usable after denial, approximate grants, and returning from Settings. */
@Composable
fun rememberLocationPermission(onGranted: () -> Unit): Pair<LocationAccess, () -> Unit> {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var access by remember { mutableStateOf(context.locationAccess()) }
    var asked by rememberSaveable { mutableStateOf(false) }
    var rationale by rememberSaveable { mutableStateOf(false) }
    val grantedCallback by rememberUpdatedState(onGranted)
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        access = context.locationAccess()
        if (access.granted) grantedCallback() else rationale = true
    }
    DisposableEffect(lifecycle, context) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) access = context.locationAccess()
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    val permanentlyDenied = asked && !access.granted &&
        !ActivityCompat.shouldShowRequestPermissionRationale(context.activity(), Manifest.permission.ACCESS_COARSE_LOCATION)
    if (rationale) {
        AlertDialog(
            onDismissRequest = { rationale = false },
            title = { Text(stringResource(R.string.location_title)) },
            text = { Text(stringResource(if (permanentlyDenied) R.string.location_settings_rationale else R.string.location_rationale)) },
            confirmButton = {
                TextButton(onClick = {
                    rationale = false
                    if (permanentlyDenied) {
                        context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, "package:${context.packageName}".toUri()))
                    } else {
                        asked = true
                        launcher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                    }
                }) { Text(stringResource(if (permanentlyDenied) R.string.open_settings else R.string.continue_label)) }
            },
            dismissButton = {
                TextButton(onClick = { rationale = false }) { Text(stringResource(R.string.not_now)) }
            },
        )
    }
    return access to { if (access.granted) grantedCallback() else rationale = true }
}
