package com.relay.app.core.data

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import com.relay.app.core.network.ApiException
import com.relay.app.core.network.MediaAsset
import com.relay.app.core.network.RelayApi
import com.relay.app.core.network.UploadUrlBody
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import okio.source
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton

/** Uploads a user-picked file straight to private storage via a short-lived signed URL. */
@Singleton
class Uploader @Inject constructor(
    @ApplicationContext private val context: Context,
    private val api: RelayApi,
    @Named("base") private val plain: OkHttpClient,
) {
    suspend fun upload(uri: Uri, purpose: String, onProgress: (Int) -> Unit = {}): MediaAsset = withContext(Dispatchers.IO) {
        val cr = context.contentResolver
        var name = "upload"
        var size = -1L
        cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) { name = c.getString(0) ?: name; size = c.getLong(1) }
        }
        if (size <= 0) throw ApiException("UPLOAD_FAILED", "Couldn’t read that file.")
        val mime = cr.getType(uri)?.let { if (it == "text/comma-separated-values") "text/csv" else it }
            ?: when { name.endsWith(".csv", true) -> "text/csv"; name.endsWith(".xlsx", true) -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; else -> "application/octet-stream" }

        val slot = api.uploadUrl(UploadUrlBody(name, mime, size, purpose))
        val body = object : RequestBody() {
            override fun contentType() = mime.toMediaTypeOrNull()
            override fun contentLength() = size
            override fun writeTo(sink: BufferedSink) {
                cr.openInputStream(uri)!!.source().use { src ->
                    var written = 0L
                    while (true) {
                        val n = src.read(sink.buffer, 64 * 1024)
                        if (n == -1L) break
                        sink.flush()
                        written += n
                        onProgress(((written * 100) / size).toInt())
                    }
                }
            }
        }
        val req = Request.Builder().url(slot.uploadUrl).put(body).apply { slot.headers.forEach { (k, v) -> header(k, v) } }.build()
        plain.newCall(req).execute().use { if (!it.isSuccessful) throw ApiException("UPLOAD_FAILED", "Upload failed. Try again.") }
        api.completeUpload(slot.mediaId)
    }
}
