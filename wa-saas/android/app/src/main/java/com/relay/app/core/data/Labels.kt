package com.relay.app.core.data

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

enum class Tone { Good, Warn, Bad, Info, Read, Neutral }
data class StatusLabel(val label: String, val tone: Tone, val help: String = "")

/** Same vocabulary as the web app; labels only claim what evidence supports. */
object Labels {
    val connection = mapOf(
        "created" to StatusLabel("Connecting", Tone.Neutral),
        "waiting_for_qr" to StatusLabel("Waiting for scan", Tone.Info),
        "linking" to StatusLabel("Linking", Tone.Info),
        "connected" to StatusLabel("Connected", Tone.Good),
        "qr_expired" to StatusLabel("QR expired", Tone.Warn),
        "disconnected" to StatusLabel("Disconnected", Tone.Warn),
        "error" to StatusLabel("Needs attention", Tone.Bad),
        "revoked" to StatusLabel("Removed", Tone.Neutral),
    )
    val campaign = mapOf(
        "draft" to StatusLabel("Draft", Tone.Neutral),
        "scheduled" to StatusLabel("Scheduled", Tone.Info),
        "running" to StatusLabel("Sending", Tone.Good),
        "paused" to StatusLabel("Paused", Tone.Warn),
        "completed" to StatusLabel("Finished", Tone.Neutral),
        "cancelled" to StatusLabel("Cancelled", Tone.Neutral),
    )
    val recipient = mapOf(
        "queued" to StatusLabel("Queued", Tone.Neutral, "Waiting for its turn to send."),
        "attempting" to StatusLabel("Attempting", Tone.Info, "Being handed to WhatsApp right now."),
        "submitted" to StatusLabel("Accepted", Tone.Info, "WhatsApp accepted it. Delivery not yet confirmed."),
        "delivered" to StatusLabel("Delivered", Tone.Good, "WhatsApp confirmed it reached the phone."),
        "read" to StatusLabel("Read", Tone.Read, "WhatsApp reported it was opened."),
        "failed" to StatusLabel("Failed", Tone.Bad, "Not sent. See the reason code."),
        "unknown" to StatusLabel("Unknown", Tone.Warn, "We can’t prove whether it was sent. Never retried automatically."),
        "skipped" to StatusLabel("Skipped", Tone.Neutral, "Excluded before sending, e.g. opted out."),
        "cancelled" to StatusLabel("Cancelled", Tone.Neutral, "Campaign cancelled before this send."),
    )
    val pauseReason = mapOf(
        "USER_PAUSED" to "Paused by a teammate.",
        "CONNECTION_NOT_READY" to "Paused because the WhatsApp connection isn’t connected.",
        "CONNECTION_UNHEALTHY" to "Paused because the connection stopped responding.",
        "CONNECTION_REVOKED" to "Paused because the connection was removed.",
        "QUOTA_EXHAUSTED" to "Paused because this month’s message allowance is used up.",
        "DAILY_LIMIT_REACHED" to "Paused because this number reached its daily sending limit. Resume tomorrow, or spread the audience across more numbers.",
    )
    val connector = mapOf("browser" to "WhatsApp (linked device)", "sandbox" to "Sandbox (test only)")
    val role = mapOf("owner" to "Owner", "admin" to "Admin", "editor" to "Editor", "viewer" to "Viewer")

    fun of(map: Map<String, StatusLabel>, key: String) = map[key] ?: StatusLabel(key, Tone.Neutral)
}

object Fmt {
    private val dateTime = DateTimeFormatter.ofPattern("d MMM, h:mm a", Locale.getDefault()).withZone(ZoneId.systemDefault())
    private val date = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.getDefault()).withZone(ZoneId.systemDefault())
    fun dateTime(iso: String?) = iso?.let { runCatching { dateTime.format(Instant.parse(it)) }.getOrNull() } ?: "—"
    fun date(iso: String?) = iso?.let { runCatching { date.format(Instant.parse(it)) }.getOrNull() } ?: "—"
    fun num(n: Int?) = String.format(Locale.getDefault(), "%,d", n ?: 0)
    fun rel(iso: String?): String {
        val t = iso?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return "—"
        val s = (System.currentTimeMillis() - t.toEpochMilli()) / 1000
        return when { s < 60 -> "just now"; s < 3600 -> "${s / 60} min ago"; s < 86400 -> "${s / 3600} h ago"; else -> date(iso) }
    }
}

fun roleRank(role: String?) = when (role) { "owner" -> 4; "admin" -> 3; "editor" -> 2; else -> 1 }
