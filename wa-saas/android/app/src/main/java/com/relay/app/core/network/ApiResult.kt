package com.relay.app.core.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException

/** A stable, user-presentable error. Messages come from the API's error contract. */
class ApiException(val code: String, override val message: String, val status: Int = 0) : Exception(message)

@Serializable private data class ErrorEnvelope(val error: ErrorBody)
@Serializable private data class ErrorBody(val code: String, val message: String, val requestId: String? = null)

private val errJson = Json { ignoreUnknownKeys = true }

fun Throwable.toApiException(): ApiException = when (this) {
    is ApiException -> this
    is HttpException -> {
        val raw = response()?.errorBody()?.string()
        val parsed = raw?.let { runCatching { errJson.decodeFromString<ErrorEnvelope>(it).error }.getOrNull() }
        ApiException(parsed?.code ?: "HTTP_${code()}", parsed?.message ?: "Request failed (${code()}).", code())
    }
    is IOException -> ApiException("NETWORK", "Can’t reach the server. Check your connection and try again.")
    else -> ApiException("UNEXPECTED", "Something went wrong. Try again.")
}

/** Runs an API call and maps every failure to ApiException. Never swallows cancellation. */
suspend fun <T> apiCall(block: suspend () -> T): Result<T> = try {
    Result.success(block())
} catch (c: CancellationException) {
    throw c
} catch (t: Throwable) {
    Result.failure(t.toApiException())
}

/** For endpoints returning 204/empty bodies wrapped in Response<Unit>. */
fun Response<Unit>.orThrow() {
    if (!isSuccessful) throw HttpException(this)
}
