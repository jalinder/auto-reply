package com.relay.app.feature.auth

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.relay.app.core.network.*
import com.relay.app.core.session.SessionManager
import com.relay.app.ui.components.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class AuthViewModel @Inject constructor(private val api: RelayApi, private val session: SessionManager) : ViewModel() {
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    var done by mutableStateOf(false); private set
    var challengeId by mutableStateOf<String?>(null); private set

    private fun run(block: suspend () -> Unit) = viewModelScope.launch {
        busy = true; error = null
        apiCall { block() }.onSuccess { done = true }.onFailure { error = it.message }
        busy = false
    }

    fun login(email: String, password: String) = run {
        val r = api.login(LoginBody(email.trim(), password, session.deviceId))
        val t = r.tokens()
        if (t != null) session.saveTokens(t) else if (r.otpRequired) challengeId = r.challengeId
    }
    fun verify(code: String) = run { session.saveTokens(api.verifyOtp(VerifyOtpBody(challengeId!!, code))) }
    fun restart() { challengeId = null; error = null }
    fun register(b: RegisterBody) = run { session.saveTokens(api.register(b)) }
    fun forgot(email: String) = run { api.requestReset(EmailBody(email.trim())).orThrow() }
    fun reset(token: String, password: String) = run { api.confirmReset(ResetConfirmBody(token, password)).orThrow() }
}

@Composable
private fun AuthColumn(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().systemBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 24.dp, bottom = 16.dp)) {
            Surface(color = MaterialTheme.colorScheme.primary, shape = MaterialTheme.shapes.small, modifier = Modifier.size(32.dp)) {
                Box(contentAlignment = Alignment.Center) { Text("R", color = MaterialTheme.colorScheme.onPrimary, style = MaterialTheme.typography.titleMedium) }
            }
            Text("Relay", style = MaterialTheme.typography.titleLarge)
        }
        content()
    }
}

@Composable
fun LoginScreen(onRegister: () -> Unit, onForgot: () -> Unit, vm: AuthViewModel = hiltViewModel()) {
    var email by remember { mutableStateOf("") }
    var pw by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    if (vm.challengeId != null) {
        AuthColumn {
            Text("Check your email", style = MaterialTheme.typography.headlineMedium)
            MetaText("We sent a 6-digit sign-in code to $email. It expires in 5 minutes.")
            ErrorText(vm.error)
            FormField(code, { code = it.filter(Char::isDigit).take(6) }, "Sign-in code", keyboard = KeyboardType.NumberPassword)
            BusyButton("Verify and sign in", { vm.verify(code) }, Modifier.fillMaxWidth(), busy = vm.busy, enabled = code.length == 6)
            TextButton(onClick = { code = ""; pw = ""; vm.restart() }) { Text("Use a different account") }
        }
        return
    }
    AuthColumn {
        Text("Sign in", style = MaterialTheme.typography.headlineMedium)
        MetaText("Consent and opt-outs are checked before every send. Reports only say “delivered” when WhatsApp confirms it.")
        ErrorText(vm.error)
        FormField(email, { email = it }, "Work email", keyboard = KeyboardType.Email)
        FormField(pw, { pw = it }, "Password", password = true)
        BusyButton("Sign in", { vm.login(email, pw) }, Modifier.fillMaxWidth(), busy = vm.busy, enabled = email.isNotBlank() && pw.isNotEmpty())
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = onForgot) { Text("Forgot password?") }
            TextButton(onClick = onRegister) { Text("Create an account") }
        }
    }
}

@Composable
fun RegisterScreen(onBack: () -> Unit, vm: AuthViewModel = hiltViewModel()) {
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var pw by remember { mutableStateOf("") }
    var ws by remember { mutableStateOf("") }
    var agree by remember { mutableStateOf(false) }
    val pwOk = pw.length >= 10 && pw.any { it.isLetter() } && pw.any { it.isDigit() }
    AuthColumn {
        Text("Create your account", style = MaterialTheme.typography.headlineMedium)
        ErrorText(vm.error)
        FormField(name, { name = it }, "Your name")
        FormField(email, { email = it }, "Work email", keyboard = KeyboardType.Email)
        FormField(pw, { pw = it }, "Password", password = true, hint = "At least 10 characters, with a letter and a number.", error = if (pw.isNotEmpty() && !pwOk) "At least 10 characters, with a letter and a number." else null)
        FormField(ws, { ws = it }, "Business name", hint = "Your first workspace. You can add more later.")
        Row(verticalAlignment = Alignment.Top) {
            Checkbox(agree, { agree = it })
            Text("I agree to the Terms and Privacy notice, and I’ll only message people who agreed to hear from my business.", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 12.dp))
        }
        BusyButton("Create account", { vm.register(RegisterBody(email.trim(), pw, name.trim(), ws.trim())) }, Modifier.fillMaxWidth(), busy = vm.busy,
            enabled = agree && pwOk && name.isNotBlank() && email.isNotBlank() && ws.length >= 2)
        TextButton(onClick = onBack) { Text("I already have an account") }
    }
}

@Composable
fun ForgotPasswordScreen(onBack: () -> Unit, vm: AuthViewModel = hiltViewModel()) {
    var email by remember { mutableStateOf("") }
    AuthColumn {
        if (vm.done) {
            Text("Check your email", style = MaterialTheme.typography.headlineMedium)
            Text("If an account exists for $email, we sent a link to reset your password. It expires in 30 minutes.")
            TextButton(onClick = onBack) { Text("Back to sign in") }
        } else {
            Text("Reset your password", style = MaterialTheme.typography.headlineMedium)
            ErrorText(vm.error)
            FormField(email, { email = it }, "Work email", keyboard = KeyboardType.Email)
            BusyButton("Send reset link", { vm.forgot(email) }, Modifier.fillMaxWidth(), busy = vm.busy, enabled = email.isNotBlank())
            TextButton(onClick = onBack) { Text("Back to sign in") }
        }
    }
}

@Composable
fun ResetPasswordScreen(token: String, onDone: () -> Unit, vm: AuthViewModel = hiltViewModel()) {
    var pw by remember { mutableStateOf("") }
    AuthColumn {
        if (vm.done) {
            Text("Password updated", style = MaterialTheme.typography.headlineMedium)
            Text("You’ve been signed out on other devices. Sign in with your new password.")
            BusyButton("Sign in", onDone, Modifier.fillMaxWidth())
        } else {
            Text("Choose a new password", style = MaterialTheme.typography.headlineMedium)
            ErrorText(vm.error)
            FormField(pw, { pw = it }, "New password", password = true, hint = "At least 10 characters, with a letter and a number.")
            BusyButton("Save password", { vm.reset(token, pw) }, Modifier.fillMaxWidth(), busy = vm.busy, enabled = token.isNotEmpty() && pw.length >= 10)
        }
    }
}
