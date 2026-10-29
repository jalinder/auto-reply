package com.relay.app.feature.messages

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavHostController
import com.relay.app.core.data.Fmt
import com.relay.app.core.data.Labels
import com.relay.app.core.data.Uploader
import com.relay.app.core.network.*
import com.relay.app.ui.components.*
import com.relay.app.ui.navigation.BackTopBar
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

private val ATTACHABLE = arrayOf("image/jpeg", "image/png", "image/webp", "application/pdf", "video/mp4")

@HiltViewModel
class QuickSendViewModel @Inject constructor(private val api: RelayApi, private val uploader: Uploader) : ViewModel() {
    var ready by mutableStateOf(false); private set
    var connections by mutableStateOf<List<Connection>>(emptyList()); private set
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    var uploadPct by mutableStateOf<Int?>(null); private set
    var sent by mutableStateOf<DirectMessage?>(null); private set

    var phone by mutableStateOf("")
    var text by mutableStateOf("")
    var connectionId by mutableStateOf("")
    var media by mutableStateOf<MediaAsset?>(null)

    init {
        viewModelScope.launch {
            apiCall { api.connections().items.filter { it.status == "connected" } }
                .onSuccess { connections = it; connectionId = it.firstOrNull()?.id.orEmpty() }
                .onFailure { error = it.message }
            ready = true
        }
    }

    val connection get() = connections.firstOrNull { it.id == connectionId }
    val canAttach get() = connection?.capabilities?.media?.isNotEmpty() == true
    val valid get() = phone.count { it.isDigit() } >= 8 && connectionId.isNotBlank() && (text.isNotBlank() || media != null)

    fun attach(uri: Uri) = viewModelScope.launch {
        uploadPct = 0; error = null
        apiCall { uploader.upload(uri, "campaign") { uploadPct = it } }.onSuccess { media = it }.onFailure { error = it.message }
        uploadPct = null
    }

    fun send() = viewModelScope.launch {
        busy = true; error = null
        // A fresh key per attempt; replaying it after a timeout returns the same message, never a second send.
        val key = UUID.randomUUID().toString().replace("-", "")
        val body = SendMessageBody(
            to = phone.trim(), text = text.trim().ifBlank { null }, mediaId = media?.id, connectionId = connectionId,
        )
        apiCall { api.sendMessage(key, body) }.onSuccess { sent = it; track(it.id) }.onFailure { error = it.message }
        busy = false
    }

    /** Polls until WhatsApp gives us evidence, or we run out of patience and leave it on the last state. */
    private fun track(id: String) = viewModelScope.launch {
        repeat(30) {
            delay(2000)
            val m = apiCall { api.message(id) }.getOrNull() ?: return@repeat
            sent = m
            if (m.settled) return@launch
        }
    }

    fun again() { sent = null; text = ""; media = null; error = null }
}

@Composable
fun QuickSendScreen(nav: NavHostController, vm: QuickSendViewModel = hiltViewModel()) {
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let(vm::attach) }
    Scaffold(topBar = { BackTopBar("Send a message", nav) }) { pad ->
        if (!vm.ready) { LoadingBox(Modifier.padding(pad)); return@Scaffold }
        Column(
            Modifier.padding(pad).imePadding().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val msg = vm.sent
            if (msg != null) { SentPanel(msg, vm::again); return@Column }

            ErrorText(vm.error)
            if (vm.connections.isEmpty()) {
                Callout("No number is connected right now. Link one before sending.") {
                    TextButton(onClick = { nav.navigate("connections") }) { Text("Connect a number") }
                }
                return@Column
            }

            if (vm.connections.size > 1) {
                Panel {
                    Text("Send from", style = MaterialTheme.typography.titleMedium)
                    vm.connections.forEach { c ->
                        ChoiceCard(c.label, c.maskedAccount ?: Labels.connector[c.connectorType], vm.connectionId == c.id, { vm.connectionId = c.id })
                    }
                }
            } else {
                MetaText("Sending from ${vm.connection?.label.orEmpty()}${vm.connection?.maskedAccount?.let { " · $it" }.orEmpty()}")
            }

            Panel {
                Text("To", style = MaterialTheme.typography.titleMedium)
                FormField(
                    vm.phone, { vm.phone = it }, "Phone number", keyboard = KeyboardType.Phone,
                    hint = "With country code, e.g. +91 98765 43210. Indian numbers work without it.",
                )
                MetaText("They are added to your contacts so the delivery history stays in one place.")
            }

            Panel {
                Text("Message", style = MaterialTheme.typography.titleMedium)
                OutlinedTextField(
                    vm.text, { if (it.length <= 4096) vm.text = it }, label = { Text("Text") }, minLines = 4,
                    shape = MaterialTheme.shapes.small, modifier = Modifier.fillMaxWidth(),
                    supportingText = { Text("${vm.text.length} / 4096") },
                )
                if (vm.canAttach) {
                    val m = vm.media
                    if (m != null) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("📎 ${m.fileName}", Modifier.weight(1f))
                            TextButton(onClick = { vm.media = null }) { Text("Remove") }
                        }
                    } else {
                        OutlinedButton(onClick = { picker.launch(ATTACHABLE) }, enabled = vm.uploadPct == null) {
                            Text(vm.uploadPct?.let { "Uploading $it%…" } ?: "Attach image, PDF or video")
                        }
                    }
                    MetaText("A file can go on its own, or with the text above as its caption.")
                }
            }

            BusyButton("Send now", vm::send, Modifier.fillMaxWidth(), busy = vm.busy, enabled = vm.valid && vm.uploadPct == null)
            MetaText("Messages are paced to protect the linked number, so this can take a few seconds.")
        }
    }
}

@Composable
private fun SentPanel(m: DirectMessage, onAgain: () -> Unit) {
    val label = Labels.of(Labels.recipient, m.status)
    Panel {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(m.to, style = MaterialTheme.typography.titleSmall)
                MetaText(Fmt.dateTime(m.createdAt))
            }
            StatusPill(label)
        }
        m.text?.let { MessageBubble(it) }
        m.mediaId?.let { MessageBubble("📎 Attached file") }
        MetaText(label.help)
        m.lastErrorCode?.let { Callout("Reason: $it", CalloutKind.Bad) }
        if (!m.settled) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                MetaText("Watching for delivery…")
            }
        }
    }
    SecondaryButton("Send another", onAgain, Modifier.fillMaxWidth())
}
