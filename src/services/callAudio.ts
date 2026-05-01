import { Platform } from "react-native";

/**
 * Thin, defensive wrapper around `react-native-incall-manager`. The native
 * module is required for proper call audio routing (earpiece vs speaker,
 * proximity sensor, mic gain, etc.), but if it ever fails to link we want the
 * call itself to keep working - voice calls should never crash because audio
 * routing failed to initialise.
 */
type InCallManagerLike = {
  start: (opts?: { media?: "audio" | "video"; auto?: boolean; ringback?: string }) => void;
  stop: (opts?: { busytone?: string }) => void;
  setForceSpeakerphoneOn: (enabled: boolean) => void;
  setKeepScreenOn: (enabled: boolean) => void;
  setMicrophoneMute?: (muted: boolean) => void;
};

let cachedModule: InCallManagerLike | null | undefined;

function loadModule(): InCallManagerLike | null {
  if (cachedModule !== undefined) return cachedModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-incall-manager");
    cachedModule = (mod?.default ?? mod) as InCallManagerLike;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

function safeCall(fn: () => void) {
  try {
    fn();
  } catch {
    // Audio routing is best-effort; never throw out of these helpers.
  }
}

export const callAudio = {
  /** Begin a voice call audio session. Defaults audio to the earpiece. */
  startSession() {
    const m = loadModule();
    if (!m) return;
    safeCall(() => m.start({ media: "audio", auto: false }));
    safeCall(() => m.setKeepScreenOn(true));
    // Explicit earpiece by default to mimic a phone call.
    safeCall(() => m.setForceSpeakerphoneOn(false));
  },

  /** Tear down the audio session and restore normal media routing. */
  stopSession() {
    const m = loadModule();
    if (!m) return;
    safeCall(() => m.setForceSpeakerphoneOn(false));
    safeCall(() => m.setKeepScreenOn(false));
    safeCall(() => m.stop());
  },

  /** Switch between speakerphone (true) and earpiece/Bluetooth (false). */
  setSpeakerphone(enabled: boolean) {
    const m = loadModule();
    if (!m) return;
    safeCall(() => m.setForceSpeakerphoneOn(enabled));
  },

  /** True when the native module is available on this platform. */
  isAvailable(): boolean {
    if (Platform.OS === "web") return false;
    return loadModule() !== null;
  },
};
