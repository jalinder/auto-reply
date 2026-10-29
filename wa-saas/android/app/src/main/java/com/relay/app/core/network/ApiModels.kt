package com.relay.app.core.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

// ---------- Auth ----------
@Serializable data class TokenPair(val accessToken: String, val refreshToken: String, val expiresIn: Int)
/** Login returns tokens, or a challenge when the account uses email sign-in codes. */
@Serializable data class LoginResponse(
    val accessToken: String? = null, val refreshToken: String? = null, val expiresIn: Int? = null,
    val otpRequired: Boolean = false, val challengeId: String? = null,
) {
    fun tokens(): TokenPair? = if (accessToken != null && refreshToken != null) TokenPair(accessToken, refreshToken, expiresIn ?: 900) else null
}
@Serializable data class VerifyOtpBody(val challengeId: String, val code: String)
@Serializable data class TwoFactorBody(val enabled: Boolean)
@Serializable data class LoginBody(val email: String, val password: String, val deviceId: String? = null)
@Serializable data class RegisterBody(val email: String, val password: String, val name: String, val workspaceName: String)
@Serializable data class RefreshBody(val refreshToken: String)
@Serializable data class PasswordBody(val password: String)
@Serializable data class EmailBody(val email: String)
@Serializable data class ResetConfirmBody(val token: String, val password: String)
@Serializable data class ChangePasswordBody(val currentPassword: String, val newPassword: String)
@Serializable data class StepUpResponse(val stepUpToken: String, val expiresIn: Int)

@Serializable data class UserDto(val id: String, val email: String, val name: String, val twoFactorEnabled: Boolean = false)
@Serializable data class TenantDto(val id: String, val name: String, val slug: String, val planId: String)
@Serializable data class Membership(val tenant: TenantDto, val role: String)
@Serializable data class Me(val user: UserDto, val memberships: List<Membership>)
@Serializable data class NameBody(val name: String)
@Serializable data class CreatedTenant(val tenant: TenantDto, val role: String)

// ---------- Dashboard ----------
@Serializable data class Dashboard(
    val connections: ConnSummary, val contacts: Int, val optOuts: Int, val activeCampaigns: Int,
    val messages: MessageUsage, val last7Days: List<DayStats>, val recentCampaigns: List<RecentCampaign>,
)
@Serializable data class ConnSummary(val total: Int, val connected: Int, val needsAttention: Int)
@Serializable data class MessageUsage(val used: Int, val limit: Int)
@Serializable data class DayStats(val day: String, val submitted: Int, val delivered: Int, val read: Int, val failed: Int, val unknown: Int)
@Serializable data class RecentCampaign(val id: String, val name: String, val status: String, val recipientCount: Int, val createdAt: String)

// ---------- Connections ----------
@Serializable data class Capabilities(
    val qrLinking: Boolean = false, val templates: Boolean = false, val media: List<String> = emptyList(),
    val deliveryReceipts: Boolean = false, val readReceipts: Boolean = false, val freeformRequiresOpenWindow: Boolean = false,
)
@Serializable data class Connection(
    val id: String, val label: String, val connectorType: String, val status: String,
    val maskedAccount: String? = null, val connectedAt: String? = null, val lastSeenAt: String? = null,
    val lastErrorCode: String? = null, val qrExpiresAt: String? = null, val capabilities: Capabilities? = null, val createdAt: String,
)
@Serializable data class ConnectorType(val type: String, val enabled: Boolean)
@Serializable data class CreateConnectionBody(val connectorType: String, val label: String)
@Serializable data class PhoneBody(val phone: String)
@Serializable data class PairingCode(val code: String, val expiresInSeconds: Int = 180)
@Serializable data class QrResponse(val payload: String, val expiresAt: String, val ttlSeconds: Int)
@Serializable data class ConnectionEvent(val id: String, val eventType: String, val createdAt: String)
@Serializable data class WaTemplate(
    val name: String, val language: String, val status: String, val category: String,
    val bodyText: String = "", val headerFormat: String? = null, val paramCount: Int = 0,
)

// ---------- Contacts ----------
@Serializable data class Consent(val id: String, val purpose: String, val source: String, val capturedAt: String)
@Serializable data class HistoryItem(val campaignId: String, val campaignName: String, val status: String, val updatedAt: String)
@Serializable data class Contact(
    val id: String, val phone: String, val displayName: String? = null, val customFields: Map<String, String> = emptyMap(),
    val tags: List<String> = emptyList(), val status: String, val optedOut: Boolean = false,
    val consents: List<Consent> = emptyList(), val createdAt: String, val history: List<HistoryItem>? = null,
)
@Serializable data class ConsentBody(val purpose: String, val source: String)
@Serializable data class CreateContactBody(
    val phone: String, val displayName: String? = null, val tags: List<String> = emptyList(),
    val customFields: Map<String, String> = emptyMap(), val consent: ConsentBody? = null, val defaultCountry: String? = null,
)
@Serializable data class UpdateContactBody(val displayName: String? = null, val tags: List<String>? = null, val status: String? = null)
@Serializable data class TagCount(val tag: String, val count: Int)
@Serializable data class OptOut(val id: String, val phone: String, val reason: String? = null, val source: String, val createdAt: String)
@Serializable data class OptOutBody(val phone: String, val reason: String? = null)

@Serializable data class UploadUrlBody(val fileName: String, val mimeType: String, val sizeBytes: Long, val purpose: String)
@Serializable data class UploadSlot(val mediaId: String, val uploadUrl: String, val headers: Map<String, String> = emptyMap())
@Serializable data class MediaAsset(val id: String, val fileName: String, val mimeType: String, val sizeBytes: Long, val status: String)
@Serializable data class MediaIdBody(val mediaId: String)
@Serializable data class SuggestedMapping(val phone: String? = null, val name: String? = null, val tags: String? = null)
@Serializable data class ImportPreview(val headers: List<String>, val sampleRows: List<Map<String, String>>, val suggestedMapping: SuggestedMapping)
@Serializable data class ImportMapping(val phone: String, val name: String? = null, val tags: String? = null, val fields: Map<String, String> = emptyMap())
@Serializable data class StartImportBody(
    val mediaId: String, val mapping: ImportMapping, val defaultCountry: String = "IN",
    val addTags: List<String> = emptyList(), val consent: ConsentBody? = null,
)
@Serializable data class ImportError(val row: Int, val phone: String, val reason: String)
@Serializable data class ImportJob(
    val id: String, val status: String, val rowCount: Int = 0, val createdCount: Int = 0, val updatedCount: Int = 0,
    val invalidCount: Int = 0, val duplicateCount: Int = 0, val optedOutCount: Int = 0, val hasErrorFile: Boolean = false,
    val errorSample: List<ImportError> = emptyList(),
)

// ---------- Campaigns ----------
@Serializable data class Audience(
    val type: String = "all", val tags: List<String>? = null, val contactIds: List<String>? = null,
    val requireConsent: Boolean = true, val consentPurpose: String = "marketing",
)
@Serializable data class CampaignConnection(val id: String, val label: String, val status: String, val connectorType: String)
@Serializable data class Campaign(
    val id: String, val name: String, val status: String, val pausedReason: String? = null, val connectionId: String,
    val connection: CampaignConnection? = null, val messageType: String, val body: String? = null,
    val templateName: String? = null, val templateLanguage: String? = null, val templateParams: List<String> = emptyList(),
    val mediaId: String? = null, val audience: Audience = Audience(), val scheduledAt: String? = null,
    val launchedAt: String? = null, val completedAt: String? = null, val recipientCount: Int = 0,
    val counts: Map<String, Int>? = null, val createdAt: String,
)
@Serializable data class CampaignBody(
    val name: String, val connectionId: String, val messageType: String, val body: String? = null,
    val templateName: String? = null, val templateLanguage: String? = null, val templateParams: List<String>? = null,
    val mediaId: String? = null, val audience: Audience, val scheduledAt: String? = null,
)
@Serializable data class Excluded(val optedOut: Int, val noConsent: Int, val blocked: Int)
@Serializable data class PreviewAudience(val selected: Int, val eligible: Int, val excluded: Excluded)
@Serializable data class PreviewContact(val id: String, val displayName: String? = null, val phone: String)
@Serializable data class PreviewSample(val contact: PreviewContact, val rendered: String, val missing: List<String> = emptyList())
@Serializable data class PreviewConnection(val id: String, val label: String, val status: String, val maskedAccount: String? = null)
@Serializable data class CampaignPreview(
    val audience: PreviewAudience, val placeholders: List<String> = emptyList(), val samples: List<PreviewSample> = emptyList(),
    val errors: List<String> = emptyList(), val warnings: List<String> = emptyList(), val canLaunch: Boolean,
    val messagesRemaining: Int, val connection: PreviewConnection,
)
@Serializable data class LaunchBody(val confirm: Boolean, val expectedRecipientCount: Int)
@Serializable data class RecipientRow(
    val id: String, val phone: String, val displayName: String? = null, val status: String, val attemptCount: Int = 0,
    val lastErrorCode: String? = null, val updatedAt: String,
)
@Serializable data class Report(val counts: Map<String, Int>, val items: List<RecipientRow>, val nextCursor: String? = null)
@Serializable data class TimelineRecipient(val id: String, val phone: String, val status: String, val renderedBody: String? = null, val renderedParams: List<String>? = null)
@Serializable data class TimelineEvent(val id: String, val eventType: String, val source: String, val occurredAt: String, val detail: String? = null)
@Serializable data class Timeline(val recipient: TimelineRecipient, val items: List<TimelineEvent>)

// ---------- Direct messages ----------
@Serializable data class SendMessageBody(
    val to: String, val text: String? = null, val mediaId: String? = null,
    val connectionId: String? = null, val defaultCountry: String? = null,
)
/** One-off send. `id` is the message id; status follows the same ladder as a campaign recipient. */
@Serializable data class DirectMessage(
    val id: String, val campaignId: String, val connectionId: String, val to: String,
    val text: String? = null, val mediaId: String? = null, val status: String, val attemptCount: Int = 0,
    val lastErrorCode: String? = null, val submittedAt: String? = null, val deliveredAt: String? = null,
    val readAt: String? = null, val failedAt: String? = null, val createdAt: String, val updatedAt: String,
) {
    val settled get() = status in setOf("delivered", "read", "failed", "skipped", "cancelled", "unknown")
}

// ---------- Team, billing, audit ----------
@Serializable data class Member(val userId: String, val email: String, val name: String, val role: String, val pending: Boolean, val joinedAt: String)
@Serializable data class InviteBody(val email: String, val role: String)
@Serializable data class RoleBody(val role: String)
@Serializable data class PlanLimits(val messagesPerMonth: Int, val connections: Int, val contacts: Int, val members: Int)
@Serializable data class Plan(val id: String, val name: String, val priceInrMonthly: Int, val limits: PlanLimits)
@Serializable data class Usage(val messages: Int, val connections: Int, val contacts: Int, val members: Int, val periodEnd: String)
@Serializable data class SubscriptionDto(val planId: String, val status: String, val periodEnd: String? = null)
@Serializable data class Billing(val plan: Plan, val plans: List<Plan>, val usage: Usage, val subscription: SubscriptionDto? = null)
@Serializable data class PlanBody(val planId: String)
@Serializable data class Invoice(val id: String, val amount: Double, val currency: String, val status: String, val issuedAt: String? = null, val url: String? = null)
@Serializable data class Checkout(val checkoutUrl: String)
@Serializable data class AuditActor(val name: String, val email: String)
@Serializable data class AuditLog(val id: String, val action: String, val resourceType: String, val actor: AuditActor? = null, val createdAt: String, val metadata: JsonElement? = null)

@Serializable data class Page<T>(val items: List<T>, val nextCursor: String? = null, val total: Int? = null)
@Serializable data class Items<T>(val items: List<T>)
@Serializable data class UrlResponse(val url: String)
