package com.relay.app.feature.connections

import android.app.Activity
import android.view.WindowManager
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavHostController
import com.relay.app.core.data.*
import com.relay.app.core.network.*
import com.relay.app.core.realtime.EventStream
import com.relay.app.core.session.SessionManager
import com.relay.app.ui.components.*
import com.relay.app.ui.navigation.BackTopBar
import com.relay.app.ui.navigation.LocalToast
import com.relay.app.ui.navigation.TabTopBar
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.UUID
import javax.inject.Inject

// ---------------- List + add ----------------

@HiltViewModel
class ConnectionsViewModel @Inject constructor(private val api: RelayApi, events: EventStream, val session: SessionManager) :
    LoadViewModel<List<Connection>>(events, "connection") {
    var types by mutableStateOf<List<String>>(emptyList()); private set
    var createError by mutableStateOf<String?>(null); private set
    private var idempotencyKey = "and-" + UUID.randomUUID()

    init {
        load()
        viewModelScope.launch { apiCall { api.connectorTypes() }.onSuccess { types = it.items.map { t -> t.type } } }
    }
    override suspend fun fetch() = api.connections().items

    fun canAdmin() = roleRank(session.currentMembership()?.role) >= 3

    fun create(type: String, label: String, onCreated: (Connection) -> Unit) {
        createError = null
        act("create", onError = { createError = it }) {
            val c = api.createConnection(idempotencyKey, CreateConnectionBody(type, label.ifBlank { Labels.connector[type] ?: "WhatsApp" }))
            idempotencyKey = "and-" + UUID.randomUUID()
            onCreated(c)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConnectionsScreen(nav: NavHostController, vm: ConnectionsViewModel = hiltViewModel()) {
    var adding by remember { mutableStateOf(false) }
    val list = vm.data
    Scaffold(
        topBar = { TabTopBar("WhatsApp numbers") },
        floatingActionButton = { if (vm.canAdmin()) ExtendedFloatingActionButton(onClick = { adding = true }, text = { Text("Connect a number") }, icon = {}) },
    ) { pad ->
        PullToRefreshBox(isRefreshing = vm.refreshing && list != null, onRefresh = { vm.load() }, modifier = Modifier.padding(pad)) {
            when {
                list == null && vm.error != null -> EmptyState("Couldn’t load", vm.error!!) { Button(onClick = { vm.load() }) { Text("Try again") } }
                list == null -> LoadingBox()
                list.isEmpty() -> EmptyState("No numbers connected", "Connect your WhatsApp Business number to start sending campaigns.")
                else -> LazyColumn(contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(list, key = { it.id }) { c ->
                        Panel(Modifier.clickable { nav.navigate("connection/${c.id}") }) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    Text(c.label, style = MaterialTheme.typography.titleSmall)
                                    MetaText("${Labels.connector[c.connectorType]} · ${c.maskedAccount ?: "No account yet"}")
                                    MetaText("Last seen ${Fmt.rel(c.lastSeenAt)}")
                                }
                                StatusPill(Labels.of(Labels.connection, c.status))
                            }
                        }
                    }
                }
            }
        }
    }
    if (adding) AddConnectionSheet(vm, onDismiss = { adding = false }) { c -> adding = false; nav.navigate("connection/${c.id}") }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddConnectionSheet(vm: ConnectionsViewModel, onDismiss: () -> Unit, onCreated: (Connection) -> Unit) {
    var type by remember { mutableStateOf("browser") }
    var label by remember { mutableStateOf("") }
    val desc = mapOf(
        "browser" to "Link your number by scanning a QR code, like WhatsApp Web. Text, images and PDFs, with delivered/read receipts.",
        "sandbox" to "Simulated number for testing the full flow. Never messages real people.",
    )
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.verticalScroll(rememberScrollState()).imePadding().padding(20.dp, 0.dp, 20.dp, 32.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Connect a number", style = MaterialTheme.typography.titleLarge)
            vm.types.forEach { t -> ChoiceCard(Labels.connector[t] ?: t, desc[t], type == t, { type = t }) }
            ErrorText(vm.createError)
            FormField(label, { label = it }, "Name", hint = "Only your team sees this, e.g. “Support line”.")
            Callout("Use a number you control. It stays linked like WhatsApp Web until you remove it here or log it out from your phone. Bulk sending this way can get a number restricted by WhatsApp, so only message people who opted in.")
            BusyButton("Generate QR", { vm.create(type, label, onCreated) }, Modifier.fillMaxWidth(), busy = vm.actionBusy == "create")
        }
    }
}

// ---------------- Detail + QR linking ----------------

@HiltViewModel
class ConnectionDetailViewModel @Inject constructor(
    private val api: RelayApi, events: EventStream, private val stepUp: StepUpCoordinator, val session: SessionManager,
    savedState: androidx.lifecycle.SavedStateHandle,
) : LoadViewModel<Connection>(events, "connection") {
    private val id: String = savedState["id"]!!
    var qr by mutableStateOf<QrResponse?>(null); private set
    var qrError by mutableStateOf<String?>(null); private set
    var history by mutableStateOf<List<ConnectionEvent>>(emptyList()); private set

    init { load() }
    override fun shouldRefresh(eventId: String?) = eventId == null || eventId == id

    override suspend fun fetch(): Connection {
        val c = api.connection(id)
        history = runCatching { api.connectionEvents(id).items }.getOrDefault(history)
        if (c.status == "waiting_for_qr" && roleRank(session.currentMembership()?.role) >= 3) {
            apiCall { api.qr(id) }.onSuccess { qr = it; qrError = null }.onFailure { qr = null; qrError = it.message }
        } else qr = null
        return c
    }

    fun canAdmin() = roleRank(session.currentMembership()?.role) >= 3
    fun refreshQr(toast: (String) -> Unit) = act("refresh", toast) { api.refreshQr(id) }
    fun cancel(toast: (String) -> Unit) = act("cancel", toast) { api.cancelLinking(id) }
    fun simulateScan(toast: (String) -> Unit) = act("scan", toast) { api.sandboxScan(id) }
    var pairing by mutableStateOf<PairingCode?>(null); private set
    fun requestPairing(phone: String, toast: (String) -> Unit) = act("pair", toast) { pairing = api.pairingCode(id, PhoneBody(phone)) }
    fun clearPairing() { pairing = null }
    fun remove(toast: (String) -> Unit, done: () -> Unit) = act("remove", toast, onDone = done) { stepUp.withStepUp { t -> api.revokeConnection(id, t) } }
}

@Composable
private fun SecureScreen() {
    val activity = LocalContext.current as? Activity
    DisposableEffect(Unit) {
        activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE) // keep the QR out of screenshots/recents
        onDispose { activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
    }
}

@Composable
fun ConnectionDetailScreen(nav: NavHostController, id: String, vm: ConnectionDetailViewModel = hiltViewModel()) {
    val toast = LocalToast.current
    val c = vm.data
    var confirmRemove by remember { mutableStateOf(false) }
    Scaffold(topBar = { BackTopBar(c?.label ?: "Number", nav) }) { pad ->
        if (c == null) { if (vm.error != null) EmptyState("Couldn’t load", vm.error!!) else LoadingBox(Modifier.padding(pad)); return@Scaffold }
        val linking = c.status in setOf("created", "waiting_for_qr", "linking", "qr_expired")
        Column(Modifier.padding(pad).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                StatusPill(Labels.of(Labels.connection, c.status)); MetaText(Labels.connector[c.connectorType] ?: c.connectorType)
            }
            if (vm.canAdmin() && linking && c.capabilities?.qrLinking == true) QrLinking(vm, c, toast)
            else Panel {
                InfoRow("Account", c.maskedAccount ?: "—")
                InfoRow("Connected", Fmt.dateTime(c.connectedAt))
                InfoRow("Last health check", Fmt.dateTime(c.lastSeenAt))
            }
            if (c.lastErrorCode != null && c.status != "connected") {
                Callout(if (c.lastErrorCode == "LOGGED_OUT_ON_PHONE") "This number was logged out from the phone (Linked devices). Reconnect and scan a new QR to continue." else "Last error: ${c.lastErrorCode}. Try reconnecting; if it continues, contact support with this code.", CalloutKind.Bad)
            }
            if (vm.canAdmin() && c.capabilities?.qrLinking == true && c.status in setOf("disconnected", "error")) {
                BusyButton("Reconnect", { vm.refreshQr(toast) }, busy = vm.actionBusy == "refresh")
            }
            c.capabilities?.let { cap ->
                SectionTitle("What this number can do")
                Panel {
                    InfoRow("Approved templates", if (cap.templates) "Yes" else "No")
                    InfoRow("Media", cap.media.joinToString().ifEmpty { "None" })
                    InfoRow("Delivery receipts", if (cap.deliveryReceipts) "Yes" else "No")
                    InfoRow("Read receipts", if (cap.readReceipts) "Yes" else "No")
                }
            }
            SectionTitle("Activity")
            Panel {
                if (vm.history.isEmpty()) MetaText("No activity yet.")
                vm.history.forEach { e ->
                    val s = e.eventType.removePrefix("status.")
                    Row { Text(Labels.of(Labels.connection, s).label, Modifier.weight(1f)); MetaText(Fmt.dateTime(e.createdAt)) }
                }
            }
            if (vm.canAdmin() && c.status != "revoked") {
                OutlinedButton(onClick = { confirmRemove = true }, colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error), modifier = Modifier.fillMaxWidth()) { Text("Remove number") }
            }
        }
    }
    if (confirmRemove) ConfirmDialog(
        "Remove this number?", "Sending stops right away and running campaigns on this number are paused. Stored credentials are deleted. You’ll confirm with your password.",
        "Remove number", onConfirm = { confirmRemove = false; vm.remove(toast) { toast("Number removed."); nav.popBackStack() } }, onDismiss = { confirmRemove = false }, danger = true, dismiss = "Keep number",
    )
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth()) { MetaText(label, Modifier.weight(1f)); Text(value, style = MaterialTheme.typography.bodyMedium) }
}

/** Link by typing a code on the phone: the way to link when this app runs on the same phone. */
@Composable
private fun PairingPanel(vm: ConnectionDetailViewModel, toast: (String) -> Unit) {
    var phone by remember { mutableStateOf("") }
    Panel {
        Text("On this phone? Link with a code", style = MaterialTheme.typography.titleMedium)
        val p = vm.pairing
        if (p == null) {
            MetaText("A phone can’t scan its own screen. Get an 8-character code and enter it in WhatsApp instead.")
            FormField(phone, { phone = it }, "WhatsApp number to link", keyboard = KeyboardType.Phone, hint = "Include the country code, e.g. +91 98123 45678.")
            BusyButton("Get pairing code", { vm.requestPairing(phone, toast) }, busy = vm.actionBusy == "pair", enabled = phone.length >= 8)
        } else {
            Text("${p.code.take(4)}-${p.code.drop(4)}", style = MaterialTheme.typography.displaySmall, modifier = Modifier.align(Alignment.CenterHorizontally))
            Text("Open WhatsApp → Settings → Linked devices → Link a device → Link with phone number instead, then enter this code. WhatsApp may also show a notification you can tap.", style = MaterialTheme.typography.bodyMedium)
            MetaText("Expires in about 3 minutes. Never share this code with anyone.")
            TextButton(onClick = vm::clearPairing) { Text("Get a new code") }
        }
    }
}

@Composable
private fun QrLinking(vm: ConnectionDetailViewModel, c: Connection, toast: (String) -> Unit) {
    SecureScreen()
    val qr = vm.qr
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(1000); now = System.currentTimeMillis() } }
    val expiresAt = qr?.expiresAt?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() } ?: 0L
    val remaining = ((expiresAt - now) / 1000).coerceAtLeast(0)
    // Browser sessions rotate the code automatically; only the final timeout counts as expired.
    val rotating = c.connectorType == "browser"
    val expired = c.status == "qr_expired" || (!rotating && c.status == "waiting_for_qr" && (qr == null && vm.qrError != null || (qr != null && remaining == 0L)))
    val linkingNow = c.status == "linking"

    Panel {
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            Box(Modifier.size(264.dp).background(Color.White, MaterialTheme.shapes.medium).padding(14.dp), contentAlignment = Alignment.Center) {
                if (qr != null) QrImage(qr.payload, Modifier.fillMaxSize(), dimmed = expired || linkingNow)
                when {
                    linkingNow -> Column(horizontalAlignment = Alignment.CenterHorizontally) { CircularProgressIndicator(); Spacer(Modifier.height(10.dp)); Text("Linking your number…", color = Color(0xFF1D2924)) }
                    c.status == "created" -> Column(horizontalAlignment = Alignment.CenterHorizontally) { CircularProgressIndicator(); Spacer(Modifier.height(10.dp)); Text("Starting a secure session…", color = Color(0xFF1D2924)); Text("Up to a minute", style = MaterialTheme.typography.bodySmall, color = Color(0xFF4C5953)) }
                    expired -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("This QR expired", style = MaterialTheme.typography.titleMedium, color = Color(0xFF1D2924))
                        BusyButton("Get a new QR", { vm.refreshQr(toast) }, busy = vm.actionBusy == "refresh")
                    }
                    qr == null -> CircularProgressIndicator()
                }
            }
        }
        if (!expired && !linkingNow && qr != null) {
            LinearProgressIndicator(progress = { remaining.toFloat() / qr.ttlSeconds.coerceAtLeast(1) }, modifier = Modifier.fillMaxWidth())
            MetaText(if (rotating) "New code in ${remaining}s — scanning any shown code works" else "Expires in ${remaining}s", Modifier.align(Alignment.CenterHorizontally))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (!expired && !linkingNow) OutlinedButton(onClick = { vm.refreshQr(toast) }, enabled = vm.actionBusy == null) { Text("Refresh QR") }
            TextButton(onClick = { vm.cancel(toast) }, enabled = vm.actionBusy == null) { Text("Cancel linking") }
        }
    }
    Panel {
        Text("Scan with WhatsApp on your phone", style = MaterialTheme.typography.titleMedium)
        Text("1. Open WhatsApp on the phone that owns this business number.\n2. Go to Settings → Linked devices → Link a device.\n3. Point the camera at this QR code.", style = MaterialTheme.typography.bodyMedium)
        MetaText("Tip: show this screen on another device, or open the web dashboard on a computer, so the phone can scan it.")
    }
    if (c.status == "waiting_for_qr" && !expired) PairingPanel(vm, toast)
    Callout("We will never ask for your WhatsApp two-step verification PIN. If anything asks you for it here, don’t enter it.")
    if (c.connectorType == "sandbox" && c.status == "waiting_for_qr" && !expired) {
        Panel {
            MetaText("This is a sandbox number, so no phone is needed.")
            BusyButton("Simulate scan", { vm.simulateScan(toast) }, busy = vm.actionBusy == "scan")
        }
    }
}
