import "dotenv/config";
import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import {
  GoogleGenAI,
  type LiveServerMessage,
  Modality,
  ThinkingLevel,
  Type,
} from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const PRIMARY_MODEL = "gemini-4-hydrogen";
const FALLBACK_MODEL = "gemini-3.1-flash-lite";
const LIVE_MODEL = "gemini-3.8-live";

interface MemoryEntryInput {
  index: number;
  userInput: string;
  action: string;
  target?: string;
  root?: string;
  assistantReply: string;
  outcome: string;
}

interface CommandRequestBody {
  prompt?: unknown;
  memory?: unknown;
  desktopState?: unknown;
}

interface GroundingSource {
  title: string;
  uri: string;
}

interface SongTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  previewUrl: string;
  artworkUrl: string;
}

function isSafeHttpsUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "";
  try {
    const parsed = new URL(raw.trim());
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

async function searchMusicTracks(query: string, limit = 5): Promise<SongTrack[]> {
  const clean = query.trim().slice(0, 120);
  if (!clean) return [];
  const safeLimit = Math.max(1, Math.min(8, limit));
  const endpoint = `https://itunes.apple.com/search?term=${encodeURIComponent(
    clean
  )}&media=music&entity=song&limit=${safeLimit}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    const resp = await fetch(endpoint, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as {
      results?: Array<Record<string, unknown>>;
    };
    const rows = Array.isArray(data.results) ? data.results : [];
    const tracks: SongTrack[] = [];
    for (const row of rows) {
      const previewUrl = isSafeHttpsUrl(row.previewUrl);
      if (!previewUrl) continue;
      tracks.push({
        id: String(row.trackId ?? `${Date.now()}-${tracks.length}`),
        title: String(row.trackName ?? "Unknown Track").slice(0, 100),
        artist: String(row.artistName ?? "Unknown Artist").slice(0, 100),
        album: String(row.collectionName ?? "").slice(0, 100),
        durationMs: typeof row.trackTimeMillis === "number" ? row.trackTimeMillis : 30000,
        previewUrl,
        artworkUrl: isSafeHttpsUrl(row.artworkUrl100 || row.artworkUrl60),
      });
    }
    return tracks;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function getGeminiClient(apiVersion?: string): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractErrorDetails(err: unknown): { status: number; message: string; transient: boolean } {
  let raw = "";
  let status = 500;

  if (err instanceof Error) {
    raw = err.message;
  } else if (typeof err === "string") {
    raw = err;
  } else if (typeof err === "object" && err !== null) {
    const rec = err as Record<string, unknown>;
    const nestedErr = rec.error;
    if (typeof rec.code === "number") status = rec.code;
    if (typeof rec.status === "number") status = rec.status;

    if (nestedErr instanceof Error && nestedErr.message) {
      raw = nestedErr.message;
    } else if (typeof nestedErr === "object" && nestedErr !== null) {
      const nestedRec = nestedErr as Record<string, unknown>;
      if (typeof nestedRec.code === "number") status = nestedRec.code;
      if (typeof nestedRec.message === "string" && nestedRec.message.trim()) {
        raw = nestedRec.message;
      } else {
        try {
          raw = JSON.stringify(nestedErr);
        } catch {
          raw = "";
        }
      }
    } else if (typeof rec.message === "string" && rec.message.trim()) {
      raw = rec.message;
    } else if (typeof rec.reason === "string" && rec.reason.trim()) {
      raw = rec.reason;
    } else if (typeof rec.type === "string" && rec.type.trim()) {
      raw = `Connection ${rec.type} event`;
    } else {
      try {
        const serialized = JSON.stringify(rec);
        raw = serialized && serialized !== "{}" ? serialized : "";
      } catch {
        raw = "";
      }
    }
  }

  if (!raw || raw === "[object Object]") {
    raw = "The AI connection encountered an unexpected error. Please retry.";
  }

  let parsedMsg = raw;

  // Unwrap SDK JSON-formatted error strings like '{"error":{"code":503,"message":"..."}}'
  try {
    const startIdx = raw.indexOf("{");
    if (startIdx >= 0) {
      const obj = JSON.parse(raw.slice(startIdx));
      if (obj?.error) {
        if (typeof obj.error.code === "number") status = obj.error.code;
        if (typeof obj.error.message === "string" && obj.error.message.trim()) {
          parsedMsg = obj.error.message;
        }
      }
    }
  } catch {
    // Keep raw string
  }

  const lower = `${raw} ${parsedMsg}`.toLowerCase();
  if (lower.includes("503") || lower.includes("unavailable") || lower.includes("high demand") || lower.includes("overloaded")) {
    status = 503;
  } else if (lower.includes("429") || lower.includes("resource_exhausted") || lower.includes("quota")) {
    status = 429;
  } else if (lower.includes("403") || lower.includes("permission_denied") || lower.includes("api_key_invalid")) {
    status = 403;
  } else if (lower.includes("404") || lower.includes("not_found")) {
    status = 404;
  }

  const transient =
    status === 503 ||
    status === 429 ||
    lower.includes("unavailable") ||
    lower.includes("high demand") ||
    lower.includes("temporarily") ||
    lower.includes("econnreset") ||
    lower.includes("etimedout") ||
    lower.includes("fetch failed") ||
    lower.includes("connection error event");

  return { status, message: parsedMsg, transient };
}

/**
 * Retries transient 503 / UNAVAILABLE / high-demand spikes with jittered exponential backoff,
 * then automatically fails over from gemini-4-hydrogen to gemini-3.1-flash-lite if spikes persist.
 */
async function callGenerateWithResilience(
  ai: GoogleGenAI,
  buildParams: (model: string) => Parameters<GoogleGenAI["models"]["generateContent"]>[0]
) {
  const plan: Array<{ model: string; delayMs: number }> = [
    { model: PRIMARY_MODEL, delayMs: 0 },
    { model: PRIMARY_MODEL, delayMs: 650 },
    { model: PRIMARY_MODEL, delayMs: 1450 },
    { model: FALLBACK_MODEL, delayMs: 350 },
    { model: FALLBACK_MODEL, delayMs: 1100 },
  ];

  let lastErr: unknown;
  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    if (step.delayMs > 0) {
      const jitter = Math.floor(Math.random() * 220);
      await sleep(step.delayMs + jitter);
    }
    try {
      const response = await ai.models.generateContent(buildParams(step.model));
      return { response, modelUsed: step.model };
    } catch (err) {
      lastErr = err;
      const details = extractErrorDetails(err);
      if (!details.transient) {
        throw err;
      }
    }
  }
  throw lastErr;
}

function extractSafeGroundingSources(response: {
  candidates?: Array<{
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    };
  }>;
}): GroundingSource[] {
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set<string>();
  const sources: GroundingSource[] = [];

  for (const chunk of chunks) {
    const uri = chunk?.web?.uri?.trim();
    if (!uri || seen.has(uri)) continue;
    try {
      const parsed = new URL(uri);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
      seen.add(uri);
      sources.push({
        title: (chunk?.web?.title?.trim() || parsed.hostname).slice(0, 80),
        uri: parsed.toString(),
      });
      if (sources.length >= 4) break;
    } catch {
      continue;
    }
  }
  return sources;
}

const NOTCH_SYSTEM_INSTRUCTION = `You are a minimal, nameless conversational Windows 10 & 11 desktop AI assistant.
Check currentDesktopState.assistantName: if it is empty, you have no name yet — do NOT call yourself "Notch" unless the user explicitly names you that! If the user gives you a name, adopt it warmly.
You infer user intent automatically from natural language and return a structured JSON action object.

CRITICAL CAPABILITIES & CONSTRAINTS:
1. Short-Term Memory (20-Turn Sliding Window):
   - You receive up to the last 20 user interactions in chronological order (oldest -> newest).
   - Resolve relative or anaphoric references accurately using this buffer! Examples:
     - "do that for the new folder instead" or "do that for Reports instead" -> repeat the previous action targeting the newly referenced folder.
     - "rename it to Archive" or "delete it" -> refer to the most recently created/modified/referenced folder in the 20-turn buffer.
     - "close that" or "close it" -> close the most recently opened app (including Chrome) in the 20-turn buffer.
     - "play that song again" -> replay the most recently played song in the 20-turn buffer.
     - "what was that last app I opened?" or "what was the last song I played?" -> use action "memory_recall" and answer accurately from the 20-turn buffer!
   - When you resolve a relative reference from memory, populate "resolvedReference" with a brief plain-English note. Otherwise leave "resolvedReference" as an empty string.

2. Supported Actions (choose exactly ONE):
   - "set_assistant_name": Use when the user assigns, changes, or clears your name (e.g., "Your name is Nova", "Call yourself Jarvis", "I'll name you Aria", "Remove your name"). Put the chosen name in "target" (or empty string "" if user asks to stay nameless).
   - "folder_create": Create a folder in a sandboxed root ("Desktop", "Documents", or "Downloads"; default "Desktop"). Put folder name in "target", root in "root". For unsafe traversal/system paths (e.g. "..\\Windows", "System32", "CON"), STILL emit "folder_create" with the raw path in "target" so the local sandbox blocks and audits it.
   - "folder_rename": Rename an existing folder ("target", "newName", "root").
   - "folder_delete": Soft-delete a folder to Recycle Bin ("target", "root").
   - "app_open": Open a Windows application including web browsers ("Chrome", "Google Chrome", "Edge", "Notepad", "VS Code", "Calculator", "Terminal", "File Explorer"). Put app name in "target". If the user asks to open Chrome/browser to a specific website or search query (e.g. "open chrome and go to youtube.com" or "open chrome and search weather"), set "target": "Chrome" and put the URL in "url" or search query in "searchQuery".
   - "app_close": Close a running application or process ("target"). For critical system processes (lsass.exe, winlogon.exe, explorer.exe, csrss.exe, svchost.exe), STILL emit "app_close" with that name in "target" so Process Protection blocks and audits it.
   - "app_list": List currently running desktop applications.
   - "song_search": Search for songs directly inside the assistant bar without opening another app! Put the song/artist query in "searchQuery" (e.g. "search song Blinding Lights" or "find songs by Daft Punk").
   - "song_play": Search and immediately play a song directly inside the assistant bar! Put the song/artist query in "searchQuery" (e.g. "play Blinding Lights", "play jazz", "play a song by Adele").
   - "song_pause": Pause the currently playing song.
   - "song_resume": Resume the paused song.
   - "song_stop": Stop and clear the currently playing song (e.g. "stop the song", "stop music", "turn off music").
   - "mouse_move": Move cursor smoothly ("x", "y", or "direction").
   - "mouse_click": Click mouse ("clickType": "left" | "right" | "double" | "scroll_up" | "scroll_down").
   - "mouse_patrol": Start autonomous keep-awake cursor patrol.
   - "mouse_stop": Emergency stop mouse patrol and Air-Mouse gesture tracking.
   - "gesture_toggle": Toggle MediaPipe Air-Mouse hand-gesture mode ("enabled": true/false).
   - "lock_pc": Lock the Windows workstation.
   - "unlock_pc": Attempt 2FA voice unlock when locked ("passphrase" if spoken).
   - "open_vault": Open the Security Vault dialog.
   - "memory_recall": Answer a question about recent commands, apps, folders, or songs in the 20-turn sliding window buffer.
   - "web_search": Use whenever the user asks for up-to-date, real-world, news, weather, prices, latest releases, sports, or web-verified information (put concise query in "searchQuery").
   - "general_qa": Concise answer to timeless general knowledge or conversational greetings. Set "needsSearch": true if live web verification would make the answer more accurate or current.

3. Voice-First Conciseness:
   - Keep "spokenReply" crisp, natural, and under 28 words.`;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "96kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/music/search", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) {
      res.status(400).json({ error: "A search query (?q=) is required." });
      return;
    }
    const tracks = await searchMusicTracks(q, 6);
    res.json({ tracks });
  });

  app.post("/api/notch/command", async (req, res) => {
    const body = (req.body ?? {}) as CommandRequestBody;

    if (typeof body.prompt !== "string" || body.prompt.trim().length === 0) {
      res.status(400).json({ error: "A non-empty command prompt is required." });
      return;
    }

    const prompt = body.prompt.trim().slice(0, 600);
    const rawMemory = Array.isArray(body.memory) ? body.memory.slice(-20) : [];
    const memoryEntries: MemoryEntryInput[] = rawMemory
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item, idx) => ({
        index: idx + 1,
        userInput: String(item.userInput ?? "").slice(0, 240),
        action: String(item.action ?? "general_qa").slice(0, 40),
        target: typeof item.target === "string" ? item.target.slice(0, 120) : undefined,
        root: typeof item.root === "string" ? item.root.slice(0, 40) : undefined,
        assistantReply: String(item.assistantReply ?? "").slice(0, 240),
        outcome: String(item.outcome ?? "ok").slice(0, 40),
      }));

    const desktopState =
      typeof body.desktopState === "object" && body.desktopState !== null
        ? body.desktopState
        : {};

    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          "Gemini API key is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets to enable AI intent inference.",
        retryable: false,
      });
      return;
    }

    const contextBlock = JSON.stringify(
      {
        shortTermMemoryWindow: memoryEntries,
        currentDesktopState: desktopState,
        currentUserUtterance: prompt,
      },
      null,
      2
    );

    try {
      const { response, modelUsed } = await callGenerateWithResilience(ai, (model) => ({
        model,
        contents: `Analyze the current user utterance using the 20-turn shortTermMemoryWindow and currentDesktopState, and return the structured intent JSON.\n\n${contextBlock}`,
        config: {
          systemInstruction: NOTCH_SYSTEM_INSTRUCTION,
          ...(model === PRIMARY_MODEL
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
            : {}),
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              action: {
                type: Type.STRING,
                description:
                  "One of: set_assistant_name, folder_create, folder_rename, folder_delete, app_open, app_close, app_list, song_search, song_play, song_pause, song_resume, song_stop, mouse_move, mouse_click, mouse_patrol, mouse_stop, gesture_toggle, lock_pc, unlock_pc, open_vault, memory_recall, web_search, general_qa",
              },
              target: { type: Type.STRING },
              newName: { type: Type.STRING },
              root: { type: Type.STRING },
              url: { type: Type.STRING },
              direction: { type: Type.STRING },
              x: { type: Type.NUMBER },
              y: { type: Type.NUMBER },
              clickType: { type: Type.STRING },
              enabled: { type: Type.BOOLEAN },
              passphrase: { type: Type.STRING },
              searchQuery: { type: Type.STRING },
              needsSearch: { type: Type.BOOLEAN },
              resolvedReference: { type: Type.STRING },
              spokenReply: { type: Type.STRING },
            },
            required: ["action", "spokenReply", "resolvedReference"],
          },
        },
      }));

      const rawText = (response.text ?? "").trim();
      if (!rawText) {
        res.status(502).json({
          error: "Empty response received from Gemini model. Please retry.",
          retryable: true,
        });
        return;
      }

      const parsed = JSON.parse(rawText) as Record<string, unknown>;
      let sources: GroundingSource[] = [];
      let songs: SongTrack[] = [];
      let grounded = false;

      // In-Notch Song Search & Playback (no external app required)
      if (parsed.action === "song_search" || parsed.action === "song_play") {
        const songQuery =
          (typeof parsed.searchQuery === "string" && parsed.searchQuery.trim()) ||
          (typeof parsed.target === "string" && parsed.target.trim()) ||
          prompt;
        songs = await searchMusicTracks(songQuery, 5);
        if (songs.length === 0) {
          parsed.spokenReply = `I couldn't find a playable preview for "${songQuery}". Try another song title or artist.`;
        } else if (parsed.action === "song_play") {
          parsed.spokenReply = `Playing ${songs[0].title} by ${songs[0].artist} right in the Notch.`;
          parsed.target = `${songs[0].title} — ${songs[0].artist}`;
        } else {
          parsed.spokenReply = `Found ${songs.length} songs for "${songQuery}". Click any track to play it right here.`;
          parsed.target = songQuery;
        }
      }

      // Run Google Search Grounding with gemini-4-hydrogen for up-to-date web queries
      const shouldSearch =
        parsed.action === "web_search" ||
        (parsed.action === "general_qa" && parsed.needsSearch === true);

      if (shouldSearch) {
        const searchPrompt =
          typeof parsed.searchQuery === "string" && parsed.searchQuery.trim().length > 0
            ? parsed.searchQuery.trim()
            : prompt;

        try {
          const { response: searchRes } = await callGenerateWithResilience(ai, (model) => ({
            model,
            contents: searchPrompt,
            config: {
              systemInstruction:
                "You are Notch AI inside WindowsNotch Pro. Answer the user's question accurately and concisely in 1 to 2 clear sentences suitable for spoken talk-back, grounded in Google Search results.",
              tools: [{ googleSearch: {} }],
              ...(model === PRIMARY_MODEL
                ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                : {}),
            },
          }));

          const groundedText = (searchRes.text ?? "").trim();
          if (groundedText) {
            parsed.spokenReply = groundedText;
            parsed.action = "web_search";
            grounded = true;
          }
          sources = extractSafeGroundingSources(searchRes);
        } catch {
          // If search grounding itself hits a transient spike, fall back cleanly to the structured answer
        }
      }

      res.json({
        ...parsed,
        sources,
        songs,
        grounded,
        modelUsed,
      });
    } catch (err: unknown) {
      const details = extractErrorDetails(err);
      const friendlyMessage =
        details.status === 503
          ? "Gemini is experiencing a temporary spike in demand after automatic retries. Click Retry in a moment."
          : details.status === 429
          ? "API rate limit reached. Wait a few seconds or check your quota in Settings > Secrets."
          : details.status === 403
          ? "API key rejected. Verify your GEMINI_API_KEY in Settings > Secrets."
          : details.message;

      res.status(details.status).json({
        error: friendlyMessage,
        retryable: details.transient,
      });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", `http://${request.headers.host || "localhost"}`)
      .pathname;
    if (pathname === "/ws/live") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", async (clientWs: WebSocket) => {
    // Gemini Live API (BidiGenerateContent) requires apiVersion: "v1beta" in @google/genai v3+
    const ai = getGeminiClient("v1beta");
    if (!ai) {
      clientWs.send(
        JSON.stringify({
          error: "Gemini API key is not configured on the server.",
          retryable: false,
        })
      );
      clientWs.close();
      return;
    }

    let closed = false;
    let session: Awaited<ReturnType<GoogleGenAI["live"]["connect"]>> | null = null;
    const pendingMessages: Array<{ audio?: string; text?: string }> = [];

    const connectLiveWithRetry = async () => {
      const delays = [0, 700, 1600];
      let lastErr: unknown;
      for (let i = 0; i < delays.length; i++) {
        if (closed) return null;
        if (delays[i] > 0) await sleep(delays[i]);
        try {
          return await ai.live.connect({
            model: LIVE_MODEL,
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: "Zephyr" },
                },
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              systemInstruction:
                "You are a minimal, nameless real-time desktop voice assistant until the user gives you a name. Respond naturally, warmly, and concisely in 1 to 2 spoken sentences.",
            },
            callbacks: {
              onmessage: (message: LiveServerMessage) => {
                if (closed || clientWs.readyState !== WebSocket.OPEN) return;
                const content = message.serverContent;

                if (content?.inputTranscription?.text) {
                  clientWs.send(
                    JSON.stringify({ inputTranscript: content.inputTranscription.text })
                  );
                }
                if (content?.outputTranscription?.text) {
                  clientWs.send(
                    JSON.stringify({ outputTranscript: content.outputTranscription.text })
                  );
                }
                for (const part of content?.modelTurn?.parts ?? []) {
                  if (part.inlineData?.data) {
                    clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
                  }
                }
                if (content?.interrupted) {
                  clientWs.send(JSON.stringify({ interrupted: true }));
                }
                if (content?.turnComplete) {
                  clientWs.send(JSON.stringify({ turnComplete: true }));
                }
              },
              onerror: (evt: unknown) => {
                if (closed || clientWs.readyState !== WebSocket.OPEN) return;
                const details = extractErrorDetails(evt);
                clientWs.send(
                  JSON.stringify({
                    error:
                      details.status === 503
                        ? "Live voice model is temporarily busy. Please reconnect in a moment."
                        : details.message,
                    retryable: details.transient,
                  })
                );
              },
              onclose: (evt?: { code?: number; reason?: string }) => {
                if (!closed && clientWs.readyState === WebSocket.OPEN) {
                  if (evt && typeof evt.code === "number" && evt.code !== 1000 && evt.reason) {
                    clientWs.send(
                      JSON.stringify({
                        error: `Live voice session closed (${evt.code}): ${evt.reason}`,
                        retryable: evt.code === 1011 || evt.code === 1013,
                      })
                    );
                  } else {
                    clientWs.send(JSON.stringify({ sessionClosed: true }));
                  }
                }
              },
            },
          });
        } catch (err) {
          lastErr = err;
          const details = extractErrorDetails(err);
          if (!details.transient) throw err;
        }
      }
      throw lastErr;
    };

    clientWs.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { audio?: string; text?: string };
        if (!session) {
          if (pendingMessages.length < 30) {
            pendingMessages.push(msg);
          }
          return;
        }
        if (typeof msg.audio === "string" && msg.audio.length > 0) {
          session.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: "audio/pcm;rate=16000" },
          });
        } else if (typeof msg.text === "string" && msg.text.trim().length > 0) {
          session.sendRealtimeInput({ text: msg.text.trim().slice(0, 500) });
        }
      } catch {
        // Ignore malformed client frames
      }
    });

    clientWs.on("close", () => {
      closed = true;
      try {
        session?.close();
      } catch {
        // Already closed
      }
      session = null;
    });

    try {
      session = await connectLiveWithRetry();
      if (!session || closed) {
        session?.close();
        return;
      }
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ ready: true, model: LIVE_MODEL }));
      }
      for (const queued of pendingMessages.splice(0)) {
        if (queued.audio) {
          session.sendRealtimeInput({
            audio: { data: queued.audio, mimeType: "audio/pcm;rate=16000" },
          });
        } else if (queued.text) {
          session.sendRealtimeInput({ text: queued.text });
        }
      }
    } catch (err) {
      const details = extractErrorDetails(err);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          JSON.stringify({
            error:
              details.status === 503
                ? "Gemini Live voice is temporarily under high demand. Please try again in a moment."
                : details.message,
            retryable: details.transient,
          })
        );
        clientWs.close();
      }
    }
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`WindowsNotch Pro server listening on http://localhost:${PORT}`);
  });
}

startServer();
