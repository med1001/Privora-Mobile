import AsyncStorage from "@react-native-async-storage/async-storage";

const RECIPIENT_KEY = "@privora/pushRecipient";
const TOKEN_KEY = "@privora/cachedIdToken";
let localRecipient: string | null | undefined;
let revision = 0;
let writes: Promise<unknown> = Promise.resolve();

export function normalizeRecipient(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function write(operation: () => Promise<void>): Promise<void> {
  const result = writes.then(operation);
  writes = result.catch(() => undefined);
  return result;
}

/** Block old messages synchronously, then persist for headless/cold starts. */
export function setPushRecipient(value: string | null): Promise<void> {
  localRecipient = normalizeRecipient(value) || null;
  revision += 1;
  const recipient = localRecipient;
  return write(async () => {
    if (recipient) await AsyncStorage.setItem(RECIPIENT_KEY, recipient);
    else await AsyncStorage.removeItem(RECIPIENT_KEY);
    await AsyncStorage.removeItem(TOKEN_KEY);
  });
}

export async function isCurrentPushRecipient(value: unknown): Promise<boolean> {
  const expected = normalizeRecipient(value);
  if (!expected || (localRecipient !== undefined && localRecipient !== expected)) return false;
  const version = revision;
  try {
    // Read every time: a background runtime must observe a foreground logout.
    const stored = await AsyncStorage.getItem(RECIPIENT_KEY);
    return version === revision && stored === expected;
  } catch {
    return false;
  }
}

export function cacheIdToken(token: string, recipient: string): Promise<void> {
  const version = revision;
  return write(async () => {
    if (version !== revision || !token || !(await isCurrentPushRecipient(recipient))) return;
    await AsyncStorage.setItem(TOKEN_KEY, JSON.stringify({ recipient: normalizeRecipient(recipient), token }));
  }).catch(() => undefined);
}

export async function readCachedIdToken(recipient: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(TOKEN_KEY);
    const cached = raw ? JSON.parse(raw) : null;
    if (cached?.recipient !== normalizeRecipient(recipient) || !(await isCurrentPushRecipient(recipient))) return null;
    return typeof cached.token === "string" ? cached.token : null;
  } catch {
    return null;
  }
}
