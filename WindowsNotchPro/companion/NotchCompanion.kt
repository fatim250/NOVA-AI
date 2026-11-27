package com.novanotch.companion

import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.net.http.WebSocket
import java.time.Duration
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CompletionStage

/**
 * NOVA / WindowsNotch Pro — Kotlin Companion Client (JVM & Android-compatible core).
 *
 * Authenticates via Bearer token (supplied at runtime via pairing or environment variable,
 * never hardcoded) to the local C# CompanionServer inside WindowsNotchPro.exe.
 */
class NotchCompanionClient(
    private val host: String = "127.0.0.1",
    private val port: Int = 17420,
    private val bearerToken: String,
    private val useTls: Boolean = false
) : AutoCloseable {

    private val httpClient: HttpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .build()

    @Volatile
    private var webSocket: WebSocket? = null

    private val httpScheme: String get() = if (useTls) "https" else "http"
    private val wsScheme: String get() = if (useTls) "wss" else "ws"

    /**
     * Opens a persistent, token-authenticated WebSocket tunnel to WindowsNotchPro.
     */
    fun connectWebSocket(onReply: (String) -> Unit, onError: (Throwable) -> Unit = {}): CompletableFuture<WebSocket> {
        require(bearerToken.length >= 24) { "Bearer pairing token must be at least 24 characters." }
        val wsUri = URI.create("$wsScheme://$host:$port/ws")

        return httpClient.newWebSocketBuilder()
            .header("Authorization", "Bearer $bearerToken")
            .connectTimeout(Duration.ofSeconds(5))
            .buildAsync(wsUri, object : WebSocket.Listener {
                private val buffer = StringBuilder()

                override fun onText(ws: WebSocket, data: CharSequence, last: Boolean): CompletionStage<*>? {
                    buffer.append(data)
                    if (last) {
                        val message = buffer.toString()
                        buffer.setLength(0)
                        onReply(message)
                    }
                    ws.request(1)
                    return null
                }

                override fun onError(ws: WebSocket, error: Throwable) {
                    onError(error)
                }
            })
            .thenApply { ws ->
                webSocket = ws
                ws
            }
    }

    /**
     * Sends a natural-language voice or text command over WebSocket (if connected) or HTTP POST.
     */
    fun sendCommand(prompt: String): CompletableFuture<String> {
        val safePrompt = escapeJson(prompt)
        val json = """{"type":"command","prompt":"$safePrompt"}"""
        val activeWs = webSocket
        if (activeWs != null && !activeWs.isOutputClosed) {
            return activeWs.sendText(json, true).thenApply { "Sent via WebSocket: $prompt" }
        }
        return postJson("/api/command", json)
    }

    // --- Typed Desktop & Automation Helpers ---

    fun openApp(appName: String): CompletableFuture<String> =
        sendCommand("Open $appName")

    fun closeApp(appName: String): CompletableFuture<String> =
        sendCommand("Close $appName")

    fun createFolder(name: String, root: String = "Desktop"): CompletableFuture<String> =
        sendCommand("Create folder $name on $root")

    fun renameFolder(oldName: String, newName: String, root: String = "Desktop"): CompletableFuture<String> =
        sendCommand("Rename folder $oldName to $newName on $root")

    fun deleteFolder(name: String, root: String = "Desktop"): CompletableFuture<String> =
        sendCommand("Delete folder $name from $root")

    fun moveMouse(x: Int, y: Int): CompletableFuture<String> =
        sendCommand("Move mouse to $x $y")

    fun emergencyStopMouse(): CompletableFuture<String> =
        sendCommand("Emergency stop")

    fun lockWorkstation(): CompletableFuture<String> =
        sendCommand("Lock PC")

    /**
     * Submits a 2FA unlock challenge (passphrase + MFCC voiceprint vector) to SecurityVault.
     */
    fun submitUnlockChallenge(passphrase: String, voiceprintVector: List<Double>): CompletableFuture<String> {
        val safePass = escapeJson(passphrase)
        val vecJson = voiceprintVector.joinToString(prefix = "[", postfix = "]", separator = ",")
        val payload = """{"type":"unlock_challenge","passphrase":"$safePass","voiceprint":$vecJson}"""
        return postJson("/api/command", payload)
    }

    fun fetchStatus(): CompletableFuture<String> {
        val req = HttpRequest.newBuilder()
            .uri(URI.create("$httpScheme://$host:$port/api/status"))
            .header("Authorization", "Bearer $bearerToken")
            .timeout(Duration.ofSeconds(5))
            .GET()
            .build()

        return httpClient.sendAsync(req, HttpResponse.BodyHandlers.ofString())
            .thenApply { it.body() }
    }

    private fun postJson(path: String, jsonBody: String): CompletableFuture<String> {
        val req = HttpRequest.newBuilder()
            .uri(URI.create("$httpScheme://$host:$port$path"))
            .header("Authorization", "Bearer $bearerToken")
            .header("Content-Type", "application/json")
            .timeout(Duration.ofSeconds(8))
            .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
            .build()

        return httpClient.sendAsync(req, HttpResponse.BodyHandlers.ofString())
            .thenApply { response ->
                val code = response.statusCode()
                if (code in 200..299) {
                    response.body()
                } else {
                    val safeBody = escapeJson(response.body())
                    """{"ok":false,"status":$code,"body":"$safeBody"}"""
                }
            }
    }

    private fun escapeJson(value: String): String =
        value.replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")

    override fun close() {
        webSocket?.sendClose(WebSocket.NORMAL_CLOSURE, "Companion disconnecting")
        webSocket = null
    }
}

/**
 * CLI example:
 *   set NOTCH_COMPANION_TOKEN=<your-runtime-token>
 *   kotlinc companion/NotchCompanion.kt -include-runtime -d NotchCompanion.jar
 *   java -jar NotchCompanion.jar "Open Chrome"
 */
fun main(args: Array<String>) {
    val token = System.getenv("NOTCH_COMPANION_TOKEN")
    if (token.isNullOrBlank()) {
        System.err.println("Set NOTCH_COMPANION_TOKEN before running NotchCompanion.")
        return
    }

    val host = System.getenv("NOTCH_HOST") ?: "127.0.0.1"
    val prompt = if (args.isNotEmpty()) args.joinToString(" ") else "List running apps"

    NotchCompanionClient(host = host, bearerToken = token).use { client ->
        val response = client.sendCommand(prompt).join()
        println("NOVA Response: $response")
    }
}
