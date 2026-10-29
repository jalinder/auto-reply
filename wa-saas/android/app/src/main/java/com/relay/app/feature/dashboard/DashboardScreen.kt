package com.relay.app.feature.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavHostController
import com.relay.app.core.data.Fmt
import com.relay.app.core.data.Labels
import com.relay.app.core.data.LoadViewModel
import com.relay.app.core.network.Dashboard
import com.relay.app.core.network.RelayApi
import com.relay.app.core.realtime.EventStream
import com.relay.app.ui.components.*
import com.relay.app.ui.navigation.TabTopBar
import com.relay.app.ui.theme.LocalStatusColors
import dagger.hilt.android.lifecycle.HiltViewModel
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale
import javax.inject.Inject

@HiltViewModel
class DashboardViewModel @Inject constructor(private val api: RelayApi, events: EventStream) : LoadViewModel<Dashboard>(events, "campaign") {
    init { load() }
    override suspend fun fetch() = api.dashboard()
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(nav: NavHostController, vm: DashboardViewModel = hiltViewModel()) {
    val d = vm.data
    Scaffold(
        topBar = { TabTopBar("Overview") },
        floatingActionButton = { ExtendedFloatingActionButton(onClick = { nav.navigate("campaign/new") }, text = { Text("New campaign") }, icon = {}) },
    ) { pad ->
        PullToRefreshBox(isRefreshing = vm.refreshing && d != null, onRefresh = { vm.load() }, modifier = Modifier.padding(pad)) {
            if (d == null) { if (vm.error != null) EmptyState("Couldn’t load", vm.error!!) { Button(onClick = { vm.load() }) { Text("Try again") } } else LoadingBox(); return@PullToRefreshBox }
            LazyColumn(contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (d.connections.connected == 0) item {
                    Callout("No WhatsApp number is connected yet. Connect one before launching a campaign.") { TextButton(onClick = { nav.navigate("connections") }) { Text("Connect a number") } }
                }
                if (d.connections.needsAttention > 0) item {
                    Callout("${d.connections.needsAttention} connection(s) need attention.", CalloutKind.Bad) { TextButton(onClick = { nav.navigate("connections") }) { Text("Review numbers") } }
                }
                item {
                    Panel {
                        MetaText("Messages this month")
                        Row(verticalAlignment = Alignment.Bottom) {
                            Text(Fmt.num(d.messages.used), style = MaterialTheme.typography.displaySmall)
                            MetaText("  of ${Fmt.num(d.messages.limit)}", Modifier.padding(bottom = 6.dp))
                        }
                        UsageBar(d.messages.used, d.messages.limit)
                    }
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Panel(Modifier.weight(1f)) {
                            MetaText("Contacts"); Text(Fmt.num(d.contacts), style = MaterialTheme.typography.headlineSmall)
                            MetaText("${Fmt.num(d.optOuts)} opted out")
                        }
                        Panel(Modifier.weight(1f)) {
                            MetaText("Numbers"); Text("${d.connections.connected} / ${d.connections.total}", style = MaterialTheme.typography.headlineSmall)
                            MetaText("${d.activeCampaigns} in progress")
                        }
                    }
                }
                item {
                    SectionTitle("Last 7 days")
                    Panel {
                        val c = LocalStatusColors.current
                        val max = d.last7Days.maxOfOrNull { it.submitted + it.failed + it.unknown }?.coerceAtLeast(1) ?: 1
                        Row(Modifier.fillMaxWidth().height(140.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
                            d.last7Days.forEach { day ->
                                val total = day.submitted + day.failed + day.unknown
                                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Column(Modifier.fillMaxWidth().height((110f * total / max).dp.coerceAtLeast(2.dp)).clip(RoundedCornerShape(4.dp)).background(MaterialTheme.colorScheme.surfaceVariant)) {
                                        listOf(day.failed to c.failed, day.unknown to c.unknown, (day.submitted - day.delivered).coerceAtLeast(0) to c.submitted,
                                            (day.delivered - day.read).coerceAtLeast(0) to c.delivered, day.read to c.read).forEach { (v, col) ->
                                            if (v > 0) Box(Modifier.fillMaxWidth().weight(v.toFloat()).background(col))
                                        }
                                    }
                                    MetaText(runCatching { LocalDate.parse(day.day).dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.getDefault()) }.getOrDefault(""))
                                }
                            }
                        }
                    }
                }
                item { SectionTitle("Recent campaigns") }
                if (d.recentCampaigns.isEmpty()) item { Panel { MetaText("No campaigns yet.") } }
                items(d.recentCampaigns.size) { i ->
                    val r = d.recentCampaigns[i]
                    Panel(Modifier.clickable { nav.navigate("campaign/${r.id}") }) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) { Text(r.name, style = MaterialTheme.typography.titleSmall); MetaText("${Fmt.num(r.recipientCount)} recipients · ${Fmt.dateTime(r.createdAt)}") }
                            StatusPill(Labels.of(Labels.campaign, r.status))
                        }
                    }
                }
            }
        }
    }
}
