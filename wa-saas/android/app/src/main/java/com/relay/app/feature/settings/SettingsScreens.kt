package com.relay.app.feature.settings

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
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
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Shared account/session actions used by several settings screens. */
@HiltViewModel
class AccountViewModel @Inject constructor(
    val session: SessionManager, private val api: RelayApi, private val stepUp: StepUpCoordinator, private val events: EventStream,
) : ViewModel() {
    var busy by mutableStateOf<String?>(null); private set
    var error by mutableStateOf<String?>(null); private set

    private fun run(name: String, block: suspend () -> Unit, done: () -> Unit = {}) = viewModelScope.launch {
        busy = name; error = null
        apiCall { block() }.onSuccess { done() }.onFailure { error = it.message }
        busy = null
    }

    fun role() = session.currentMembership()?.role

    fun switchWorkspace(id: String) { session.selectTenant(id); events.restart() }
    fun chooseWorkspace() { session.selectTenant(null) }

    fun signOut() = viewModelScope.launch {
        session.refreshToken?.let { rt -> apiCall { api.logout(RefreshBody(rt)) } }
        events.stop(); session.signOut()
    }
    fun signOutEverywhere() = run("all", { api.logoutAll().orThrow() }) { events.stop(); session.signOut() }
    fun changePassword(current: String, next: String, done: () -> Unit) = run("pw", { api.changePassword(ChangePasswordBody(current, next)).orThrow() }) { done(); session.signOut() }
    fun setTwoFactor(enabled: Boolean, done: () -> Unit) = run("2fa", {
        stepUp.withStepUp { t -> api.setTwoFactor(t, TwoFactorBody(enabled)).orThrow() }
        session.setMe(api.me())
    }, done)
    fun deleteAccount() = run("delete", { stepUp.withStepUp { t -> api.deleteMe(t).orThrow() } }) { session.signOut() }

    fun rename(name: String, done: () -> Unit) = run("rename", { api.renameTenant(NameBody(name)).orThrow(); session.setMe(api.me()) }, done)
    fun deleteWorkspace() = run("deleteWs", { stepUp.withStepUp { t -> api.deleteTenant(t).orThrow() }; session.setMe(api.me()) }) { session.selectTenant(null) }
}

private data class MoreItem(val label: String, val icon: ImageVector, val route: String, val minRole: Int = 1)

@Composable
fun MoreScreen(nav: NavHostController, vm: AccountViewModel = hiltViewModel()) {
    val me by vm.session.me.collectAsStateWithLifecycle()
    val current = vm.session.currentMembership()
    val rank = roleRank(vm.role())
    val entries = listOf(
        MoreItem("Workspace", Icons.Outlined.Business, "settings/workspace"),
        MoreItem("Team", Icons.Outlined.Group, "settings/team"),
        MoreItem("Plan & billing", Icons.Outlined.CreditCard, "settings/billing"),
        MoreItem("Activity log", Icons.Outlined.History, "settings/audit", minRole = 3),
        MoreItem("Opt-out list", Icons.Outlined.Block, "contacts/optouts"),
        MoreItem("Your account", Icons.Outlined.Person, "settings/account"),
    ).filter { rank >= it.minRole }
    Scaffold(topBar = { TabTopBar("More") }) { pad ->
        LazyColumn(Modifier.padding(pad), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Panel {
                    Text(current?.tenant?.name ?: "", style = MaterialTheme.typography.titleLarge)
                    MetaText("${Labels.role[current?.role] ?: ""} · ${current?.tenant?.planId} plan")
                    if ((me?.memberships?.size ?: 0) > 1) TextButton(onClick = vm::chooseWorkspace, contentPadding = PaddingValues(0.dp)) { Text("Switch workspace") }
                }
            }
            item {
                Panel(padding = PaddingValues(0.dp)) {
                    entries.forEachIndexed { i, entry ->
                        if (i > 0) HorizontalDivider()
                        ListItem(headlineContent = { Text(entry.label) }, leadingContent = { Icon(entry.icon, null) }, modifier = Modifier.clickable { nav.navigate(entry.route) })
                    }
                }
            }
            item {
                Panel {
                    Text(me?.user?.name ?: "", style = MaterialTheme.typography.titleSmall)
                    MetaText(me?.user?.email ?: "")
                    TextButton(onClick = { vm.signOut() }, contentPadding = PaddingValues(0.dp)) {
                        Icon(Icons.AutoMirrored.Outlined.Logout, null); Spacer(Modifier.width(8.dp)); Text("Sign out")
                    }
                }
            }
            item { MetaText("Relay for Android · v${com.relay.app.BuildConfig.VERSION_NAME}") }
        }
    }
}

@Composable
fun WorkspaceSettingsScreen(nav: NavHostController, vm: AccountViewModel = hiltViewModel()) {
    val toast = LocalToast.current
    val current = vm.session.currentMembership()
    var name by remember { mutableStateOf(current?.tenant?.name.orEmpty()) }
    var deleting by remember { mutableStateOf(false) }
    var typed by remember { mutableStateOf("") }
    val rank = roleRank(vm.role())
    Scaffold(topBar = { BackTopBar("Workspace", nav) }) { pad ->
        Column(Modifier.padding(pad).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            ErrorText(vm.error)
            Panel {
                Text("Workspace name", style = MaterialTheme.typography.titleMedium)
                FormField(name, { name = it }, "Name", enabled = rank >= 3)
                if (rank >= 3) BusyButton("Save name", { vm.rename(name.trim()) { toast("Workspace renamed.") } }, busy = vm.busy == "rename", enabled = name.trim().length >= 2 && name != current?.tenant?.name)
            }
            Panel {
                Text("Data retention", style = MaterialTheme.typography.titleMedium)
                MetaText("Uploaded import files are deleted after 7 days. Campaign media is kept for 180 days unless an active campaign uses it. Deleted contacts are anonymized immediately.")
            }
            if (rank >= 4) Panel {
                Text("Delete workspace", style = MaterialTheme.typography.titleMedium)
                MetaText("Stops all campaigns, removes every connection and schedules contacts, media and reports for deletion. This can’t be undone.")
                BusyButton("Delete workspace", { typed = ""; deleting = true }, danger = true, busy = vm.busy == "deleteWs")
            }
        }
    }
    if (deleting) AlertDialog(
        onDismissRequest = { deleting = false }, title = { Text("Delete this workspace?") },
        text = { FormField(typed, { typed = it }, "Type “${current?.tenant?.name}” to confirm") },
        confirmButton = { TextButton(onClick = { deleting = false; vm.deleteWorkspace() }, enabled = typed == current?.tenant?.name, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("Delete workspace") } },
        dismissButton = { TextButton(onClick = { deleting = false }) { Text("Keep workspace") } },
    )
}

// ---------------- Team ----------------

@HiltViewModel
class TeamViewModel @Inject constructor(private val api: RelayApi, val session: SessionManager) : LoadViewModel<List<Member>>() {
    init { load() }
    override suspend fun fetch() = api.members().items
    fun invite(email: String, role: String, t: (String) -> Unit, done: () -> Unit) = act("invite", t, onDone = done) { api.invite(InviteBody(email.trim(), role)).orThrow() }
    fun changeRole(userId: String, role: String, t: (String) -> Unit) = act("role", t) { api.changeRole(userId, RoleBody(role)).orThrow() }
    fun remove(userId: String, t: (String) -> Unit) = act("remove", t) { api.removeMember(userId).orThrow() }
}

@Composable
fun TeamScreen(nav: NavHostController, vm: TeamViewModel = hiltViewModel()) {
    val toast = LocalToast.current
    val myId = vm.session.me.collectAsStateWithLifecycle().value?.user?.id
    val rank = roleRank(vm.session.currentMembership()?.role)
    var email by remember { mutableStateOf("") }
    var role by remember { mutableStateOf("editor") }
    var removing by remember { mutableStateOf<Member?>(null) }
    val help = mapOf("admin" to "Manage numbers, team and opt-outs, plus everything editors can do.", "editor" to "Create and send campaigns, manage contacts.", "viewer" to "See reports and contacts, no changes.")
    Scaffold(topBar = { BackTopBar("Team", nav) }) { pad ->
        LazyColumn(Modifier.padding(pad), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (rank >= 3) item {
                Panel {
                    Text("Invite a teammate", style = MaterialTheme.typography.titleMedium)
                    FormField(email, { email = it }, "Email", keyboard = KeyboardType.Email)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("admin", "editor", "viewer").forEach { r -> FilterChip(role == r, { role = r }, label = { Text(Labels.role[r]!!) }) }
                    }
                    MetaText(help[role]!!)
                    BusyButton("Send invitation", { vm.invite(email, role, toast) { email = ""; toast("Invitation sent.") } }, busy = vm.actionBusy == "invite", enabled = email.contains("@"))
                }
            }
            val list = vm.data
            if (list == null) item { LoadingBox() } else items(list, key = { it.userId }) { m ->
                val self = m.userId == myId
                val editable = rank >= 3 && !self && (rank >= 4 || m.role != "owner")
                var menu by remember { mutableStateOf(false) }
                Panel {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(m.name + if (self) " (you)" else "", style = MaterialTheme.typography.titleSmall)
                            MetaText(m.email)
                            if (m.pending) StatusPill(StatusLabel("Invite pending", Tone.Warn)) else MetaText("Joined ${Fmt.date(m.joinedAt)}")
                        }
                        Box {
                            TextButton(onClick = { if (editable) menu = true }, enabled = editable) { Text(Labels.role[m.role] ?: m.role) }
                            DropdownMenu(menu, { menu = false }) {
                                (if (rank >= 4) listOf("owner", "admin", "editor", "viewer") else listOf("admin", "editor", "viewer")).forEach { r ->
                                    DropdownMenuItem(text = { Text(Labels.role[r]!!) }, onClick = { menu = false; if (r != m.role) vm.changeRole(m.userId, r, toast) })
                                }
                                HorizontalDivider()
                                DropdownMenuItem(text = { Text("Remove from workspace", color = MaterialTheme.colorScheme.error) }, onClick = { menu = false; removing = m })
                            }
                        }
                    }
                }
            }
        }
    }
    removing?.let { m -> ConfirmDialog("Remove ${m.name}?", "They lose access to this workspace immediately.", "Remove", danger = true,
        onConfirm = { removing = null; vm.remove(m.userId, toast) }, onDismiss = { removing = null }) }
}

// ---------------- Billing ----------------

@HiltViewModel
class BillingViewModel @Inject constructor(private val api: RelayApi, private val stepUp: StepUpCoordinator, val session: SessionManager) : LoadViewModel<Billing>() {
    var invoices by mutableStateOf<List<Invoice>?>(null); private set
    init { load() }
    override suspend fun fetch(): Billing {
        if (roleRank(session.currentMembership()?.role) >= 3) invoices = runCatching { api.invoices().items }.getOrDefault(emptyList())
        return api.billing()
    }
    fun subscribe(planId: String, t: (String) -> Unit, open: (String) -> Unit) = act("sub", t) { open(stepUp.withStepUp { tok -> api.subscribe(tok, PlanBody(planId)) }.checkoutUrl) }
    fun cancel(t: (String) -> Unit) = act("cancel", t, onDone = { t("Subscription will end at the period close.") }) { stepUp.withStepUp { tok -> api.cancelSubscription(tok).orThrow() } }
}

@Composable
fun BillingScreen(nav: NavHostController, vm: BillingViewModel = hiltViewModel()) {
    val toast = LocalToast.current
    val context = LocalContext.current
    val isOwner = roleRank(vm.session.currentMembership()?.role) >= 4
    var confirmCancel by remember { mutableStateOf(false) }
    Scaffold(topBar = { BackTopBar("Plan & billing", nav) }) { pad ->
        val b = vm.data
        if (b == null) { LoadingBox(Modifier.padding(pad)); return@Scaffold }
        LazyColumn(Modifier.padding(pad), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Panel {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("${b.plan.name} plan", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                        b.subscription?.let { StatusPill(StatusLabel(it.status, if (it.status == "active") Tone.Good else Tone.Warn)) }
                    }
                    MetaText("Usage resets on ${Fmt.date(b.usage.periodEnd)}.")
                    listOf(
                        Triple("Messages this month", b.usage.messages, b.plan.limits.messagesPerMonth),
                        Triple("Contacts", b.usage.contacts, b.plan.limits.contacts),
                        Triple("WhatsApp numbers", b.usage.connections, b.plan.limits.connections),
                        Triple("Team members", b.usage.members, b.plan.limits.members),
                    ).forEach { (l, u, lim) ->
                        Row { MetaText(l, Modifier.weight(1f)); Text("${Fmt.num(u)} / ${Fmt.num(lim)}", style = MaterialTheme.typography.bodyMedium) }
                        UsageBar(u, lim)
                    }
                    if (isOwner && b.subscription?.status == "active") TextButton(onClick = { confirmCancel = true }) { Text("Cancel subscription") }
                }
            }
            items(b.plans, key = { it.id }) { p ->
                Panel {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(p.name, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                        Text("₹${Fmt.num(p.priceInrMonthly)}/mo", style = MaterialTheme.typography.titleMedium)
                    }
                    MetaText("${Fmt.num(p.limits.messagesPerMonth)} messages · ${Fmt.num(p.limits.contacts)} contacts · ${p.limits.connections} numbers · ${p.limits.members} members")
                    when {
                        p.id == b.plan.id -> StatusPill(StatusLabel("Current plan", Tone.Good))
                        isOwner && p.id != "free" -> BusyButton("Switch to ${p.name}", {
                            vm.subscribe(p.id, toast) { url -> context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
                        }, busy = vm.actionBusy == "sub")
                    }
                }
            }
            vm.invoices?.let { list ->
                item { SectionTitle("Invoices") }
                if (list.isEmpty()) item { MetaText("No invoices yet.") }
                items(list, key = { it.id }) { inv ->
                    Panel(Modifier.clickable(enabled = inv.url != null) { inv.url?.let { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it))) } }) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) { Text(Fmt.date(inv.issuedAt), style = MaterialTheme.typography.titleSmall); MetaText(inv.status) }
                            Text("${inv.currency} ${"%,.2f".format(inv.amount)}", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            }
            item { MetaText("Prices exclude GST. Plan limits apply per workspace.") }
        }
    }
    if (confirmCancel) ConfirmDialog("Cancel subscription?", "Your plan stays active until the end of this billing period.", "Cancel subscription", danger = true, dismiss = "Keep plan",
        onConfirm = { confirmCancel = false; vm.cancel(toast) }, onDismiss = { confirmCancel = false })
}

// ---------------- Audit ----------------

@HiltViewModel
class AuditViewModel @Inject constructor(private val api: RelayApi) : ViewModel() {
    var items by mutableStateOf<List<AuditLog>>(emptyList()); private set
    var cursor by mutableStateOf<String?>(null); private set
    var loading by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    private var started = false
    init { more() }
    fun more() {
        if (loading || (started && cursor == null)) return
        viewModelScope.launch {
            loading = true
            apiCall { api.audit(cursor) }.onSuccess { items = items + it.items; cursor = it.nextCursor; started = true }.onFailure { error = it.message }
            loading = false
        }
    }
}

private val AUDIT_LABEL = mapOf(
    "connection.created" to "Connected a number", "connection.revoked" to "Removed a number", "connection.link_cancelled" to "Cancelled number linking",
    "campaign.launched" to "Launched a campaign", "campaign.paused" to "Paused a campaign", "campaign.resumed" to "Resumed a campaign", "campaign.cancelled" to "Cancelled a campaign",
    "contacts.exported" to "Exported contacts", "contacts.import_started" to "Imported contacts", "member.invited" to "Invited a teammate", "member.removed" to "Removed a teammate",
    "member.role_changed" to "Changed a role", "optout.added" to "Added an opt-out", "optout.removed" to "Removed an opt-out", "consent.recorded" to "Recorded consent",
    "consent.revoked" to "Revoked consent", "tenant.updated" to "Renamed the workspace", "tenant.created" to "Created the workspace", "billing.subscribe_started" to "Started a plan change",
)

@Composable
fun AuditScreen(nav: NavHostController, vm: AuditViewModel = hiltViewModel()) {
    Scaffold(topBar = { BackTopBar("Activity log", nav) }) { pad ->
        LazyColumn(Modifier.padding(pad), contentPadding = PaddingValues(vertical = 8.dp)) {
            if (vm.error != null && vm.items.isEmpty()) item { EmptyState("Couldn’t load", vm.error!!) }
            items(vm.items, key = { it.id }) { a ->
                ListItem(
                    headlineContent = { Text(AUDIT_LABEL[a.action] ?: a.action) },
                    supportingContent = { Text("${a.actor?.name ?: "System"} · ${Fmt.dateTime(a.createdAt)}") },
                )
                HorizontalDivider()
            }
            if (vm.cursor != null || vm.loading) item { LaunchedEffect(vm.items.size) { vm.more() }; LoadingBox() }
        }
    }
}

// ---------------- Account ----------------

@Composable
fun AccountScreen(nav: NavHostController, vm: AccountViewModel = hiltViewModel()) {
    val toast = LocalToast.current
    val me by vm.session.me.collectAsStateWithLifecycle()
    var current by remember { mutableStateOf("") }
    var next by remember { mutableStateOf("") }
    var confirmDelete by remember { mutableStateOf(false) }
    Scaffold(topBar = { BackTopBar("Your account", nav) }) { pad ->
        Column(Modifier.padding(pad).imePadding().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Panel { Text(me?.user?.name ?: "", style = MaterialTheme.typography.titleLarge); MetaText(me?.user?.email ?: "") }
            ErrorText(vm.error)
            Panel {
                Text("Change password", style = MaterialTheme.typography.titleMedium)
                FormField(current, { current = it }, "Current password", password = true)
                FormField(next, { next = it }, "New password", password = true, hint = "At least 10 characters, with a letter and a number.")
                BusyButton("Change password", { vm.changePassword(current, next) { toast("Password changed. Sign in again.") } }, busy = vm.busy == "pw", enabled = current.isNotEmpty() && next.length >= 10)
            }
            Panel {
                val on = me?.user?.twoFactorEnabled == true
                Text("Two-step sign-in", style = MaterialTheme.typography.titleMedium)
                MetaText(if (on) "On. After your password, we email you a 6-digit code." else "Off. Turn it on to require a code from your email each time you sign in.")
                BusyButton(if (on) "Turn off" else "Turn on", { vm.setTwoFactor(!on) { toast(if (on) "Sign-in codes turned off." else "Sign-in codes turned on.") } }, busy = vm.busy == "2fa")
            }
            Panel {
                Text("Sessions", style = MaterialTheme.typography.titleMedium)
                MetaText("Sign out on every browser and phone where you’re signed in.")
                SecondaryButton("Sign out everywhere", { vm.signOutEverywhere() })
            }
            Panel {
                Text("Delete account", style = MaterialTheme.typography.titleMedium)
                MetaText("If you own a workspace with no other owners, transfer or delete it first.")
                BusyButton("Delete my account", { confirmDelete = true }, danger = true, busy = vm.busy == "delete")
            }
        }
    }
    if (confirmDelete) ConfirmDialog("Delete your account?", "Your personal details are erased and you lose access to every workspace. You’ll confirm with your password.", "Delete account", danger = true,
        onConfirm = { confirmDelete = false; vm.deleteAccount() }, onDismiss = { confirmDelete = false })
}
