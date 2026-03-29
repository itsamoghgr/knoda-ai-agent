"use client";

// Web Speech API types are not always present in TypeScript's DOM lib.
interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => ISpeechRecognition;
declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

/**
 * VoiceInterface — pure voice I/O layer for the Communication Agent.
 *
 * Responsibilities (all of them — nothing lives in the parent page):
 *   1. Auto-narration: when sessionId becomes available, sends an empty message
 *      to the Communication Agent → agent narrates the dashboard via tools
 *   2. Voice Q&A: Web Speech API (STT) → transcript → same agent endpoint
 *   3. TTS playback: sentence-level streaming via POST /present/tts
 *   4. Interruption: Space bar or mic button stops audio and opens mic
 *   5. Session history: maintained server-side — this component sends no history
 *
 * iOS audio note: A single persistent HTMLAudioElement is created on mount and
 * reused for all playback. The parent page calls .play() on it synchronously
 * inside the "Start Presentation" gesture (via onAudioRef callback) to unlock
 * WebKit's audio gate. All subsequent playback reuses this same element so the
 * unlock persists across async boundaries.
 *
 * The parent page only provides sessionId. All intelligence is in the backend.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, Volume2 } from "lucide-react";
import { authHeaders } from "@/lib/api/client";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

// ── Sentence boundary detection ───────────────────────────────────────────────

/**
 * Extract complete sentences from a text buffer.
 * Returns [completeSentences[], remainingBuffer].
 * A sentence ends at `. `, `? `, `! `, or end of string after terminal punctuation.
 */
function extractSentences(buffer: string): [string[], string] {
  const sentences: string[] = [];
  const re = /[.!?]["']?(?:\s+|\s*$)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(buffer)) !== null) {
    const end = match.index + match[0].length;
    const sentence = buffer.slice(lastIndex, end).trim();
    if (sentence.length > 0) sentences.push(sentence);
    lastIndex = end;
  }

  return [sentences, buffer.slice(lastIndex)];
}

// ── Types ─────────────────────────────────────────────────────────────────────

type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "error";

interface VoiceInterfaceProps {
  /** Session ID from the parent page. null = session not yet ready (show connecting state). */
  sessionId: string | null;
  /**
   * Called with the persistent HTMLAudioElement when it is created on mount,
   * and with null on unmount. The parent should call .play() on it synchronously
   * inside the user gesture handler to unlock WebKit's audio gate on iOS.
   */
  onAudioRef?: (el: HTMLAudioElement | null) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function VoiceInterface({ sessionId, onAudioRef }: VoiceInterfaceProps) {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("");

  // Start false (server-safe), set real value after mount to avoid hydration mismatch
  const [isSupported, setIsSupported] = useState(false);
  useEffect(() => {
    setIsSupported(
      "SpeechRecognition" in window || "webkitSpeechRecognition" in window,
    );
  }, []);

  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  // AbortController to cancel the in-flight agent SSE stream on barge-in
  const abortRef = useRef<AbortController | null>(null);

  // ── Single persistent audio element ──────────────────────────────────────
  // Created once, reused for every sentence. iOS WebKit only unlocks the specific
  // element instance that .play() was called on in the user gesture — new Audio()
  // instances created later are NOT unlocked. By reusing one element we ensure
  // the unlock granted by the parent's gesture persists for the whole session.
  const persistentAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = document.createElement("audio");
    audio.setAttribute("playsinline", ""); // prevent iOS fullscreen player hijack
    audio.preload = "auto";
    persistentAudioRef.current = audio;
    onAudioRef?.(audio); // expose to parent for synchronous gesture unlock
    return () => {
      audio.pause();
      audio.src = "";
      onAudioRef?.(null);
    };
  // onAudioRef is a stable callback ref from parent — safe to include
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Audio queue — sequential sentence-level playback ─────────────────────
  // Stores blob URLs (strings), NOT Audio elements. The persistent element above
  // is loaded with each URL in turn.
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);
  // Incremented on every stopAndClearQueue call. Each enqueueSentence captures
  // its generation at call time and discards the result if it's stale (interrupted).
  const generationRef = useRef(0);

  // Guard against React 18 StrictMode double-invoke for auto-narration
  const narrationStartedRef = useRef(false);

  const playNext = useCallback(() => {
    const url = audioQueueRef.current.shift();
    if (!url) {
      isPlayingRef.current = false;
      setVoiceState("idle");
      setTranscript("");
      return;
    }
    const audio = persistentAudioRef.current;
    if (!audio) {
      URL.revokeObjectURL(url);
      return;
    }
    isPlayingRef.current = true;
    setVoiceState("speaking");
    const prevSrc = audio.src;
    audio.src = url;
    audio.load(); // required on iOS to reinitialise the element with the new src
    audio.onended = () => {
      URL.revokeObjectURL(url);
      playNext();
    };
    audio.play().catch((err) => {
      console.warn("Audio play() rejected:", err);
      URL.revokeObjectURL(url);
      playNext();
    });
    // Revoke the previous blob URL now that the element has moved on
    if (prevSrc && prevSrc.startsWith("blob:")) URL.revokeObjectURL(prevSrc);
  }, []);

  const stopAndClearQueue = useCallback(() => {
    // Abort in-flight SSE request
    abortRef.current?.abort();
    // Invalidate all in-flight TTS fetches — stale enqueueSentence calls discard results
    generationRef.current++;
    // Stop the persistent audio element
    const audio = persistentAudioRef.current;
    if (audio) {
      audio.pause();
      audio.onended = null;
    }
    // Revoke all queued-but-not-yet-played blob URLs
    for (const url of audioQueueRef.current) {
      URL.revokeObjectURL(url);
    }
    audioQueueRef.current = [];
    isPlayingRef.current = false;
  }, []);

  // Fetch TTS for one sentence and add its blob URL to the queue.
  const enqueueSentence = useCallback(
    async (sentence: string) => {
      const myGen = generationRef.current;
      try {
        const auth = await authHeaders();
        const res = await fetch(`${API_BASE}/present/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...auth },
          body: JSON.stringify({ text: sentence }),
        });
        if (generationRef.current !== myGen) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail ?? `TTS error: HTTP ${res.status}`);
        }
        const blob = await res.blob();
        if (generationRef.current !== myGen) return;
        const url = URL.createObjectURL(blob);
        if (generationRef.current !== myGen) {
          URL.revokeObjectURL(url);
          return;
        }
        audioQueueRef.current.push(url);
        if (!isPlayingRef.current) playNext();
      } catch (err) {
        if (generationRef.current !== myGen) return;
        setVoiceState("error");
        setError(err instanceof Error ? err.message : "TTS playback error");
      }
    },
    [playNext],
  );

  // ── Core pipeline: message → Communication Agent → sentence TTS → queue ──

  const sendToAgent = useCallback(
    async (text: string) => {
      if (!sessionId) return;

      setVoiceState("thinking");
      setTranscript(text);
      stopAndClearQueue();

      // Create a fresh AbortController for this request
      abortRef.current = new AbortController();

      try {
        const auth = await authHeaders();
        const res = await fetch(
          `${API_BASE}/present/session/${sessionId}/ask`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...auth },
            signal: abortRef.current.signal,
            body: JSON.stringify({ message: text }),
          },
        );

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail ?? `Agent error: HTTP ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body from agent");

        const decoder = new TextDecoder();
        let buffer = "";
        let sentenceBuffer = "";
        // Collect TTS promises so we can wait for them before the "no response" check.
        // TTS calls still fire concurrently (fire-and-forget) for fast playback startup.
        const pendingTts: Promise<void>[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const raw = line.slice(5).trim();
            if (!raw || raw === "{}") continue;
            try {
              const parsed = JSON.parse(raw);
              if (typeof parsed.token === "string") {
                sentenceBuffer += parsed.token;
                const [sentences, remaining] = extractSentences(sentenceBuffer);
                sentenceBuffer = remaining;
                for (const sentence of sentences) {
                  if (sentence.trim()) pendingTts.push(enqueueSentence(sentence));
                }
              }
            } catch {
              // ignore SSE parse errors
            }
          }
        }

        // Flush any remaining partial sentence after stream ends
        if (sentenceBuffer.trim()) {
          pendingTts.push(enqueueSentence(sentenceBuffer.trim()));
        }

        // Agent produced zero sentences — truly no response
        if (pendingTts.length === 0) {
          throw new Error("Agent returned no response. Please try again.");
        }
        // Wait for all in-flight TTS fetches to settle before returning.
        // Short responses finish SSE before the first TTS completes — without this
        // wait, the component unmounts or interrupts before audio is queued.
        await Promise.allSettled(pendingTts);
      } catch (err) {
        // AbortError = user interrupted — stop cleanly without showing an error
        if (err instanceof DOMException && err.name === "AbortError") return;
        stopAndClearQueue();
        setVoiceState("error");
        setError(err instanceof Error ? err.message : "An error occurred");
      }
    },
    [sessionId, stopAndClearQueue, enqueueSentence],
  );

  // ── Auto-narration — trigger on session ready ──────────────────────────────

  useEffect(() => {
    if (!sessionId || narrationStartedRef.current) return;
    narrationStartedRef.current = true;
    sendToAgent(""); // empty message → Communication Agent narrates the dashboard
  }, [sessionId, sendToAgent]);

  // ── Cleanup on unmount — stop all audio when presentation page is closed ───

  useEffect(() => {
    return () => {
      stopAndClearQueue();
    };
  }, [stopAndClearQueue]);

  // ── Speech recognition ────────────────────────────────────────────────────

  const startListening = useCallback(() => {
    if (!isSupported || !sessionId) return;
    setError(null);
    setVoiceState("listening");
    setTranscript("");
    stopAndClearQueue(); // abort in-flight request + stop audio

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionCtor: SpeechRecognitionCtor | undefined =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      setVoiceState("error");
      setError("Voice input is not supported in this browser. Use Chrome or Edge.");
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognitionRef.current = recognition;

    recognition.onresult = (event: Event) => {
      const e = event as unknown as { results: SpeechRecognitionResultList };
      const text = e.results[0][0].transcript.trim();
      if (text) sendToAgent(text);
    };

    recognition.onerror = (event: Event) => {
      const e = event as unknown as { error: string };
      if (e.error === "not-allowed" || e.error === "permission-denied") {
        setVoiceState("error");
        setError("Microphone access denied. Please allow microphone access and try again.");
      } else if (e.error === "no-speech") {
        setVoiceState("idle");
      } else {
        setVoiceState("error");
        setError(`Speech recognition error: ${e.error}`);
      }
    };

    recognition.onend = () => {
      setVoiceState((prev) => (prev === "listening" ? "idle" : prev));
    };

    recognition.start();
  }, [isSupported, sessionId, sendToAgent, stopAndClearQueue]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setVoiceState("idle");
  }, []);

  const interrupt = useCallback(() => {
    stopAndClearQueue();
    startListening();
  }, [stopAndClearQueue, startListening]);

  const dismissError = useCallback(() => {
    stopAndClearQueue();
    setVoiceState("idle");
    setError(null);
    setTranscript("");
  }, [stopAndClearQueue]);

  // Space bar shortcut — interrupt or start listening without hunting for the button
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (e.repeat) return; // ignore key-repeat — only act on the first press
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return;
      e.preventDefault();
      if (voiceState === "speaking") interrupt();
      else if (voiceState === "idle") startListening();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [voiceState, interrupt, startListening]);

  // ── Render ────────────────────────────────────────────────────────────────

  const sessionReady = sessionId !== null;

  return (
    <div className="flex shrink-0 items-center gap-4 border-t bg-card px-6 py-3">
      {/* Status / transcript */}
      <div className="flex min-w-0 flex-1 items-center text-sm">
        {!sessionReady && (
          <span className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            Starting AI presenter...
          </span>
        )}
        {sessionReady && voiceState === "idle" && (
          <span className="text-muted-foreground">
            Press mic or Space to ask a question
          </span>
        )}
        {sessionReady && voiceState === "listening" && (
          <span className="font-medium text-primary animate-pulse">
            Listening...
          </span>
        )}
        {sessionReady && voiceState === "thinking" && (
          <span className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            <span className="truncate">
              {transcript ? (
                <>
                  &ldquo;{transcript}&rdquo;
                  {" — "}
                  <span className="italic">Thinking...</span>
                </>
              ) : (
                <span className="italic">Preparing presentation...</span>
              )}
            </span>
          </span>
        )}
        {sessionReady && voiceState === "speaking" && (
          <span className="flex items-center gap-2 text-emerald-500">
            <Volume2 className="h-3.5 w-3.5 shrink-0" />
            Speaking...
            <span className="text-muted-foreground">(tap mic or Space to interrupt)</span>
          </span>
        )}
        {sessionReady && voiceState === "error" && error && (
          <span className="text-destructive">
            {error}{" "}
            <button
              onClick={dismissError}
              className="ml-1 underline underline-offset-2 hover:opacity-80"
            >
              Dismiss
            </button>
          </span>
        )}
      </div>

      {/* Mic button */}
      {!isSupported ? (
        <span className="shrink-0 text-xs text-destructive">
          Voice not supported — use Chrome or Edge
        </span>
      ) : (
        <button
          onClick={
            !sessionReady
              ? undefined
              : voiceState === "listening"
                ? stopListening
                : voiceState === "speaking"
                  ? interrupt
                  : startListening
          }
          disabled={!sessionReady || voiceState === "thinking"}
          aria-label={
            !sessionReady
              ? "Starting session..."
              : voiceState === "listening"
                ? "Stop listening"
                : voiceState === "speaking"
                  ? "Interrupt and ask a question"
                  : "Start listening"
          }
          className={[
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all",
            !sessionReady || voiceState === "thinking"
              ? "cursor-not-allowed bg-muted text-muted-foreground"
              : voiceState === "listening"
                ? "bg-red-500 text-white shadow-lg ring-4 ring-red-500/30"
                : voiceState === "speaking"
                  ? "bg-amber-500 text-white shadow hover:bg-amber-600 active:scale-95"
                  : "bg-primary text-primary-foreground shadow hover:bg-primary/90 active:scale-95",
          ].join(" ")}
        >
          {!sessionReady || voiceState === "thinking" ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : voiceState === "listening" ? (
            <MicOff className="h-5 w-5" />
          ) : (
            <Mic className="h-5 w-5" />
          )}
        </button>
      )}
    </div>
  );
}
