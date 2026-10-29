package com.relay.app.core.network

import com.relay.app.BuildConfig
import com.relay.app.core.session.SessionManager
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.Authenticator
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.Route
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Named
import javax.inject.Singleton

val RelayJson = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true; encodeDefaults = true }

/** Adds bearer token, workspace header and a request id. */
class AuthHeaderInterceptor(private val session: SessionManager) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val b = chain.request().newBuilder()
        session.accessToken?.let { b.header("Authorization", "Bearer $it") }
        session.tenantId.value?.let { b.header("X-Tenant-Id", it) }
        b.header("X-Request-Id", "and_" + java.util.UUID.randomUUID().toString().replace("-", "").take(16))
        return chain.proceed(b.build())
    }
}

/**
 * On 401, rotates the refresh token once (serialized across threads) and retries.
 * If rotation fails (revoked, reused, expired) the session is cleared and the UI returns to sign-in.
 */
class TokenRefreshAuthenticator(private val session: SessionManager, private val refreshClient: OkHttpClient) : Authenticator {
    private val lock = Any()

    override fun authenticate(route: Route?, response: Response): Request? {
        if (response.request.url.encodedPath.contains("/v1/auth/")) return null
        if (responseCount(response) >= 2) return null
        val failedToken = response.request.header("Authorization")?.removePrefix("Bearer ")
        synchronized(lock) {
            val current = session.accessToken
            if (current != null && current != failedToken) return withToken(response.request, current) // another thread refreshed
            val rt = session.refreshToken ?: return null.also { session.signOut() }
            val body = RelayJson.encodeToString(RefreshBody.serializer(), RefreshBody(rt)).toRequestBody("application/json".toMediaType())
            val req = Request.Builder().url(BuildConfig.API_BASE_URL + "v1/auth/refresh").post(body).build()
            return try {
                refreshClient.newCall(req).execute().use { r ->
                    if (!r.isSuccessful) { session.signOut(); return null }
                    val pair = RelayJson.decodeFromString(TokenPair.serializer(), r.body!!.string())
                    session.saveTokens(pair)
                    withToken(response.request, pair.accessToken)
                }
            } catch (e: Exception) {
                null // network error: keep session, surface the 401 to the caller
            }
        }
    }

    private fun withToken(r: Request, token: String) = r.newBuilder().header("Authorization", "Bearer $token").build()
    private fun responseCount(r: Response): Int { var c = 1; var p = r.priorResponse; while (p != null) { c++; p = p.priorResponse }; return c }
}

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {
    @Provides @Singleton @Named("base")
    fun baseClient(): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    @Provides @Singleton @Named("api")
    fun apiClient(@Named("base") base: OkHttpClient, session: SessionManager): OkHttpClient {
        val b = base.newBuilder()
            .addInterceptor(AuthHeaderInterceptor(session))
            .authenticator(TokenRefreshAuthenticator(session, base))
        if (BuildConfig.DEBUG) {
            val logging = Class.forName("okhttp3.logging.HttpLoggingInterceptor").getDeclaredConstructor().newInstance() as Interceptor
            val levelClass = Class.forName("okhttp3.logging.HttpLoggingInterceptor\$Level")
            logging.javaClass.getMethod("setLevel", levelClass).invoke(logging, levelClass.getField("BASIC").get(null))
            logging.javaClass.getMethod("redactHeader", String::class.java).apply {
                invoke(logging, "Authorization"); invoke(logging, "X-Step-Up-Token")
            }
            b.addInterceptor(logging)
        }
        return b.build()
    }

    @Provides @Singleton
    fun retrofit(@Named("api") client: OkHttpClient): Retrofit = Retrofit.Builder()
        .baseUrl(BuildConfig.API_BASE_URL)
        .client(client)
        .addConverterFactory(RelayJson.asConverterFactory("application/json".toMediaType()))
        .build()

    @Provides @Singleton
    fun api(retrofit: Retrofit): RelayApi = retrofit.create(RelayApi::class.java)
}
