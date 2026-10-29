package com.relay.app.feature.workspace

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.relay.app.core.data.Labels
import com.relay.app.core.network.NameBody
import com.relay.app.core.network.RelayApi
import com.relay.app.core.network.apiCall
import com.relay.app.core.realtime.EventStream
import com.relay.app.core.session.SessionManager
import com.relay.app.ui.components.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class WorkspaceViewModel @Inject constructor(val session: SessionManager, private val api: RelayApi, private val events: EventStream) : ViewModel() {
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set

    fun open(id: String) { session.selectTenant(id); events.restart() }

    fun create(name: String) = viewModelScope.launch {
        busy = true; error = null
        apiCall {
            val t = api.createTenant(NameBody(name.trim()))
            session.setMe(api.me())
            t
        }.onSuccess { open(it.tenant.id) }.onFailure { error = it.message }
        busy = false
    }

    fun signOut() = viewModelScope.launch {
        session.refreshToken?.let { rt -> apiCall { api.logout(com.relay.app.core.network.RefreshBody(rt)) } }
        session.signOut()
    }
}

@Composable
fun WorkspaceScreen(vm: WorkspaceViewModel = hiltViewModel()) {
    val me by vm.session.me.collectAsStateWithLifecycle()
    var name by remember { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize().systemBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("Choose a workspace", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(top = 24.dp))
        MetaText("Signed in as ${me?.user?.email}. Each workspace keeps its own contacts, numbers and campaigns.")
        Panel(padding = PaddingValues(0.dp)) {
            me?.memberships?.forEachIndexed { i, m ->
                if (i > 0) HorizontalDivider()
                ListItem(
                    headlineContent = { Text(m.tenant.name, style = MaterialTheme.typography.titleSmall) },
                    supportingContent = { Text("${Labels.role[m.role]} · ${m.tenant.planId} plan") },
                    trailingContent = { TextButton(onClick = { vm.open(m.tenant.id) }) { Text("Open") } },
                    modifier = Modifier.clickable { vm.open(m.tenant.id) },
                )
            }
        }
        Panel {
            Text("New workspace", style = MaterialTheme.typography.titleMedium)
            ErrorText(vm.error)
            FormField(name, { name = it }, "Business name")
            BusyButton("Create workspace", { vm.create(name) }, busy = vm.busy, enabled = name.trim().length >= 2)
        }
        TextButton(onClick = { vm.signOut() }) { Text("Sign out") }
    }
}
