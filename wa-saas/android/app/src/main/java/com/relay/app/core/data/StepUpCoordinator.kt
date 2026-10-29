package com.relay.app.core.data

import com.relay.app.core.network.ApiException
import com.relay.app.core.network.toApiException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Sensitive actions (remove a number, export contacts, billing, delete account) need a fresh
 * password confirmation. Repositories call [withStepUp]; the root UI shows the password sheet
 * when [pending] is non-null and completes it with a step-up token (or null on cancel).
 */
@Singleton
class StepUpCoordinator @Inject constructor() {
    private val _pending = MutableStateFlow<CompletableDeferred<String?>?>(null)
    val pending: StateFlow<CompletableDeferred<String?>?> = _pending.asStateFlow()

    fun resolve(token: String?) {
        _pending.value?.complete(token)
        _pending.value = null
    }

    suspend fun <T> withStepUp(block: suspend (token: String?) -> T): T {
        try {
            return block(null)
        } catch (t: Throwable) {
            val e = t.toApiException()
            if (e.code != "STEP_UP_REQUIRED") throw e
        }
        val d = CompletableDeferred<String?>()
        _pending.value = d
        val token = d.await() ?: throw ApiException("STEP_UP_CANCELLED", "Action cancelled.")
        return try { block(token) } catch (t: Throwable) { throw t.toApiException() }
    }
}
