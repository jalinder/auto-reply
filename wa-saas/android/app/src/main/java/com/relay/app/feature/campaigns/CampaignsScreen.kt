package com.relay.app.feature.campaigns

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavHostController
import com.relay.app.core.data.*
import com.relay.app.core.network.Campaign
import com.relay.app.core.network.RelayApi
import com.relay.app.core.realtime.EventStream
import com.relay.app.core.session.SessionManager
import com.relay.app.ui.components.*
import com.relay.app.ui.navigation.TabTopBar
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class CampaignsViewModel @Inject constructor(private val api: RelayApi, events: EventStream, val session: SessionManager) :
    LoadViewModel<List<Campaign>>(events, "campaign") {
    var filter by mutableStateOf<String?>(null); private set
    init { load() }
    override suspend fun fetch() = api.campaigns(filter, limit = 50).items
    fun setStatus(s: String?) { filter = s; data = null; load() }
}

private val FILTERS = listOf(null to "All", "draft" to "Drafts", "running" to "Sending", "scheduled" to "Scheduled", "paused" to "Paused", "completed" to "Finished")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CampaignsScreen(nav: NavHostController, vm: CampaignsViewModel = hiltViewModel()) {
    val canEdit = roleRank(vm.session.currentMembership()?.role) >= 2
    LaunchedEffect(Unit) { vm.load(silent = true) }
    Scaffold(
        topBar = {
            TabTopBar("Campaigns") {
                if (canEdit) TextButton(onClick = { nav.navigate("message/new") }) { Text("Send one") }
            }
        },
        floatingActionButton = { if (canEdit) ExtendedFloatingActionButton(onClick = { nav.navigate("campaign/new") }, text = { Text("New campaign") }, icon = {}) },
    ) { pad ->
        Column(Modifier.padding(pad)) {
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FILTERS.forEach { (v, l) -> FilterChip(vm.filter == v, { vm.setStatus(v) }, label = { Text(l) }) }
            }
            PullToRefreshBox(isRefreshing = vm.refreshing && vm.data != null, onRefresh = { vm.load() }) {
                val list = vm.data
                when {
                    list == null && vm.error != null -> EmptyState("Couldn’t load", vm.error!!) { Button(onClick = { vm.load() }) { Text("Try again") } }
                    list == null -> LoadingBox()
                    list.isEmpty() -> EmptyState("No campaigns here", "Create a campaign to message contacts who agreed to hear from you.")
                    else -> LazyColumn(contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(list, key = { it.id }) { c ->
                            Panel(Modifier.clickable { nav.navigate("campaign/${c.id}") }) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text(c.name, style = MaterialTheme.typography.titleSmall)
                                        MetaText("${c.connection?.label ?: ""} · ${Fmt.num(c.recipientCount)} recipients")
                                    }
                                    StatusPill(Labels.of(Labels.campaign, c.status))
                                }
                                if (c.status != "draft") EvidenceLadder(c.counts) else MetaText("Not launched · ${Fmt.dateTime(c.createdAt)}")
                            }
                        }
                    }
                }
            }
        }
    }
}
