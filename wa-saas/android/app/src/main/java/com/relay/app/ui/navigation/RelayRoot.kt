package com.relay.app.ui.navigation

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.*
import androidx.navigation.navArgument
import com.relay.app.core.network.RelayApi
import com.relay.app.core.network.apiCall
import com.relay.app.core.realtime.EventStream
import com.relay.app.core.session.AuthState
import com.relay.app.core.session.SessionManager
import com.relay.app.feature.auth.*
import com.relay.app.feature.campaigns.CampaignBuilderScreen
import com.relay.app.feature.campaigns.CampaignDetailScreen
import com.relay.app.feature.campaigns.CampaignsScreen
import com.relay.app.feature.connections.ConnectionDetailScreen
import com.relay.app.feature.connections.ConnectionsScreen
import com.relay.app.feature.contacts.*
import com.relay.app.feature.dashboard.DashboardScreen
import com.relay.app.feature.messages.QuickSendScreen
import com.relay.app.feature.settings.*
import com.relay.app.feature.workspace.WorkspaceScreen
import com.relay.app.ui.components.LoadingBox
import com.relay.app.ui.components.StepUpHost
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Lets any screen show a short message in the shared snackbar. */
val LocalToast = staticCompositionLocalOf<(String) -> Unit> { {} }

@HiltViewModel
class RootViewModel @Inject constructor(val session: SessionManager, private val api: RelayApi, private val events: EventStream) : ViewModel() {
    var loadError by mutableStateOf<String?>(null); private set

    init {
        viewModelScope.launch {
            session.auth.collectLatest { if (it == AuthState.SignedIn) loadMe() }
        }
    }

    fun loadMe() = viewModelScope.launch {
        loadError = null
        apiCall { api.me() }.onSuccess { session.setMe(it); events.restart() }.onFailure { loadError = it.message }
    }
}

private data class Tab(val route: String, val label: String, val icon: ImageVector)
private val TABS = listOf(
    Tab("dashboard", "Overview", Icons.Outlined.Insights),
    Tab("campaigns", "Campaigns", Icons.Outlined.Campaign),
    Tab("contacts", "Contacts", Icons.Outlined.Contacts),
    Tab("connections", "Numbers", Icons.Outlined.PhoneAndroid),
    Tab("more", "More", Icons.Outlined.MoreHoriz),
)

@Composable
fun RelayRoot(resetToken: String?, onResetHandled: () -> Unit, vm: RootViewModel = hiltViewModel()) {
    val auth by vm.session.auth.collectAsStateWithLifecycle()
    val me by vm.session.me.collectAsStateWithLifecycle()
    val tenantId by vm.session.tenantId.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val toast: (String) -> Unit = remember { { msg -> scope.launch { snackbar.currentSnackbarData?.dismiss(); snackbar.showSnackbar(msg) } } }

    CompositionLocalProvider(LocalToast provides toast) {
        Box(Modifier.fillMaxSize()) {
            when {
                auth == AuthState.SignedOut || resetToken != null -> AuthNav(resetToken, onResetHandled)
                me == null -> if (vm.loadError != null) com.relay.app.ui.components.EmptyState("Couldn’t load your account", vm.loadError!!) { Button(onClick = { vm.loadMe() }) { Text("Try again") } } else LoadingBox(Modifier.fillMaxSize())
                tenantId == null -> WorkspaceScreen()
                else -> key(tenantId) { MainNav() }
            }
            SnackbarHost(snackbar, Modifier.align(androidx.compose.ui.Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 80.dp))
            StepUpHost()
        }
    }
}

@Composable
private fun AuthNav(resetToken: String?, onResetHandled: () -> Unit) {
    val nav = rememberNavController()
    NavHost(nav, startDestination = if (resetToken != null) "reset" else "login") {
        composable("login") { LoginScreen(onRegister = { nav.navigate("register") }, onForgot = { nav.navigate("forgot") }) }
        composable("register") { RegisterScreen(onBack = { nav.popBackStack() }) }
        composable("forgot") { ForgotPasswordScreen(onBack = { nav.popBackStack() }) }
        composable("reset") { ResetPasswordScreen(token = resetToken.orEmpty(), onDone = { onResetHandled(); nav.navigate("login") { popUpTo(0) } }) }
    }
}

@Composable
private fun MainNav() {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    Scaffold(
        bottomBar = {
            if (TABS.any { it.route == route }) {
                NavigationBar {
                    TABS.forEach { t ->
                        NavigationBarItem(
                            selected = route == t.route,
                            onClick = { nav.navigate(t.route) { popUpTo(nav.graph.startDestinationId) { saveState = true }; launchSingleTop = true; restoreState = true } },
                            icon = { Icon(t.icon, contentDescription = null) }, label = { Text(t.label) },
                        )
                    }
                }
            }
        },
        contentWindowInsets = WindowInsets(0),
    ) { pad ->
        NavHost(nav, startDestination = "dashboard", modifier = Modifier.padding(pad)) {
            composable("dashboard") { DashboardScreen(nav) }
            composable("campaigns") { CampaignsScreen(nav) }
            composable("contacts") { ContactsScreen(nav) }
            composable("connections") { ConnectionsScreen(nav) }
            composable("more") { MoreScreen(nav) }
            composable("message/new") { QuickSendScreen(nav) }
            composable("campaign/new") { CampaignBuilderScreen(nav, campaignId = null) }
            composable("campaign/{id}/edit", listOf(navArgument("id") { type = NavType.StringType })) { CampaignBuilderScreen(nav, it.arguments!!.getString("id")) }
            composable("campaign/{id}", listOf(navArgument("id") { type = NavType.StringType })) { CampaignDetailScreen(nav, it.arguments!!.getString("id")!!) }
            composable("connection/{id}", listOf(navArgument("id") { type = NavType.StringType })) { ConnectionDetailScreen(nav, it.arguments!!.getString("id")!!) }
            composable("contact/new") { AddContactScreen(nav) }
            composable("contact/{id}", listOf(navArgument("id") { type = NavType.StringType })) { ContactDetailScreen(nav, it.arguments!!.getString("id")!!) }
            composable("contacts/import") { ImportScreen(nav) }
            composable("contacts/optouts") { OptOutsScreen(nav) }
            composable("settings/workspace") { WorkspaceSettingsScreen(nav) }
            composable("settings/team") { TeamScreen(nav) }
            composable("settings/billing") { BillingScreen(nav) }
            composable("settings/audit") { AuditScreen(nav) }
            composable("settings/account") { AccountScreen(nav) }
        }
    }
}

/** Standard top bar used on pushed screens. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BackTopBar(title: String, nav: NavHostController, actions: @Composable RowScope.() -> Unit = {}) {
    TopAppBar(
        title = { Text(title, maxLines = 1) },
        navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.Outlined.ArrowBack, contentDescription = "Back") } },
        actions = actions,
        colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TabTopBar(title: String, actions: @Composable RowScope.() -> Unit = {}) {
    TopAppBar(
        title = { Text(title, style = MaterialTheme.typography.headlineSmall) }, actions = actions,
        colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
    )
}
