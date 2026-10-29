package com.relay.app.core.realtime

import com.relay.app.BuildConfig
import com.relay.app.core.network.RelayJson
import com.relay.app.core.session.SessionManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton

@Serializable data class RealtimeEvent(val type: String, val data: JsonObject? = null) {
    fun id(): String? = data?.get("id")?.toString()?.trim('"')
}

/**
 * Server-Sent Events from /v1/events for the selected workspace. Started while the app is in
 * the foreground and reconnects with backoff. Screens collect [events] and refresh themselves.
 */
@Singleton
class EventStream @Inject constructor(
    @Named("api") apiClient: OkHttpClient,
    private val session: SessionManager,
) {
    private val client = apiClient.newBuilder().readTimeout(60, TimeUnit.SECONDS).build()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _events = MutableSharedFlow<RealtimeEvent>(extraBufferCapacity = 64)
    val events: SharedFlow<RealtimeEvent> = _events.asSharedFlow()
    private var source: EventSource? = null
    private var loop: Job? = null

    fun start() {
        if (loop?.isActive == true) return
        loop = scope.launch {
            var backoff = 2_000L
            while (true) {
                if (session.accessToken != null && session.tenantId.value != null) {
                    val closed = kotlinx.coroutines.CompletableDeferred<Unit>()
                    val req = Request.Builder().url(BuildConfig.API_BASE_URL + "v1/events").header("Accept", "text/event-stream").build()
                    source = EventSources.createFactory(client).newEventSource(req, object : EventSourceListener() {
                        override fun onOpen(eventSource: EventSource, response: Response) { backoff = 2_000L }
                        override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                            runCatching { RelayJson.decodeFromString(RealtimeEvent.serializer(), data) }
                                .getOrNull()?.takeIf { it.type != "ping" }?.let { _events.tryEmit(it) }
                        }
                        override fun onClosed(eventSource: EventSource) { closed.complete(Unit) }
                        override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) { closed.complete(Unit) }
                    })
                    closed.await()
                }
                delay(backoff)
                backoff = (backoff * 2).coerceAtMost(30_000L)
            }
        }
    }

    /** Reconnect, e.g. after switching workspace. */
    fun restart() { stop(); start() }

    fun stop() {
        loop?.cancel(); loop = null
        source?.cancel(); source = null
    }
}
