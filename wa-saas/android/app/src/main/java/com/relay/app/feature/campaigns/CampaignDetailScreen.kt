package com.relay.app.feature.campaigns

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavHostController
import com.relay.app.core.data.*
import com.relay.app.core.network.*
import com.relay.app.core.realtime.EventStream
import com.relay.app.core.session.SessionManager
import com.relay.app.ui.components.*
import com.relay.app.ui.navigation.BackTopBar
import com.relay.app.ui.navigation.LocalToast
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

@HiltViewModel
class CampaignDetailViewModel @Inject constructor(
    private val api: RelayApi, events: EventStream, val session: SessionManager, saved: SavedStateHandle,
) : LoadViewModel<Campaign>(events, "campaign") {
    val id: String = saved["id"]!!
    var preview by mutableStateOf<CampaignPreview?>(null); private set
    var previewError by mutableStateOf<String?>(null); private set
    var report by mutableStateOf<Report?>(null); private set
    var filter by mutableStateOf<String?>(null); private set
    var search by mutableStateOf(""); private set
    var timeline by mutableStateOf<Timeline?>(null); private set
    var launchError by mutableStateOf<String?>(null); private set
    private var launchKey = "and-" + UUID.randomUUID()
    private var reportJob: Job? = null

    init { load() }
    override fun shouldRefresh(eventId: String?) = eventId == null || eventId == id

    override suspend fun fetch(): Campaign {
        val c = api.campaign(id)
        if (c.status == "draft") { if (preview == null) loadPreview() } else loadReport()
        return c
    }

    fun canEdit() = roleRank(session.currentMembership()?.role) >= 2

    fun loadPreview() = viewModelScope.launch {
        apiCall { api.preview(id) }.onSuccess { preview = it; previewError = null }.onFailure { previewError = it.message }
    }

    fun loadReport(debounce: Boolean = false) {
        reportJob?.cancel()
        reportJob = viewModelScope.launch {
            if (debounce) delay(300)
            apiCall { api.report(id, filter, search.ifBlank { null }, limit = 100) }.onSuccess { report = it }
        }
    }
    fun setStatusFilter(s: String?) { filter = s; loadReport() }
    fun setQuery(s: String) { search = s; loadReport(debounce = true) }

    fun launch(expected: Int, toast: (String) -> Unit, done: () -> Unit) {
        launchError = null
        act("launch", onError = { launchError = it; loadPreview() }, onDone = { launchKey = "and-" + UUID.randomUUID(); toast("Campaign launched."); done() }) {
            api.launch(id, launchKey, LaunchBody(true, expected))
        }
    }
    fun pause(t: (String) -> Unit) = act("pause", t) { api.pause(id) }
    fun resume(t: (String) -> Unit) = act("resume", t) { api.resume(id) }
    fun cancel(t: (String) -> Unit) = act("cancel", t) { api.cancel(id) }
    fun delete(t: (String) -> Unit, done: () -> Unit) = act("delete", t, onDone = done) { api.deleteCampaign(id).orThrow() }
    fun openTimeline(rid: String) = viewModelScope.launch { apiCall { api.timeline(id, rid) }.onSuccess { timeline = it } }
    fun closeTimeline() { timeline = null }
}

@Composable
fun CampaignDetailScreen(nav: NavHostController, id: String, vm: CampaignDetailViewModel = hiltViewModel()) {
    val c = vm.data
    Scaffold(topBar = { BackTopBar(c?.name ?: "Campaign", nav) }) { pad ->
        if (c == null) { if (vm.error != null) EmptyState("Couldn’t load", vm.error!!) else LoadingBox(Modifier.padding(pad)); return@Scaffold }
        Box(Modifier.padding(pad)) { if (c.status == "draft") DraftView(nav, vm, c) else Monitor(vm, c) }
    }
    vm.timeline?.let { TimelineSheet(it, vm::closeTimeline) }
}

@Composable
private fun DraftView(nav: NavHostController, vm: CampaignDetailViewModel, c: Campaign) {
    val toast = LocalToast.current
    var confirming by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    val p = vm.preview
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) { StatusPill(Labels.of(Labels.campaign, c.status)); c.scheduledAt?.let { MetaText("Scheduled for ${Fmt.dateTime(it)}") } } }
        if (p == null) { item { if (vm.previewError != null) ErrorText(vm.previewError) else LoadingBox() }; return@LazyColumn }
        item {
            Panel {
                Text("Audience", style = MaterialTheme.typography.titleMedium)
                Row(verticalAlignment = Alignment.Bottom) { Text(Fmt.num(p.audience.eligible), style = MaterialTheme.typography.displaySmall); MetaText("  will receive this", Modifier.padding(bottom = 6.dp)) }
                MetaText("${Fmt.num(p.audience.selected)} selected")
                if (p.audience.excluded.optedOut > 0) MetaText("${Fmt.num(p.audience.excluded.optedOut)} excluded — opted out")
                if (p.audience.excluded.noConsent > 0) MetaText("${Fmt.num(p.audience.excluded.noConsent)} excluded — no marketing consent")
                if (p.audience.excluded.blocked > 0) MetaText("${Fmt.num(p.audience.excluded.blocked)} excluded — blocked")
                MetaText("From ${p.connection.label}${p.connection.maskedAccount?.let { " ($it)" } ?: ""} · ${Fmt.num(p.messagesRemaining)} messages left this month")
            }
        }
        item {
            Panel {
                MetaText("Rendered for real recipients")
                p.samples.forEach { s ->
                    MetaText(s.contact.displayName ?: s.contact.phone)
                    MessageBubble(s.rendered.ifBlank { "(empty)" })
                    if (s.missing.isNotEmpty()) MetaText("Missing: ${s.missing.joinToString()}")
                }
            }
        }
        items(p.errors) { Callout(it, CalloutKind.Bad) }
        items(p.warnings) { Callout(it) }
        if (vm.canEdit()) item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                BusyButton(if (c.scheduledAt != null) "Schedule campaign" else "Review and launch", { confirming = true }, Modifier.fillMaxWidth(), enabled = p.canLaunch)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SecondaryButton("Edit draft", { nav.navigate("campaign/${c.id}/edit") }, Modifier.weight(1f))
                    SecondaryButton("Refresh preview", { vm.loadPreview() }, Modifier.weight(1f))
                }
                TextButton(onClick = { deleting = true }, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("Delete draft") }
            }
        }
    }
    if (confirming && p != null) LaunchDialog(vm, c, p, toast) { confirming = false }
    if (deleting) ConfirmDialog("Delete this draft?", "This can’t be undone.", "Delete", danger = true,
        onConfirm = { deleting = false; vm.delete(toast) { nav.popBackStack() } }, onDismiss = { deleting = false })
}

/** Explicit confirmation: the user types the exact recipient count before anything is queued. */
@Composable
private fun LaunchDialog(vm: CampaignDetailViewModel, c: Campaign, p: CampaignPreview, toast: (String) -> Unit, onClose: () -> Unit) {
    var typed by remember { mutableStateOf("") }
    val n = p.audience.eligible
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text(if (c.scheduledAt != null) "Schedule this campaign?" else "Send this campaign now?") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("${Fmt.num(n)} people will get this message from ${p.connection.label}${c.scheduledAt?.let { " on ${Fmt.dateTime(it)}" } ?: ""}. You can pause any time, but sent messages can’t be recalled.")
                ErrorText(vm.launchError)
                FormField(typed, { typed = it.trim() }, "Type $n to confirm", keyboard = KeyboardType.Number)
            }
        },
        confirmButton = {
            TextButton(onClick = { vm.launch(n, toast, onClose) }, enabled = typed == n.toString() && vm.actionBusy == null) {
                Text(if (vm.actionBusy == "launch") "Launching…" else if (c.scheduledAt != null) "Schedule" else "Send to ${Fmt.num(n)}")
            }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Go back") } },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Monitor(vm: CampaignDetailViewModel, c: Campaign) {
    val toast = LocalToast.current
    var confirmCancel by remember { mutableStateOf(false) }
    val live = c.status in setOf("running", "scheduled")
    LaunchedEffect(live) { while (live) { delay(8000); vm.loadReport() } } // fallback if realtime drops
    LazyColumn(contentPadding = PaddingValues(16.dp, 16.dp, 16.dp, 40.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatusPill(Labels.of(Labels.campaign, c.status))
                MetaText("${Fmt.num(c.recipientCount)} recipients${c.launchedAt?.let { " · launched ${Fmt.dateTime(it)}" } ?: ""}")
            }
        }
        if (c.status == "paused") item { Callout(Labels.pauseReason[c.pausedReason] ?: "Paused.") }
        if (c.status == "scheduled") item { Callout("Scheduled for ${Fmt.dateTime(c.scheduledAt)}.", CalloutKind.Good) }
        item {
            Panel {
                Text("Outcomes", style = MaterialTheme.typography.titleMedium)
                EvidenceLadder(vm.report?.counts ?: c.counts, big = true, selected = vm.filter, onSelect = vm::setStatusFilter)
                MetaText("“Accepted” means WhatsApp took the message. “Delivered” and “Read” appear only when WhatsApp confirms them. “Unknown” sends are never retried automatically, to avoid duplicates.")
                if (vm.canEdit()) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (live) SecondaryButton("Pause", { vm.pause(toast) }, enabled = vm.actionBusy == null)
                    if (c.status == "paused") BusyButton("Resume", { vm.resume(toast) }, busy = vm.actionBusy == "resume")
                    if (c.status in setOf("running", "scheduled", "paused")) TextButton(onClick = { confirmCancel = true }) { Text("Cancel campaign") }
                }
            }
        }
        item {
            OutlinedTextField(vm.search, vm::setQuery, placeholder = { Text("Search number") }, singleLine = true, leadingIcon = { Icon(Icons.Outlined.Search, null) },
                shape = MaterialTheme.shapes.small, modifier = Modifier.fillMaxWidth(), keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Phone))
        }
        val rows = vm.report?.items
        if (rows == null) item { LoadingBox() }
        else if (rows.isEmpty()) item { MetaText("No recipients match.") }
        else items(rows, key = { it.id }) { r ->
            Panel(Modifier.clickable { vm.openTimeline(r.id) }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(r.displayName ?: r.phone, style = MaterialTheme.typography.titleSmall)
                        MetaText(listOfNotNull(r.phone.takeIf { r.displayName != null }, Fmt.dateTime(r.updatedAt)).joinToString(" · "))
                        r.lastErrorCode?.let { CodeText(it) }
                    }
                    StatusPill(Labels.of(Labels.recipient, r.status))
                }
            }
        }
    }
    if (confirmCancel) ConfirmDialog("Cancel this campaign?", "Queued messages won’t be sent. This can’t be undone.", "Cancel campaign", danger = true, dismiss = "Keep sending",
        onConfirm = { confirmCancel = false; vm.cancel(toast) }, onDismiss = { confirmCancel = false })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TimelineSheet(t: Timeline, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(20.dp, 0.dp, 20.dp, 32.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(t.recipient.phone, style = MaterialTheme.typography.titleLarge)
            MessageBubble(t.recipient.renderedBody ?: t.recipient.renderedParams.orEmpty().joinToString(" | "))
            t.items.forEach { e ->
                Row(verticalAlignment = Alignment.Top) {
                    Box(Modifier.padding(top = 6.dp).size(10.dp).background(ladderColor(if (e.eventType == "attempted" || e.eventType == "retry_scheduled") "queued" else e.eventType), CircleShape))
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(Labels.recipient[e.eventType]?.label ?: e.eventType.replace('_', ' ').replaceFirstChar { it.uppercase() })
                        MetaText(when (e.source) { "webhook" -> "Reported by WhatsApp"; "connector" -> "Provider response"; else -> "Relay" } + (e.detail?.let { " · $it" } ?: ""))
                    }
                    MetaText(Fmt.dateTime(e.occurredAt))
                }
            }
        }
    }
}
