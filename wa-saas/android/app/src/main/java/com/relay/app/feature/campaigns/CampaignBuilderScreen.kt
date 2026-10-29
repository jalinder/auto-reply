package com.relay.app.feature.campaigns

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavHostController
import com.relay.app.core.data.Fmt
import com.relay.app.core.data.Labels
import com.relay.app.core.data.Uploader
import com.relay.app.core.network.*
import com.relay.app.ui.components.*
import com.relay.app.ui.navigation.BackTopBar
import com.relay.app.ui.navigation.LocalToast
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import javax.inject.Inject

@HiltViewModel
class BuilderViewModel @Inject constructor(private val api: RelayApi, private val uploader: Uploader, saved: SavedStateHandle) : ViewModel() {
    private val editId: String? = saved["id"]
    var ready by mutableStateOf(editId == null); private set
    var connections by mutableStateOf<List<Connection>>(emptyList()); private set
    var tags by mutableStateOf<List<TagCount>>(emptyList()); private set
    var templates by mutableStateOf<List<WaTemplate>>(emptyList()); private set
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    var uploadPct by mutableStateOf<Int?>(null); private set

    var name by mutableStateOf("")
    var connectionId by mutableStateOf("")
    var audience by mutableStateOf(Audience())
    var messageType by mutableStateOf("text")
    var body by mutableStateOf(TextFieldValue("Hi {{first_name}}, ", TextRange(18)))
    var template by mutableStateOf<WaTemplate?>(null)
    var params by mutableStateOf<List<String>>(emptyList())
    var media by mutableStateOf<MediaAsset?>(null)
    var scheduledAt by mutableStateOf<LocalDateTime?>(null)
    private var pendingTemplate: Pair<String, String>? = null

    init {
        viewModelScope.launch {
            apiCall { api.connections().items.filter { it.status != "revoked" } }.onSuccess { connections = it }
            apiCall { api.tags().items }.onSuccess { tags = it }
            editId?.let { id ->
                apiCall { api.campaign(id) }.onSuccess { c ->
                    name = c.name; connectionId = c.connectionId; audience = c.audience; messageType = c.messageType
                    body = TextFieldValue(c.body.orEmpty()); params = c.templateParams
                    pendingTemplate = c.templateName?.let { it to (c.templateLanguage ?: "en") }
                    media = c.mediaId?.let { MediaAsset(it, "Attached file", "", 0, "ready") }
                    scheduledAt = c.scheduledAt?.let { LocalDateTime.ofInstant(Instant.parse(it), ZoneId.systemDefault()) }
                    loadTemplates()
                }.onFailure { error = it.message }
                ready = true
            }
        }
    }

    val connection get() = connections.firstOrNull { it.id == connectionId }

    fun selectConnection(id: String) { connectionId = id; template = null; params = emptyList(); loadTemplates() }

    private fun loadTemplates() {
        val c = connection ?: return
        // WhatsApp Web sessions send free-form messages; approved templates aren't applicable.
        if (c.capabilities?.templates != true) { templates = emptyList(); messageType = "text"; pendingTemplate = null }
    }

    fun chooseTemplate(t: WaTemplate) {
        template = t
        params = List(t.paramCount) { i -> params.getOrNull(i) ?: if (i == 0) "{{first_name}}" else "" }
    }

    fun insert(key: String) {
        val token = "{{$key}}"
        val s = body.selection
        val text = body.text.replaceRange(s.start, s.end, token)
        body = TextFieldValue(text, TextRange(s.start + token.length))
    }

    fun attach(uri: android.net.Uri) = viewModelScope.launch {
        uploadPct = 0; error = null
        apiCall { uploader.upload(uri, "campaign") { uploadPct = it } }.onSuccess { media = it }.onFailure { error = it.message }
        uploadPct = null
    }

    val valid get() = name.isNotBlank() && connectionId.isNotBlank() &&
        (if (messageType == "template") template != null else body.text.isNotBlank()) &&
        (audience.type != "tags" || !audience.tags.isNullOrEmpty())

    fun previewText(): String {
        val sample = mapOf("first_name" to "Asha", "name" to "Asha Rao", "phone" to "+91 98•••678")
        val src = if (messageType == "template") template?.bodyText.orEmpty().replace(Regex("\\{\\{(\\d+)\\}\\}")) { m -> params.getOrNull(m.groupValues[1].toInt() - 1)?.ifBlank { null } ?: m.value } else body.text
        return src.replace(Regex("\\{\\{\\s*(\\w+)\\s*\\}\\}")) { m -> sample[m.groupValues[1]] ?: m.value }
    }

    fun save(done: (String) -> Unit) = viewModelScope.launch {
        busy = true; error = null
        val b = CampaignBody(
            name = name.trim(), connectionId = connectionId, messageType = messageType,
            body = if (messageType == "text") body.text else null,
            templateName = template?.name.takeIf { messageType == "template" }, templateLanguage = template?.language.takeIf { messageType == "template" },
            templateParams = params.takeIf { messageType == "template" }, mediaId = media?.id, audience = audience,
            scheduledAt = scheduledAt?.atZone(ZoneId.systemDefault())?.toInstant()?.toString(),
        )
        apiCall { if (editId == null) api.createCampaign(b) else api.updateCampaign(editId, b) }.onSuccess { done(it.id) }.onFailure { error = it.message }
        busy = false
    }
}

@Composable
fun CampaignBuilderScreen(nav: NavHostController, campaignId: String?, vm: BuilderViewModel = hiltViewModel()) {
    val toast = LocalToast.current
    val context = LocalContext.current
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let(vm::attach) }
    Scaffold(topBar = { BackTopBar(if (campaignId == null) "New campaign" else "Edit campaign", nav) }) { pad ->
        if (!vm.ready) { LoadingBox(Modifier.padding(pad)); return@Scaffold }
        Column(Modifier.padding(pad).imePadding().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            MetaText("Saved as a draft. You’ll preview real messages and confirm before anything is sent.")
            ErrorText(vm.error)

            Panel {
                Text("Basics", style = MaterialTheme.typography.titleMedium)
                FormField(vm.name, { vm.name = it }, "Campaign name", hint = "Only your team sees this.")
                MetaText("Send from")
                if (vm.connections.isEmpty()) Callout("No numbers yet. Connect one first.") { TextButton(onClick = { nav.navigate("connections") }) { Text("Connect a number") } }
                vm.connections.forEach { c ->
                    ChoiceCard(c.label, "${Labels.connector[c.connectorType]}${if (c.status != "connected") " · not connected" else ""}", vm.connectionId == c.id, { vm.selectConnection(c.id) })
                }
            }

            Panel {
                Text("Who gets it", style = MaterialTheme.typography.titleMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ChoiceCard("All contacts", null, vm.audience.type == "all", { vm.audience = vm.audience.copy(type = "all") }, Modifier.weight(1f))
                    ChoiceCard("With tags", null, vm.audience.type == "tags", { vm.audience = vm.audience.copy(type = "tags", tags = vm.audience.tags ?: emptyList()) }, Modifier.weight(1f))
                }
                if (vm.audience.type == "tags") {
                    if (vm.tags.isEmpty()) MetaText("No tags yet. Add tags to contacts or during import.")
                    FlowRowTags(vm.tags, vm.audience.tags.orEmpty()) { t ->
                        val cur = vm.audience.tags.orEmpty()
                        vm.audience = vm.audience.copy(tags = if (t in cur) cur - t else cur + t)
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(vm.audience.requireConsent, { vm.audience = vm.audience.copy(requireConsent = it) })
                    Text("Only people with recorded marketing consent (recommended)")
                }
                MetaText("Opted-out numbers are always excluded.")
            }

            Panel {
                Text("Message", style = MaterialTheme.typography.titleMedium)
                val caps = vm.connection?.capabilities
                if (caps?.templates == true) {
                    ChoiceCard("Approved template", "Required for marketing outside a 24-hour chat window.", vm.messageType == "template", { vm.messageType = "template" })
                    ChoiceCard("Free-form text", "Only reaches people who messaged you in the last 24 hours.", vm.messageType == "text", { vm.messageType = "text" })
                }
                if (vm.messageType == "text" || caps?.templates != true) {
                    OutlinedTextField(vm.body, { if (it.text.length <= 4096) vm.body = it }, label = { Text("Text") }, minLines = 5, shape = MaterialTheme.shapes.small,
                        supportingText = { Text("${vm.body.text.length} / 4096") }, modifier = Modifier.fillMaxWidth())
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        MetaText("Insert:")
                        listOf("first_name", "name", "phone").forEach { k -> TextButton(onClick = { vm.insert(k) }) { Text("{{$k}}") } }
                    }
                } else {
                    if (vm.templates.isEmpty()) MetaText("No approved templates found. Create one in Meta Business Manager.")
                    vm.templates.forEach { t -> ChoiceCard("${t.name} (${t.language})", t.bodyText.take(120), vm.template?.name == t.name && vm.template?.language == t.language, { vm.chooseTemplate(t) }) }
                    vm.params.forEachIndexed { i, p ->
                        FormField(p, { v -> vm.params = vm.params.mapIndexed { j, x -> if (j == i) v else x } }, "Variable {{${i + 1}}}", hint = "Text or a placeholder like {{first_name}}")
                    }
                }
                if (!caps?.media.isNullOrEmpty()) {
                    val m = vm.media
                    if (m != null) Row(verticalAlignment = Alignment.CenterVertically) { Text("📎 ${m.fileName}", Modifier.weight(1f)); TextButton(onClick = { vm.media = null }) { Text("Remove") } }
                    else OutlinedButton(onClick = { picker.launch(arrayOf("image/jpeg", "image/png", "image/webp", "application/pdf", "video/mp4")) }, enabled = vm.uploadPct == null) {
                        Text(vm.uploadPct?.let { "Uploading $it%…" } ?: "Attach image or PDF")
                    }
                }
            }

            Panel {
                Text("When", style = MaterialTheme.typography.titleMedium)
                ChoiceCard("Right after I confirm", null, vm.scheduledAt == null, { vm.scheduledAt = null })
                ChoiceCard("At a scheduled time", vm.scheduledAt?.let { Fmt.dateTime(it.atZone(ZoneId.systemDefault()).toInstant().toString()) } ?: "Pick a date and time", vm.scheduledAt != null, {
                    val now = vm.scheduledAt ?: LocalDateTime.now().plusHours(1)
                    DatePickerDialog(context, { _, y, mo, d ->
                        TimePickerDialog(context, { _, h, mi -> vm.scheduledAt = LocalDateTime.of(y, mo + 1, d, h, mi) }, now.hour, now.minute, false).show()
                    }, now.year, now.monthValue - 1, now.dayOfMonth).apply { datePicker.minDate = System.currentTimeMillis() }.show()
                })
            }

            Panel {
                MetaText("Preview with sample contact “Asha”")
                vm.media?.let { MessageBubble("📎 ${it.fileName}") }
                MessageBubble(vm.previewText().ifBlank { "Your message appears here." })
            }

            BusyButton("Save and preview", { vm.save { id -> toast("Draft saved."); nav.navigate("campaign/$id") { popUpTo("campaigns") } } }, Modifier.fillMaxWidth(), busy = vm.busy, enabled = vm.valid)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FlowRowTags(tags: List<TagCount>, selected: List<String>, onToggle: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        tags.forEach { t -> FilterChip(t.tag in selected, { onToggle(t.tag) }, label = { Text("${t.tag} · ${t.count}") }) }
    }
}
