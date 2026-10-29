package com.relay.app.core.network

import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.*

/** Mirrors the backend /v1 API. Tenant and auth headers are added by interceptors. */
interface RelayApi {
    // Auth
    @POST("v1/auth/login") suspend fun login(@Body b: LoginBody): LoginResponse
    @POST("v1/auth/login/verify") suspend fun verifyOtp(@Body b: VerifyOtpBody): TokenPair
    @POST("v1/auth/2fa") suspend fun setTwoFactor(@Header("X-Step-Up-Token") stepUp: String?, @Body b: TwoFactorBody): Response<Unit>
    @POST("v1/auth/register") suspend fun register(@Body b: RegisterBody): TokenPair
    @POST("v1/auth/logout") suspend fun logout(@Body b: RefreshBody): Response<Unit>
    @POST("v1/auth/logout-all") suspend fun logoutAll(): Response<Unit>
    @POST("v1/auth/step-up") suspend fun stepUp(@Body b: PasswordBody): StepUpResponse
    @POST("v1/auth/password-reset/request") suspend fun requestReset(@Body b: EmailBody): Response<Unit>
    @POST("v1/auth/password-reset/confirm") suspend fun confirmReset(@Body b: ResetConfirmBody): Response<Unit>
    @POST("v1/auth/change-password") suspend fun changePassword(@Body b: ChangePasswordBody): Response<Unit>
    @GET("v1/me") suspend fun me(): Me
    @DELETE("v1/me") suspend fun deleteMe(@Header("X-Step-Up-Token") stepUp: String?): Response<Unit>

    // Workspaces & team
    @POST("v1/tenants") suspend fun createTenant(@Body b: NameBody): CreatedTenant
    @PATCH("v1/tenants/current") suspend fun renameTenant(@Body b: NameBody): Response<Unit>
    @DELETE("v1/tenants/current") suspend fun deleteTenant(@Header("X-Step-Up-Token") stepUp: String?): Response<Unit>
    @GET("v1/members") suspend fun members(): Items<Member>
    @POST("v1/members") suspend fun invite(@Body b: InviteBody): Response<Unit>
    @PATCH("v1/members/{id}") suspend fun changeRole(@Path("id") userId: String, @Body b: RoleBody): Response<Unit>
    @DELETE("v1/members/{id}") suspend fun removeMember(@Path("id") userId: String): Response<Unit>
    @GET("v1/audit-logs") suspend fun audit(@Query("cursor") cursor: String? = null, @Query("limit") limit: Int = 50): Page<AuditLog>
    @GET("v1/dashboard") suspend fun dashboard(): Dashboard

    // Connections
    @GET("v1/connections") suspend fun connections(): Items<Connection>
    @GET("v1/connections/types") suspend fun connectorTypes(): Items<ConnectorType>
    @POST("v1/connections") suspend fun createConnection(@Header("Idempotency-Key") key: String, @Body b: CreateConnectionBody): Connection
    @GET("v1/connections/{id}") suspend fun connection(@Path("id") id: String): Connection
    @GET("v1/connections/{id}/qr") suspend fun qr(@Path("id") id: String): QrResponse
    @POST("v1/connections/{id}/refresh-qr") suspend fun refreshQr(@Path("id") id: String): Connection
    @POST("v1/connections/{id}/cancel") suspend fun cancelLinking(@Path("id") id: String): Connection
    @POST("v1/connections/{id}/pairing-code") suspend fun pairingCode(@Path("id") id: String, @Body b: PhoneBody): PairingCode
    @POST("v1/connections/{id}/sandbox/scan") suspend fun sandboxScan(@Path("id") id: String): Connection
    @DELETE("v1/connections/{id}") suspend fun revokeConnection(@Path("id") id: String, @Header("X-Step-Up-Token") stepUp: String?): Connection
    @GET("v1/connections/{id}/events") suspend fun connectionEvents(@Path("id") id: String): Items<ConnectionEvent>

    // Media
    @POST("v1/media/upload-url") suspend fun uploadUrl(@Body b: UploadUrlBody): UploadSlot
    @POST("v1/media/{id}/complete") suspend fun completeUpload(@Path("id") id: String): MediaAsset

    // Contacts
    @GET("v1/contacts") suspend fun contacts(@Query("search") search: String?, @Query("tag") tag: String?, @Query("cursor") cursor: String?, @Query("limit") limit: Int = 50): Page<Contact>
    @GET("v1/contacts/tags") suspend fun tags(): Items<TagCount>
    @POST("v1/contacts") suspend fun createContact(@Body b: CreateContactBody): Contact
    @GET("v1/contacts/{id}") suspend fun contact(@Path("id") id: String): Contact
    @PATCH("v1/contacts/{id}") suspend fun updateContact(@Path("id") id: String, @Body b: UpdateContactBody): Contact
    @DELETE("v1/contacts/{id}") suspend fun deleteContact(@Path("id") id: String): Response<Unit>
    @POST("v1/contacts/{id}/consent") suspend fun addConsent(@Path("id") id: String, @Body b: ConsentBody): Contact
    @DELETE("v1/contacts/{id}/consent/{cid}") suspend fun revokeConsent(@Path("id") id: String, @Path("cid") consentId: String): Contact
    @POST("v1/contacts/import/preview") suspend fun importPreview(@Body b: MediaIdBody): ImportPreview
    @POST("v1/contacts/import") suspend fun startImport(@Body b: StartImportBody): ImportJob
    @GET("v1/contacts/imports/{id}") suspend fun importJob(@Path("id") id: String): ImportJob
    @Streaming @GET("v1/contacts-export") suspend fun exportContacts(@Header("X-Step-Up-Token") stepUp: String?): ResponseBody
    @GET("v1/opt-outs") suspend fun optOuts(@Query("cursor") cursor: String? = null, @Query("limit") limit: Int = 100): Page<OptOut>
    @POST("v1/opt-outs") suspend fun addOptOut(@Body b: OptOutBody): OptOut
    @DELETE("v1/opt-outs/{id}") suspend fun removeOptOut(@Path("id") id: String): Response<Unit>

    // Campaigns
    @GET("v1/campaigns") suspend fun campaigns(@Query("status") status: String?, @Query("cursor") cursor: String? = null, @Query("limit") limit: Int = 30): Page<Campaign>
    @POST("v1/campaigns") suspend fun createCampaign(@Body b: CampaignBody): Campaign
    @GET("v1/campaigns/{id}") suspend fun campaign(@Path("id") id: String): Campaign
    @PATCH("v1/campaigns/{id}") suspend fun updateCampaign(@Path("id") id: String, @Body b: CampaignBody): Campaign
    @DELETE("v1/campaigns/{id}") suspend fun deleteCampaign(@Path("id") id: String): Response<Unit>
    @POST("v1/campaigns/{id}/preview") suspend fun preview(@Path("id") id: String): CampaignPreview
    @POST("v1/campaigns/{id}/launch") suspend fun launch(@Path("id") id: String, @Header("Idempotency-Key") key: String, @Body b: LaunchBody): Campaign
    @POST("v1/campaigns/{id}/pause") suspend fun pause(@Path("id") id: String): Campaign
    @POST("v1/campaigns/{id}/resume") suspend fun resume(@Path("id") id: String): Campaign
    @POST("v1/campaigns/{id}/cancel") suspend fun cancel(@Path("id") id: String): Campaign
    @GET("v1/campaigns/{id}/report") suspend fun report(@Path("id") id: String, @Query("status") status: String?, @Query("search") search: String?, @Query("cursor") cursor: String? = null, @Query("limit") limit: Int = 50): Report
    @GET("v1/campaigns/{id}/recipients/{rid}/events") suspend fun timeline(@Path("id") id: String, @Path("rid") rid: String): Timeline

    // Direct messages (one-off sends)
    @POST("v1/messages") suspend fun sendMessage(@Header("Idempotency-Key") key: String, @Body b: SendMessageBody): DirectMessage
    @GET("v1/messages/{id}") suspend fun message(@Path("id") id: String): DirectMessage

    // Billing
    @GET("v1/billing") suspend fun billing(): Billing
    @GET("v1/billing/invoices") suspend fun invoices(): Items<Invoice>
    @POST("v1/billing/subscribe") suspend fun subscribe(@Header("X-Step-Up-Token") stepUp: String?, @Body b: PlanBody): Checkout
    @POST("v1/billing/cancel") suspend fun cancelSubscription(@Header("X-Step-Up-Token") stepUp: String?): Response<Unit>
}
