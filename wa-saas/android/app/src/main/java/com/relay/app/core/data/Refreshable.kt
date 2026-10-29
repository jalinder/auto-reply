package com.relay.app.core.data

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.relay.app.core.network.apiCall
import com.relay.app.core.realtime.EventStream
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/** Base for screens that load one resource, refresh on demand and on matching realtime events. */
abstract class LoadViewModel<T>(events: EventStream? = null, private val eventPrefix: String? = null) : ViewModel() {
    var data by mutableStateOf<T?>(null); protected set
    var error by mutableStateOf<String?>(null); protected set
    var refreshing by mutableStateOf(false); protected set
    var actionBusy by mutableStateOf<String?>(null); protected set
    private var job: Job? = null

    protected abstract suspend fun fetch(): T

    init {
        if (events != null && eventPrefix != null) viewModelScope.launch {
            events.events.collect { if (it.type.startsWith(eventPrefix) && shouldRefresh(it.id())) load(silent = true) }
        }
    }

    open fun shouldRefresh(eventId: String?) = true

    fun load(silent: Boolean = false) {
        job?.cancel()
        job = viewModelScope.launch {
            if (!silent) refreshing = true
            apiCall { fetch() }.onSuccess { data = it; error = null }.onFailure { if (data == null || !silent) error = it.message }
            refreshing = false
        }
    }

    /** Runs a mutation with a busy flag, then reloads. Returns the error message via [onError]. */
    protected fun act(name: String, onError: (String) -> Unit, onDone: () -> Unit = {}, block: suspend () -> Unit) {
        viewModelScope.launch {
            actionBusy = name
            apiCall { block() }.onSuccess { onDone(); load(silent = true) }.onFailure { onError(it.message ?: "Something went wrong.") }
            actionBusy = null
        }
    }
}
