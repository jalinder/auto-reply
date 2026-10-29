package com.relay.app.ui.components

import android.graphics.Bitmap
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import com.relay.app.core.data.Fmt
import com.relay.app.core.data.Labels
import com.relay.app.core.data.StatusLabel
import com.relay.app.core.data.Tone
import com.relay.app.ui.theme.LocalStatusColors

@Composable
fun Panel(modifier: Modifier = Modifier, padding: PaddingValues = PaddingValues(16.dp), content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.medium)
            .background(MaterialTheme.colorScheme.surface)
            .border(1.dp, LocalStatusColors.current.line, MaterialTheme.shapes.medium)
            .padding(padding),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        content = content,
    )
}

@Composable
fun StatusPill(s: StatusLabel, modifier: Modifier = Modifier) {
    val c = LocalStatusColors.current
    val (bg, fg) = when (s.tone) {
        Tone.Good -> c.goodSoft to c.delivered
        Tone.Warn -> c.warnSoft to c.unknown
        Tone.Bad -> c.badSoft to c.failed
        Tone.Info -> MaterialTheme.colorScheme.surfaceVariant to c.submitted
        Tone.Read -> MaterialTheme.colorScheme.surfaceVariant to c.read
        Tone.Neutral -> MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Row(
        modifier.clip(RoundedCornerShape(50)).background(bg).padding(horizontal = 9.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(Modifier.size(7.dp).clip(CircleShape).background(fg))
        Text(s.label, style = MaterialTheme.typography.labelMedium, color = fg)
    }
}

private val LADDER = listOf("read", "delivered", "submitted", "queued", "unknown", "failed", "skipped")

@Composable
fun ladderColor(k: String): Color = LocalStatusColors.current.let {
    when (k) { "read" -> it.read; "delivered" -> it.delivered; "submitted" -> it.submitted; "failed" -> it.failed; "unknown" -> it.unknown; "skipped" -> it.skipped; else -> it.queued }
}

/** Evidence ladder: each recipient sits in one segment, at the highest status we can prove. */
@Composable
fun EvidenceLadder(counts: Map<String, Int>?, big: Boolean = false, selected: String? = null, onSelect: ((String?) -> Unit)? = null) {
    val c = (counts ?: emptyMap()).toMutableMap()
    c["queued"] = (c["queued"] ?: 0) + (c["attempting"] ?: 0)
    c["skipped"] = (c["skipped"] ?: 0) + (c["cancelled"] ?: 0)
    val total = LADDER.sumOf { c[it] ?: 0 }
    val desc = LADDER.joinToString { "${Labels.of(Labels.recipient, it).label} ${c[it] ?: 0}" }
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(
            Modifier.fillMaxWidth().height(if (big) 30.dp else 12.dp).clip(RoundedCornerShape(if (big) 8.dp else 4.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant).semantics { contentDescription = desc },
            horizontalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            if (total > 0) LADDER.forEach { k ->
                val v = c[k] ?: 0
                if (v > 0) key(k) {
                    val w by animateFloatAsState(v.toFloat(), label = "seg-$k")
                    Box(Modifier.weight(w.coerceAtLeast(0.001f)).fillMaxHeight().background(ladderColor(k)))
                }
            }
        }
        if (big) {
            val rows = LADDER.chunked(4)
            rows.forEach { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    row.forEach { k ->
                        val on = selected == k
                        Column(
                            Modifier.weight(1f).clip(MaterialTheme.shapes.small)
                                .background(if (on) MaterialTheme.colorScheme.surfaceVariant else Color.Transparent)
                                .clickable(enabled = onSelect != null) { onSelect?.invoke(if (on) null else k) }
                                .padding(8.dp),
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Box(Modifier.size(9.dp).clip(RoundedCornerShape(2.dp)).background(ladderColor(k)))
                                Text(Labels.of(Labels.recipient, k).label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                            }
                            Text(Fmt.num(c[k]), style = MaterialTheme.typography.titleLarge)
                        }
                    }
                    repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
}

@Composable
fun UsageBar(used: Int, limit: Int) {
    val pct = (used.toFloat() / limit.coerceAtLeast(1)).coerceIn(0f, 1f)
    val c = LocalStatusColors.current
    Box(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)).background(MaterialTheme.colorScheme.surfaceVariant)) {
        Box(Modifier.fillMaxWidth(pct).fillMaxHeight().background(if (pct > 0.9f) c.failed else c.delivered))
    }
}

enum class CalloutKind { Warn, Bad, Good }

@Composable
fun Callout(text: String, kind: CalloutKind = CalloutKind.Warn, action: (@Composable () -> Unit)? = null) {
    val c = LocalStatusColors.current
    val (bar, bg) = when (kind) { CalloutKind.Warn -> c.unknown to c.warnSoft; CalloutKind.Bad -> c.failed to c.badSoft; CalloutKind.Good -> c.delivered to c.goodSoft }
    Row(Modifier.fillMaxWidth().clip(MaterialTheme.shapes.small).background(bg).height(IntrinsicSize.Min)) {
        Box(Modifier.width(3.dp).fillMaxHeight().background(bar))
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(text, style = MaterialTheme.typography.bodyMedium)
            action?.invoke()
        }
    }
}

@Composable
fun ErrorText(message: String?) {
    if (message != null) Callout(message, CalloutKind.Bad)
}

@Composable
fun LoadingBox(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(strokeWidth = 3.dp) }
}

@Composable
fun EmptyState(title: String, body: String, action: (@Composable () -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().padding(vertical = 40.dp, horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.titleLarge)
        Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        action?.let { Spacer(Modifier.height(8.dp)); it() }
    }
}

@Composable
fun BusyButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, busy: Boolean = false, enabled: Boolean = true, danger: Boolean = false) {
    Button(
        onClick = onClick, enabled = enabled && !busy, modifier = modifier.heightIn(min = 46.dp),
        shape = MaterialTheme.shapes.small,
        colors = if (danger) ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error) else ButtonDefaults.buttonColors(),
    ) {
        if (busy) { CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = LocalContentColor.current); Spacer(Modifier.width(10.dp)) }
        Text(text)
    }
}

@Composable
fun SecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    OutlinedButton(onClick = onClick, enabled = enabled, modifier = modifier.heightIn(min = 46.dp), shape = MaterialTheme.shapes.small) { Text(text) }
}

@Composable
fun FormField(
    value: String, onValueChange: (String) -> Unit, label: String, modifier: Modifier = Modifier,
    hint: String? = null, error: String? = null, password: Boolean = false, keyboard: KeyboardType = KeyboardType.Text,
    singleLine: Boolean = true, minLines: Int = 1, enabled: Boolean = true,
) {
    OutlinedTextField(
        value = value, onValueChange = onValueChange, label = { Text(label) }, modifier = modifier.fillMaxWidth(),
        supportingText = (error ?: hint)?.let { { Text(it) } }, isError = error != null, singleLine = singleLine, minLines = minLines,
        enabled = enabled, shape = MaterialTheme.shapes.small,
        visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else keyboard),
    )
}

@Composable
fun ChoiceCard(title: String, body: String?, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = LocalStatusColors.current
    Column(
        modifier.fillMaxWidth().clip(MaterialTheme.shapes.medium)
            .background(if (selected) c.goodSoft else MaterialTheme.colorScheme.surface)
            .border(if (selected) 2.dp else 1.dp, if (selected) MaterialTheme.colorScheme.primary else c.line, MaterialTheme.shapes.medium)
            .clickable(onClick = onClick).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(title, style = MaterialTheme.typography.titleSmall)
        body?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

@Composable
fun ConfirmDialog(
    title: String, body: String, confirm: String, onConfirm: () -> Unit, onDismiss: () -> Unit,
    danger: Boolean = false, dismiss: String = "Cancel",
) {
    AlertDialog(
        onDismissRequest = onDismiss, title = { Text(title) }, text = { Text(body) },
        confirmButton = { TextButton(onClick = onConfirm, colors = if (danger) ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error) else ButtonDefaults.textButtonColors()) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(dismiss) } },
    )
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.titleMedium, modifier = modifier.padding(top = 8.dp))
}

@Composable
fun MetaText(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = modifier)
}

@Composable
fun CodeText(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace), color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
fun MessageBubble(text: String, modifier: Modifier = Modifier) {
    Text(
        text, style = MaterialTheme.typography.bodyMedium,
        modifier = modifier.clip(RoundedCornerShape(10.dp, 10.dp, 10.dp, 2.dp)).background(MaterialTheme.colorScheme.surface)
            .border(1.dp, LocalStatusColors.current.line, RoundedCornerShape(10.dp, 10.dp, 10.dp, 2.dp)).padding(12.dp),
    )
}

/** Renders a QR payload locally; the payload never leaves the device or touches logs. */
@Composable
fun QrImage(payload: String, modifier: Modifier = Modifier, dimmed: Boolean = false) {
    val bitmap: ImageBitmap = remember(payload) {
        val size = 512
        val matrix = QRCodeWriter().encode(payload, BarcodeFormat.QR_CODE, size, size, mapOf(EncodeHintType.MARGIN to 0, EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M))
        val pixels = IntArray(size * size) { i -> if (matrix.get(i % size, i / size)) 0xFF1D2924.toInt() else 0xFFFFFFFF.toInt() }
        Bitmap.createBitmap(pixels, size, size, Bitmap.Config.ARGB_8888).asImageBitmap()
    }
    Image(bitmap, contentDescription = "QR code to link this WhatsApp number", filterQuality = FilterQuality.None,
        modifier = modifier, alpha = if (dimmed) 0.12f else 1f)
}
