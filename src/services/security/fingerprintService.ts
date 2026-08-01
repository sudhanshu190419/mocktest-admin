/**
 * Fingerprint Service (Phase 7E)
 *
 * Computes a stable, cross-browser device fingerprint that identifies the
 * PHYSICAL MACHINE rather than the browser. This enables "same physical
 * device recognition": once a machine is approved (via one browser), every
 * other browser on that machine can re-issue a fresh token without a new
 * approval.
 *
 * ## Signal philosophy
 *
 * Only stable machine characteristics are used — the same values regardless
 * of browser, cookie state, or reinstallation:
 *
 *   - Platform (OS family — via navigator.platform, the ONE source used by
 *     every browser; navigator.userAgentData is Chromium-only and would
 *     produce different values on Firefox/Safari)
 *   - Screen width / height / color depth
 *   - Timezone
 *   - Hardware concurrency (CPU cores)
 *
 * The WebGL GPU renderer is deliberately EXCLUDED (Phase 7E.1): on Windows
 * laptops with Optimus / hybrid graphics, different browsers can be routed
 * to DIFFERENT GPUs on the same physical machine (Chrome → NVIDIA,
 * Edge → Intel UHD), producing different renderer strings and therefore
 * different hashes. Only signals that are identical across every browser
 * on one machine are used.
 *
 * ## Cross-browser stability rule (CRITICAL)
 *
 * Every signal MUST produce the SAME value in every browser on the same
 * machine, otherwise two browsers on one laptop hash differently and the
 * whole feature fails. Signals that are browser-specific or per-browser
 * preferences are therefore EXCLUDED: navigator.deviceMemory is
 * Chromium-only (Chrome hashes 8, Firefox hashes null); navigator.userAgentData
 * is Chromium-only; and navigator.languages is a PER-BROWSER preference
 * (Chrome can be English while Firefox is Hindi on the same laptop — the
 * fingerprints would differ and the feature would degrade to a new approval
 * for every second browser). The WebGL GPU renderer is ALSO excluded: on
 * Optimus / hybrid-graphics Windows laptops, Chrome and Edge can be routed
 * to different physical GPUs (ANGLE/NVIDIA vs ANGLE/Intel UHD), so the
 * renderer string is browser-dependent on the SAME machine. Only signals
 * exposed uniformly by Chrome, Edge, Firefox, Safari and Brave are used.
 *
 * Deliberately EXCLUDED (would identify the browser, not the machine, or are
 * privacy-invasive): installed fonts, plugins, browser version/name, battery,
 * sensors, viewport size, cookies, preferred languages, WebGL GPU renderer.
 *
 * ## Canonicalization
 *
 * Signals are lowercased, key-sorted, JSON-stringified, then SHA-256 hashed.
 * Only the hash is ever returned — raw fingerprint data never leaves the
 * browser and is never stored server-side.
 *
 * ## Failure mode
 *
 * `computeDeviceFingerprint()` returns `null` on any failure. The caller must
 * treat null as "fingerprint unavailable" and continue — fingerprinting must
 * NEVER block login (the token path still works).
 *
 * @module services/security/fingerprintService
 */

// ─── Signal collection helpers ──────────────────────────────────────────────

/**
 * OS platform family.
 *
 * Uses ONLY navigator.platform — the single value exposed by every browser
 * ("Win32", "MacIntel", "Linux x86_64", "iPhone", ...). navigator.userAgentData
 * is Chromium-only (Chrome: "Windows", Firefox: n/a) and must NOT be used:
 * two browsers on the same machine would produce different platform values
 * and therefore different fingerprints.
 */
function getPlatform(): string {
  try {
    return navigator.platform || 'unknown';
  } catch {
    return 'unknown';
  }
}

/** IANA timezone of the machine (e.g. "Asia/Kolkata"). */
function getTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
  } catch {
    return 'unknown';
  }
}

// ─── Hashing ─────────────────────────────────────────────────────────────────

/** SHA-256 hex digest of the canonicalized signal JSON. */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Compute a stable machine fingerprint (SHA-256 hex).
 *
 * Returns `null` on any failure — callers must NEVER block login on a null
 * fingerprint. Only the hash is returned; raw signals never leave the browser.
 */
export async function computeDeviceFingerprint(): Promise<string | null> {
  try {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return null;
    }

    // Collect raw signals (never sent anywhere — hashed below).
    const raw: Record<string, unknown> = {
      platform: getPlatform(),
      screenWidth: window.screen?.width ?? null,
      screenHeight: window.screen?.height ?? null,
      colorDepth: window.screen?.colorDepth ?? null,
      timezone: getTimezone(),
      hardwareConcurrency:
        typeof navigator.hardwareConcurrency === 'number'
          ? navigator.hardwareConcurrency
          : null,
      // NOTE: deviceMemory, languages and gpuRenderer are deliberately
      // EXCLUDED — deviceMemory is Chromium-only, languages is a per-browser
      // preference, and gpuRenderer differs between Chrome/Edge on Optimus
      // (hybrid-graphics) Windows laptops; each would make the hash
      // browser-dependent and break cross-browser matching on one machine.
    };

    // Canonicalize: lowercase all string values, sort keys for deterministic
    // output across browsers (cross-browser stability depends on this). All
    // current signals are strings or numbers/null, so no array handling is
    // needed (an array signal would be browser-specific by nature).
    const canonical: Record<string, unknown> = {};
    for (const key of Object.keys(raw).sort()) {
      const value = raw[key];
      canonical[key] =
        typeof value === 'string' ? value.toLowerCase() : value;
    }

    const json = JSON.stringify(canonical);

    // ── DIAGNOSTIC LOGGING (temporary — Phase 7E cross-browser comparison) ──
    // Logs the EXACT signal values + canonical JSON + hash so Chrome vs Edge
    // on the same machine can be compared side by side. No logic changed.
    console.log('[FP]', {
      platform: raw.platform,
      screenWidth: raw.screenWidth,
      screenHeight: raw.screenHeight,
      colorDepth: raw.colorDepth,
      timezone: raw.timezone,
      hardwareConcurrency: raw.hardwareConcurrency,
    });
    console.log('[FP] Canonical JSON', json);

    const fingerprintHash = await sha256Hex(json);
    console.log('[FP] SHA256', fingerprintHash);

    return fingerprintHash;
  } catch (err) {
    // Never surface, never block — fingerprinting is best-effort.
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[Fingerprint] computeDeviceFingerprint failed:', err);
    }
    return null;
  }
}
