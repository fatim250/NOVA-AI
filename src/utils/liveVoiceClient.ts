/**
 * Browser client for Gemini 3.8 Live API over server-side WebSocket (/ws/live).
 * Uses 16kHz Int16 PCM mic capture and a separate 24kHz AudioContext with
 * gapless nextStartTime scheduling for model audio playback.
 */

export interface LiveVoiceCallbacks {
  onStatusChange: (status: "connecting" | "live" | "speaking" | "disconnected") => void;
  onInputTranscript: (delta: string) => void;
  onOutputTranscript: (delta: string) => void;
  onTurnComplete: () => void;
  onError: (message: string, retryable: boolean) => void;
}

function float32ToPcm16Base64(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64Pcm16ToFloat32(base64: string): Float32Array<ArrayBuffer> {
  const binary = atob(base64);
  const byteLen = binary.length;
  const bytes = new Uint8Array(byteLen);
  for (let i = 0; i < byteLen; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const sampleCount = Math.floor(byteLen / 2);
  const out = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    out[i] = view.getInt16(i * 2, true) / 32768;
  }
  return out;
}

export class LiveVoiceSession {
  private ws: WebSocket | null = null;
  private inputCtx: AudioContext | null = null;
  private outputCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private activeSources = new Set<AudioBufferSourceNode>();
  private nextStartTime = 0;
  private disposed = false;
  private callbacks: LiveVoiceCallbacks;

  constructor(callbacks: LiveVoiceCallbacks) {
    this.callbacks = callbacks;
  }

  async start(memoryContextNote?: string): Promise<void> {
    this.disposed = false;
    this.callbacks.onStatusChange("connecting");

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      this.callbacks.onError(
        "Microphone access was denied or unavailable. Allow microphone permission to start a live voice conversation.",
        false
      );
      this.callbacks.onStatusChange("disconnected");
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/live`);
    this.ws = ws;

    this.inputCtx = new AudioContext({ sampleRate: 16000 });
    this.outputCtx = new AudioContext({ sampleRate: 24000 });
    this.nextStartTime = this.outputCtx.currentTime;

    ws.onopen = () => {
      if (this.disposed) {
        ws.close();
        return;
      }
      if (memoryContextNote) {
        ws.send(JSON.stringify({ text: memoryContextNote }));
      }
      this.startMicStreaming();
    };

    ws.onmessage = (event) => {
      if (this.disposed) return;
      try {
        const msg = JSON.parse(String(event.data)) as {
          ready?: boolean;
          audio?: string;
          inputTranscript?: string;
          outputTranscript?: string;
          interrupted?: boolean;
          turnComplete?: boolean;
          sessionClosed?: boolean;
          error?: string;
          retryable?: boolean;
        };

        if (msg.ready) {
          this.callbacks.onStatusChange("live");
        }
        if (msg.inputTranscript) {
          this.callbacks.onInputTranscript(msg.inputTranscript);
        }
        if (msg.outputTranscript) {
          this.callbacks.onOutputTranscript(msg.outputTranscript);
        }
        if (msg.audio) {
          this.callbacks.onStatusChange("speaking");
          this.schedulePcm24kChunk(msg.audio);
        }
        if (msg.interrupted) {
          this.flushPlaybackQueue();
          this.callbacks.onStatusChange("live");
        }
        if (msg.turnComplete) {
          this.callbacks.onTurnComplete();
          if (this.activeSources.size === 0) {
            this.callbacks.onStatusChange("live");
          }
        }
        if (msg.error) {
          const errorText =
            typeof msg.error === "string" && msg.error !== "[object Object]"
              ? msg.error
              : "Live voice connection error. Please reconnect.";
          this.callbacks.onError(errorText, Boolean(msg.retryable));
          this.stop();
        }
        if (msg.sessionClosed) {
          this.stop();
        }
      } catch {
        // Ignore non-JSON frames
      }
    };

    ws.onerror = () => {
      if (!this.disposed) {
        this.callbacks.onError("Lost connection to Gemini Live voice bridge.", true);
        this.stop();
      }
    };

    ws.onclose = () => {
      if (!this.disposed) {
        this.stop();
      }
    };
  }

  private startMicStreaming(): void {
    if (!this.inputCtx || !this.mediaStream || !this.ws) return;
    this.sourceNode = this.inputCtx.createMediaStreamSource(this.mediaStream);
    this.processor = this.inputCtx.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (this.disposed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const samples = e.inputBuffer.getChannelData(0);
      const base64 = float32ToPcm16Base64(samples);
      this.ws.send(JSON.stringify({ audio: base64 }));
    };

    this.sourceNode.connect(this.processor);
    this.processor.connect(this.inputCtx.destination);
  }

  private schedulePcm24kChunk(base64Audio: string): void {
    if (!this.outputCtx || this.disposed) return;
    if (this.outputCtx.state === "suspended") {
      this.outputCtx.resume().catch(() => {});
    }

    const floatSamples = base64Pcm16ToFloat32(base64Audio);
    if (floatSamples.length === 0) return;

    const buffer = this.outputCtx.createBuffer(1, floatSamples.length, 24000);
    buffer.copyToChannel(floatSamples, 0);

    const src = this.outputCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.outputCtx.destination);

    const now = this.outputCtx.currentTime;
    if (this.nextStartTime < now) {
      this.nextStartTime = now + 0.02;
    }
    const startAt = this.nextStartTime;
    this.nextStartTime = startAt + buffer.duration;

    this.activeSources.add(src);
    src.onended = () => {
      this.activeSources.delete(src);
      if (this.activeSources.size === 0 && !this.disposed) {
        this.callbacks.onStatusChange("live");
      }
    };
    src.start(startAt);
  }

  private flushPlaybackQueue(): void {
    for (const src of this.activeSources) {
      try {
        src.stop();
      } catch {
        // Ignore already stopped source
      }
    }
    this.activeSources.clear();
    if (this.outputCtx) {
      this.nextStartTime = this.outputCtx.currentTime;
    }
  }

  stop(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.flushPlaybackQueue();

    try {
      this.processor?.disconnect();
      this.sourceNode?.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    this.processor = null;
    this.sourceNode = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.inputCtx) {
      this.inputCtx.close().catch(() => {});
      this.inputCtx = null;
    }
    if (this.outputCtx) {
      this.outputCtx.close().catch(() => {});
      this.outputCtx = null;
    }
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      this.ws.close();
    }
    this.ws = null;
    this.callbacks.onStatusChange("disconnected");
  }
}
