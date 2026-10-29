package com.relay.app.core.session

import android.content.Context
import com.relay.app.core.network.Me
import com.relay.app.core.network.Membership
import com.relay.app.core.network.TokenPair
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

sealed interface AuthState {
    data object SignedOut : AuthState
    data object SignedIn : AuthState
}

/** Single source of truth for tokens, selected workspace and the signed-in user. */
@Singleton
class SessionManager @Inject constructor(
    private val store: SecureTokenStore,
    @ApplicationContext context: Context,
) {
    private val plain = context.getSharedPreferences("relay_session", Context.MODE_PRIVATE)

    @Volatile var accessToken: String? = store.get("at"); private set
    @Volatile var refreshToken: String? = store.get("rt"); private set

    private val _auth = MutableStateFlow<AuthState>(if (refreshToken != null) AuthState.SignedIn else AuthState.SignedOut)
    val auth: StateFlow<AuthState> = _auth.asStateFlow()

    private val _tenantId = MutableStateFlow(plain.getString("tenant", null))
    val tenantId: StateFlow<String?> = _tenantId.asStateFlow()

    private val _me = MutableStateFlow<Me?>(null)
    val me: StateFlow<Me?> = _me.asStateFlow()

    val deviceId: String = plain.getString("device", null) ?: UUID.randomUUID().toString().also { plain.edit().putString("device", it).apply() }

    fun currentMembership(): Membership? = _me.value?.memberships?.firstOrNull { it.tenant.id == _tenantId.value }

    @Synchronized fun saveTokens(t: TokenPair) {
        accessToken = t.accessToken
        refreshToken = t.refreshToken
        store.put("at", t.accessToken)
        store.put("rt", t.refreshToken)
        _auth.value = AuthState.SignedIn
    }

    fun setMe(me: Me) {
        _me.value = me
        val current = _tenantId.value
        if (current == null || me.memberships.none { it.tenant.id == current }) {
            selectTenant(if (me.memberships.size == 1) me.memberships.first().tenant.id else null)
        }
    }

    fun selectTenant(id: String?) {
        _tenantId.value = id
        plain.edit().putString("tenant", id).apply()
    }

    @Synchronized fun signOut() {
        accessToken = null
        refreshToken = null
        store.clear()
        _me.value = null
        _auth.value = AuthState.SignedOut
    }
}
