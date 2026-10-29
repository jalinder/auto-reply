package com.relay.app.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.relay.app.core.data.StepUpCoordinator
import com.relay.app.core.network.PasswordBody
import com.relay.app.core.network.RelayApi
import com.relay.app.core.network.apiCall
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class StepUpViewModel @Inject constructor(val coordinator: StepUpCoordinator, private val api: RelayApi) : ViewModel() {
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set

    fun confirm(password: String) = viewModelScope.launch {
        busy = true; error = null
        apiCall { api.stepUp(PasswordBody(password)) }
            .onSuccess { coordinator.resolve(it.stepUpToken) }
            .onFailure { error = it.message }
        busy = false
    }
    fun cancel() { error = null; coordinator.resolve(null) }
}

/** Global "confirm it's you" password sheet for sensitive actions. */
@Composable
fun StepUpHost(vm: StepUpViewModel = hiltViewModel()) {
    val pending by vm.coordinator.pending.collectAsStateWithLifecycle()
    if (pending == null) return
    var pw by remember(pending) { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = vm::cancel,
        title = { Text("Confirm it’s you") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("This action is sensitive. Enter your password to continue.")
                FormField(pw, { pw = it }, "Password", password = true, error = vm.error)
            }
        },
        confirmButton = { TextButton(onClick = { vm.confirm(pw) }, enabled = pw.isNotEmpty() && !vm.busy) { Text(if (vm.busy) "Checking…" else "Confirm") } },
        dismissButton = { TextButton(onClick = vm::cancel) { Text("Cancel") } },
    )
}
