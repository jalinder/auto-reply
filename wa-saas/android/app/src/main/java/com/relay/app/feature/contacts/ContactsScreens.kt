package com.relay.app.feature.contacts

import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavHostController
import com.relay.app.core.data.*
import com.relay.app.core.network.*
import com.relay.app.core.session.SessionManager
import com.relay.app.ui.components.*
import com.relay.app.ui.navigation.BackTopBar
import com.relay.app.ui.navigation.LocalToast
import com.relay.app.ui.navigation.TabTopBar
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import javax.inject.Inject

// ---------------- List ----------------

@HiltViewModel
class ContactsViewModel @Inject constructor(
    private val api: RelayApi, private val session: SessionManager, private val stepUp: StepUpCoordinator,
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: android.content.Context,
) : ViewModel() {
    var items by mutableStateOf<List<Contact>>(emptyList()); private set
    var total by mutableStateOf(0); private set
    var cursor by mutableStateOf<String?>(null); private set
    var loading by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    var tags by mutableStateOf<List<TagCount>>(emptyList()); private set
    var search by mutableStateOf(""); private set
    var tag by mutableStateOf<String?>(null); private set
    private var job: Job? = null

    init { reload(); viewModelScope.launch { apiCall { api.tags() }.onSuccess { tags = it.items } } }

    fun role() = session.currentMembership()?.role
    fun setQuery(s: String) { search = s; reload(debounce = true) }
    fun setTagFilter(t: String?) { tag = t; reload() }

    fun reload(debounce: Boolean = false) {
        job?.cancel()
        job = viewModelScope.launch {
            if (debounce) delay(300)
            loading = true
            apiCall { api.contacts(search.ifBlank { null }, tag, null) }
                .onSuccess { items = it.items; cursor = it.nextCursor; total = it.total ?: it.items.size; error = null }
                .onFailure { error = it.message }
            loading = false
        }
    }

    fun loadMore() {
        val c = cursor ?: return
        if (loading) return
        viewModelScope.launch {
            loading = true
            apiCall { api.contacts(search.ifBlank { null }, tag, c) }.onSuccess { items = items + it.items; cursor = it.nextCursor }
            loading = false
        }
    }

    /** Streams the CSV export to app cache and opens the share sheet. Requires password confirmation. */
    fun export(onFile: (File) -> Unit, onError: (String) -> Unit) = viewModelScope.launch {
        apiCall {
            val body = stepUp.withStepUp { t -> api.exportContacts(t) }
            withContext(Dispatchers.IO) {
                val dir = File(context.cacheDir, "exports").apply { mkdirs(); listFiles()?.forEach { it.delete() } }
                File(dir, "contacts.csv").also { f -> body.byteStream().use { input -> f.outputStream().use { input.copyTo(it) } } }
            }
        }.onSuccess(onFile).onFailure { onError(it.message ?: "Export failed.") }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContactsScreen(nav: NavHostController, vm: ContactsViewModel = hiltViewModel()) {
    val toast = LocalToast.current
    val context = LocalContext.current
    var menu by remember { mutableStateOf(false) }
    val canEdit = roleRank(vm.role()) >= 2
    val canAdmin = roleRank(vm.role()) >= 3
    LaunchedEffect(Unit) { nav.currentBackStackEntry?.savedStateHandle?.getStateFlow("contactsChanged", false)?.collect { if (it) { vm.reload(); nav.currentBackStackEntry?.savedStateHandle?.set("contactsChanged", false) } } }

    Scaffold(
        topBar = {
            TabTopBar("Contacts") {
                IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, "More options") }
                DropdownMenu(menu, { menu = false }) {
                    if (canEdit) DropdownMenuItem(text = { Text("Import spreadsheet") }, onClick = { menu = false; nav.navigate("contacts/import") })
                    DropdownMenuItem(text = { Text("Opt-out list") }, onClick = { menu = false; nav.navigate("contacts/optouts") })
                    if (canAdmin) DropdownMenuItem(text = { Text("Export CSV") }, onClick = {
                        menu = false
                        vm.export({ f ->
                            val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", f)
                            context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/csv").putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "Share contacts"))
                        }, toast)
                    })
                }
            }
        },
        floatingActionButton = { if (canEdit) ExtendedFloatingActionButton(onClick = { nav.navigate("contact/new") }, text = { Text("Add contact") }, icon = { Icon(Icons.Outlined.PersonAdd, null) }) },
    ) { pad ->
        Column(Modifier.padding(pad)) {
            OutlinedTextField(
                vm.search, vm::setQuery, placeholder = { Text("Search by name or number") }, singleLine = true,
                leadingIcon = { Icon(Icons.Outlined.Search, null) }, shape = MaterialTheme.shapes.small,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            )
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(vm.tag == null, { vm.setTagFilter(null) }, label = { Text("All") })
                vm.tags.forEach { t -> FilterChip(vm.tag == t.tag, { vm.setTagFilter(if (vm.tag == t.tag) null else t.tag) }, label = { Text("${t.tag} · ${t.count}") }) }
            }
            MetaText("${Fmt.num(vm.total)} people", Modifier.padding(horizontal = 16.dp))
            when {
                vm.items.isEmpty() && vm.loading -> LoadingBox()
                vm.items.isEmpty() && vm.error != null -> EmptyState("Couldn’t load", vm.error!!) { Button(onClick = { vm.reload() }) { Text("Try again") } }
                vm.items.isEmpty() -> EmptyState(
                    if (vm.search.isNotBlank() || vm.tag != null) "No matches" else "No contacts yet",
                    if (vm.search.isNotBlank() || vm.tag != null) "Try a different search or tag." else "Import a spreadsheet or add people one at a time.",
                ) { if (canEdit && vm.search.isBlank()) Button(onClick = { nav.navigate("contacts/import") }) { Text("Import contacts") } }
                else -> LazyColumn(contentPadding = PaddingValues(bottom = 96.dp)) {
                    items(vm.items, key = { it.id }) { c ->
                        ListItem(
                            headlineContent = { Text(c.displayName ?: "No name") },
                            supportingContent = { Text(c.phone + if (c.tags.isNotEmpty()) "  ·  " + c.tags.take(3).joinToString() else "") },
                            trailingContent = {
                                when {
                                    c.optedOut -> StatusPill(StatusLabel("Opted out", Tone.Bad))
                                    c.consents.any { it.purpose == "marketing" } -> StatusPill(StatusLabel("Consent", Tone.Good))
                                    else -> StatusPill(StatusLabel("No consent", Tone.Neutral))
                                }
                            },
                            modifier = Modifier.clickable { nav.navigate("contact/${c.id}") },
                        )
                        HorizontalDivider()
                    }
                    if (vm.cursor != null) item {
                        LaunchedEffect(vm.items.size) { vm.loadMore() }
                        LoadingBox()
                    }
                }
            }
        }
    }
}

// ---------------- Add ----------------

@HiltViewModel
class AddContactViewModel @Inject constructor(private val api: RelayApi) : ViewModel() {
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    fun save(body: CreateContactBody, done: () -> Unit) = viewModelScope.launch {
        busy = true; error = null
        apiCall { api.createContact(body) }.onSuccess { done() }.onFailure { error = it.message }
        busy = false
    }
}

@Composable
fun AddContactScreen(nav: NavHostController, vm: AddContactViewModel = hiltViewModel()) {
    val toast = LocalToast.current
    var phone by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var tags by remember { mutableStateOf("") }
    var fields by remember { mutableStateOf("") }
    var consent by remember { mutableStateOf(true) }
    var source by remember { mutableStateOf("") }
    Scaffold(topBar = { BackTopBar("Add contact", nav) }) { pad ->
        Column(Modifier.padding(pad).imePadding().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            ErrorText(vm.error)
            FormField(phone, { phone = it }, "Phone number", keyboard = KeyboardType.Phone, hint = "Include the country code, e.g. +91 98123 45678.")
            FormField(name, { name = it }, "Name")
            FormField(tags, { tags = it }, "Tags", hint = "Comma-separated, e.g. vip, pune")
            FormField(fields, { fields = it }, "Custom fields", singleLine = false, minLines = 3, hint = "One per line as key=value. Use as {{key}} in messages.")
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(consent, { consent = it })
                Text("This person agreed to receive marketing messages from us.")
            }
            if (consent) FormField(source, { source = it }, "Where did they agree?", hint = "e.g. checkout opt-in, in-store form")
            BusyButton("Add contact", {
                val custom = fields.lines().mapNotNull { l -> l.split("=", limit = 2).takeIf { it.size == 2 && it[0].isNotBlank() }?.let { it[0].trim() to it[1].trim() } }.toMap()
                vm.save(CreateContactBody(phone, name.ifBlank { null }, tags.split(",").map { it.trim() }.filter { it.isNotEmpty() }, custom,
                    if (consent) ConsentBody("marketing", source.ifBlank { "manual-entry" }) else null)) {
                    toast("Contact added.")
                    nav.previousBackStackEntry?.savedStateHandle?.set("contactsChanged", true)
                    nav.popBackStack()
                }
            }, Modifier.fillMaxWidth(), busy = vm.busy, enabled = phone.length >= 6)
        }
    }
}

// ---------------- Detail ----------------

@HiltViewModel
class ContactDetailViewModel @Inject constructor(private val api: RelayApi, val session: SessionManager, saved: SavedStateHandle) : LoadViewModel<Contact>() {
    private val id: String = saved["id"]!!
    init { load() }
    override suspend fun fetch() = api.contact(id)
    fun canEdit() = roleRank(session.currentMembership()?.role) >= 2
    fun addConsent(t: (String) -> Unit) = act("consent", t) { api.addConsent(id, ConsentBody("marketing", "manual-entry")) }
    fun revokeConsent(cid: String, t: (String) -> Unit) = act("revoke", t) { api.revokeConsent(id, cid) }
    fun optOut(phone: String, t: (String) -> Unit) = act("optout", t) { api.addOptOut(OptOutBody(phone, "Added by team")) }
    fun toggleBlock(blocked: Boolean, t: (String) -> Unit) = act("block", t) { api.updateContact(id, UpdateContactBody(status = if (blocked) "active" else "blocked")) }
    fun delete(t: (String) -> Unit, done: () -> Unit) = act("delete", t, onDone = done) { api.deleteContact(id).orThrow() }
}

@Composable
fun ContactDetailScreen(nav: NavHostController, id: String, vm: ContactDetailViewModel = hiltViewModel()) {
    val toast = LocalToast.current
    val c = vm.data
    var confirmDelete by remember { mutableStateOf(false) }
    Scaffold(topBar = { BackTopBar(c?.displayName ?: c?.phone ?: "Contact", nav) }) { pad ->
        if (c == null) { if (vm.error != null) EmptyState("Couldn’t load", vm.error!!) else LoadingBox(Modifier.padding(pad)); return@Scaffold }
        Column(Modifier.padding(pad).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Panel {
                Text(c.phone, style = MaterialTheme.typography.titleLarge)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (c.optedOut) StatusPill(StatusLabel("Opted out", Tone.Bad))
                    if (c.status == "blocked") StatusPill(StatusLabel("Blocked", Tone.Warn))
                    c.tags.forEach { AssistChip(onClick = {}, label = { Text(it) }) }
                }
                c.customFields.forEach { (k, v) -> Row { CodeText("{{$k}}"); Spacer(Modifier.width(8.dp)); Text(v, style = MaterialTheme.typography.bodyMedium) } }
            }
            SectionTitle("Consent")
            Panel {
                if (c.consents.isEmpty()) MetaText("No consent on record. Campaigns that require consent will skip this person.")
                c.consents.forEach { cs ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { Text(cs.purpose.replaceFirstChar { it.uppercase() }); MetaText("${cs.source}, ${Fmt.date(cs.capturedAt)}") }
                        if (vm.canEdit()) TextButton(onClick = { vm.revokeConsent(cs.id, toast) }) { Text("Revoke") }
                    }
                }
                if (vm.canEdit() && c.consents.none { it.purpose == "marketing" }) OutlinedButton(onClick = { vm.addConsent(toast) }) { Text("Record marketing consent") }
            }
            if (!c.history.isNullOrEmpty()) {
                SectionTitle("Recent messages")
                Panel {
                    c.history!!.forEach { h ->
                        Row(Modifier.fillMaxWidth().clickable { nav.navigate("campaign/${h.campaignId}") }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(h.campaignName, Modifier.weight(1f)); StatusPill(Labels.of(Labels.recipient, h.status))
                        }
                    }
                }
            }
            if (vm.canEdit()) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (!c.optedOut) OutlinedButton(onClick = { vm.optOut(c.phone, toast) }) { Text("Add to opt-outs") }
                    OutlinedButton(onClick = { vm.toggleBlock(c.status == "blocked", toast) }) { Text(if (c.status == "blocked") "Unblock" else "Block") }
                }
                TextButton(onClick = { confirmDelete = true }, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("Delete contact") }
            }
        }
    }
    if (confirmDelete) ConfirmDialog("Delete this contact?", "Their details are erased. Past campaign reports keep only the phone number.", "Delete", danger = true,
        onConfirm = { confirmDelete = false; vm.delete(toast) { nav.previousBackStackEntry?.savedStateHandle?.set("contactsChanged", true); nav.popBackStack() } }, onDismiss = { confirmDelete = false })
}

// ---------------- Opt-outs ----------------

@HiltViewModel
class OptOutsViewModel @Inject constructor(private val api: RelayApi, val session: SessionManager) : LoadViewModel<List<OptOut>>() {
    init { load() }
    override suspend fun fetch() = api.optOuts(limit = 200).items
    fun add(phone: String, t: (String) -> Unit, done: () -> Unit) = act("add", t, onDone = done) { api.addOptOut(OptOutBody(phone)) }
    fun remove(id: String, t: (String) -> Unit) = act("remove", t) { api.removeOptOut(id).orThrow() }
}

@Composable
fun OptOutsScreen(nav: NavHostController, vm: OptOutsViewModel = hiltViewModel()) {
    val toast = LocalToast.current
    var phone by remember { mutableStateOf("") }
    var removing by remember { mutableStateOf<OptOut?>(null) }
    val role = vm.session.currentMembership()?.role
    val source = mapOf("manual" to "Added by team", "inbound_keyword" to "Replied STOP", "import" to "Import", "api" to "API")
    Scaffold(topBar = { BackTopBar("Opt-outs", nav) }) { pad ->
        LazyColumn(Modifier.padding(pad), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item { MetaText("Numbers here are never messaged, even if they’re in a campaign audience. People who reply STOP are added automatically.") }
            if (roleRank(role) >= 2) item {
                Panel {
                    FormField(phone, { phone = it }, "Add a number", keyboard = KeyboardType.Phone)
                    BusyButton("Add to opt-outs", { vm.add(phone, toast) { phone = ""; toast("Added. Queued messages to it were skipped.") } }, busy = vm.actionBusy == "add", enabled = phone.length >= 6)
                }
            }
            val list = vm.data
            when {
                list == null -> item { LoadingBox() }
                list.isEmpty() -> item { EmptyState("No opt-outs", "When someone asks to stop hearing from you, they’ll appear here.") }
                else -> items(list, key = { it.id }) { o ->
                    Panel {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) { Text(o.phone, style = MaterialTheme.typography.titleSmall); MetaText("${source[o.source] ?: o.source} · ${Fmt.dateTime(o.createdAt)}"); o.reason?.let { MetaText(it) } }
                            if (roleRank(role) >= 3) TextButton(onClick = { removing = o }) { Text("Remove") }
                        }
                    }
                }
            }
        }
    }
    removing?.let { o -> ConfirmDialog("Remove ${o.phone}?", "Only remove a number if the person asked to hear from you again.", "Remove", danger = true,
        onConfirm = { removing = null; vm.remove(o.id, toast) }, onDismiss = { removing = null }) }
}

// ---------------- Import wizard ----------------

@HiltViewModel
class ImportViewModel @Inject constructor(private val api: RelayApi, private val uploader: Uploader) : ViewModel() {
    var step by mutableIntStateOf(0); private set
    var progress by mutableIntStateOf(0); private set
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    var preview by mutableStateOf<ImportPreview?>(null); private set
    var job by mutableStateOf<ImportJob?>(null); private set
    private var mediaId: String? = null

    var phoneCol by mutableStateOf(""); var nameCol by mutableStateOf(""); var tagsCol by mutableStateOf("")
    var extraFields by mutableStateOf<Map<String, String>>(emptyMap())
    var country by mutableStateOf("IN"); var addTags by mutableStateOf("")
    var consent by mutableStateOf(false); var consentSource by mutableStateOf("")

    fun pick(uri: android.net.Uri) = viewModelScope.launch {
        busy = true; error = null; progress = 0
        apiCall {
            val m = uploader.upload(uri, "import") { progress = it }
            mediaId = m.id
            api.importPreview(MediaIdBody(m.id))
        }.onSuccess { p ->
            preview = p; phoneCol = p.suggestedMapping.phone.orEmpty(); nameCol = p.suggestedMapping.name.orEmpty(); tagsCol = p.suggestedMapping.tags.orEmpty(); step = 1
        }.onFailure { error = it.message }
        busy = false
    }

    fun toggleField(col: String) {
        val key = col.lowercase().replace(Regex("[^a-z0-9_]"), "_")
        extraFields = if (extraFields.containsValue(col)) extraFields.filterValues { it != col } else extraFields + (key to col)
    }

    fun start() = viewModelScope.launch {
        busy = true; error = null
        apiCall {
            api.startImport(StartImportBody(mediaId!!, ImportMapping(phoneCol, nameCol.ifBlank { null }, tagsCol.ifBlank { null }, extraFields), country,
                addTags.split(",").map { it.trim() }.filter { it.isNotEmpty() }, if (consent) ConsentBody("marketing", consentSource.ifBlank { "import" }) else null))
        }.onSuccess { job = it; step = 2; poll(it.id) }.onFailure { error = it.message }
        busy = false
    }

    private fun poll(id: String) = viewModelScope.launch {
        while (job?.status !in setOf("completed", "failed")) {
            delay(2000)
            apiCall { api.importJob(id) }.onSuccess { job = it }
        }
    }

    fun back() { step = 0 }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ColumnPicker(label: String, value: String, options: List<String>, allowNone: Boolean, onChange: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(open, { open = it }) {
        OutlinedTextField(value.ifBlank { if (allowNone) "Don’t import" else "Choose a column" }, {}, readOnly = true, label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) }, shape = MaterialTheme.shapes.small,
            modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable))
        ExposedDropdownMenu(open, { open = false }) {
            if (allowNone) DropdownMenuItem(text = { Text("Don’t import") }, onClick = { onChange(""); open = false })
            options.forEach { o -> DropdownMenuItem(text = { Text(o) }, onClick = { onChange(o); open = false }) }
        }
    }
}

@Composable
fun ImportScreen(nav: NavHostController, vm: ImportViewModel = hiltViewModel()) {
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let(vm::pick) }
    Scaffold(topBar = { BackTopBar("Import contacts", nav) }) { pad ->
        Column(Modifier.padding(pad).imePadding().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            LinearProgressIndicator(progress = { (vm.step + 1) / 3f }, modifier = Modifier.fillMaxWidth())
            ErrorText(vm.error)
            when (vm.step) {
                0 -> Panel {
                    Text("Upload a spreadsheet", style = MaterialTheme.typography.titleMedium)
                    MetaText("CSV or Excel (.xlsx), up to 20 MB and 100,000 rows. The first row must contain column names.")
                    BusyButton(if (vm.busy) "Uploading ${vm.progress}%…" else "Choose file", {
                        picker.launch(arrayOf("text/csv", "text/comma-separated-values", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                    }, busy = vm.busy)
                }
                1 -> {
                    val p = vm.preview!!
                    Panel {
                        Text("Match your columns", style = MaterialTheme.typography.titleMedium)
                        ColumnPicker("Phone number", vm.phoneCol, p.headers, false) { vm.phoneCol = it }
                        ColumnPicker("Name", vm.nameCol, p.headers, true) { vm.nameCol = it }
                        ColumnPicker("Tags", vm.tagsCol, p.headers, true) { vm.tagsCol = it }
                        val extra = p.headers.filter { it !in setOf(vm.phoneCol, vm.nameCol, vm.tagsCol) }
                        if (extra.isNotEmpty()) {
                            Text("Extra columns as personalization fields", style = MaterialTheme.typography.titleSmall)
                            extra.forEach { h ->
                                val key = vm.extraFields.entries.firstOrNull { it.value == h }?.key
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Checkbox(key != null, { vm.toggleField(h) })
                                    Text(h); key?.let { Spacer(Modifier.width(8.dp)); CodeText("→ {{$it}}") }
                                }
                            }
                        }
                    }
                    Panel {
                        Text("Sample rows", style = MaterialTheme.typography.titleSmall)
                        p.sampleRows.take(3).forEach { r -> MetaText(p.headers.take(4).joinToString("  ·  ") { r[it].orEmpty() }) }
                    }
                    Panel {
                        ColumnPicker("Default country", vm.country, listOf("IN", "AE", "GB", "US", "SG", "SA", "BD", "NP", "LK"), false) { vm.country = it }
                        FormField(vm.addTags, { vm.addTags = it }, "Add a tag to everyone", hint = "e.g. diwali-2026")
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(vm.consent, { vm.consent = it })
                            Text("Everyone in this file agreed to receive marketing messages from us.")
                        }
                        if (vm.consent) FormField(vm.consentSource, { vm.consentSource = it }, "How was consent collected?", hint = "Recorded on each contact, e.g. website signup form")
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SecondaryButton("Back", vm::back)
                        BusyButton("Import contacts", { vm.start() }, busy = vm.busy, enabled = vm.phoneCol.isNotBlank() && (!vm.consent || vm.consentSource.isNotBlank()))
                    }
                }
                else -> {
                    val j = vm.job
                    Panel {
                        if (j == null || j.status !in setOf("completed", "failed")) {
                            Row(verticalAlignment = Alignment.CenterVertically) { CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp); Spacer(Modifier.width(12.dp)); Text("Importing… you can leave this screen; it keeps going.") }
                        } else if (j.status == "failed") {
                            Callout(j.errorSample.firstOrNull()?.reason ?: "The import failed.", CalloutKind.Bad)
                        } else {
                            Text("Import finished", style = MaterialTheme.typography.titleMedium)
                            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                                listOf("new" to j.createdCount, "updated" to j.updatedCount, "skipped" to j.invalidCount + j.duplicateCount).forEach { (l, v) ->
                                    Column { Text(Fmt.num(v), style = MaterialTheme.typography.headlineSmall); MetaText(l) }
                                }
                            }
                            if (j.optedOutCount > 0) Callout("${Fmt.num(j.optedOutCount)} imported numbers are on your opt-out list and won’t receive campaigns.")
                            j.errorSample.take(6).forEach { e -> MetaText("Row ${e.row}: ${e.phone} — ${e.reason}") }
                            BusyButton("View contacts", { nav.previousBackStackEntry?.savedStateHandle?.set("contactsChanged", true); nav.popBackStack() })
                        }
                    }
                }
            }
        }
    }
}
