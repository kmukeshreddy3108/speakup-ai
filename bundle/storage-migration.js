/**
 * bundle/storage-migration.js
 *
 * Robust, one-way versioned storage migration and user data export/restore for SpeakUp AI.
 * Adheres strictly to Safety Rule 2 (Zero data loss, automatic backup, export/restore).
 */

export const CURRENT_SCHEMA_VERSION = 2;
export const KEY_SCHEMA_VERSION = "speakup_schema_version";
export const KEY_BACKUP_V1 = "speakup_backup_v1";
export const KEY_PROFILE = "speakup_learner_profile_v2";
export const KEY_HISTORY = "speakup_history_v2";
export const KEY_SETTINGS = "speakup_settings_v2";
export const KEY_AGENT_SESSION_UUID = "speakup_agent_session_uuid";

/**
 * Default Learner Profile
 */
export const DEFAULT_PROFILE = {
  version: 2,
  onboardingCompleted: false,
  displayName: "Learner",
  nativeLanguage: "English (ESL)",
  primaryGoal: "Everyday conversational fluency",
  targetCefr: "B1", // A1, A2, B1, B2, C1
  correctionStyle: "balanced", // gentle | balanced | strict
  dailyGoalMins: 10,
  topicsOfInterest: ["Daily Life", "Travel", "Workplace"],
  knownVocabularyCount: 0,
  confidenceRating: 3, // 1 to 5
  memoryHighlights: [], // Coach memory points, e.g. "prefers tech topics"
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/**
 * Default User Settings
 */
export const DEFAULT_SETTINGS = {
  version: 2,
  handsFreeMode: false,
  silenceThresholdMs: 1800,
  autoAdvanceTurn: false,
  audioPlaybackSpeed: 1.0,
  speechPitch: 1.0,
  selectedVoiceUri: "",
  audioDevicePreference: "default",
  voiceCommandsEnabled: true,
  screenWakeLockEnabled: true,
  soundEffects: true,
  aiCorrectionsEnabled: true,
  learnerLanguageTranslations: false,
  fontSize: "medium", // 'medium' | 'large'
  updatedAt: new Date().toISOString(),
};

/**
 * Safe local storage wrapper that works in both browser and node/test environments.
 */
export class StorageAdapter {
  constructor(backend = null) {
    if (backend) {
      this.backend = backend;
    } else if (typeof window !== "undefined" && window.localStorage) {
      this.backend = window.localStorage;
    } else {
      // In-memory fallback for testing
      this._map = new Map();
      this.backend = {
        getItem: (k) => (this._map.has(k) ? this._map.get(k) : null),
        setItem: (k, v) => this._map.set(k, String(v)),
        removeItem: (k) => this._map.delete(k),
        clear: () => this._map.clear(),
        get length() {
          return this._map.size;
        },
        key: (i) => Array.from(this._map.keys())[i] || null,
      };
    }
  }

  get(key, defaultValue = null) {
    try {
      const raw = this.backend.getItem(key);
      if (raw === null || raw === undefined) return defaultValue;
      return JSON.parse(raw);
    } catch {
      return defaultValue;
    }
  }

  set(key, value) {
    try {
      this.backend.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn("StorageAdapter set failed:", e);
      return false;
    }
  }

  remove(key) {
    try {
      this.backend.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  getRaw(key) {
    try {
      return this.backend.getItem(key);
    } catch {
      return null;
    }
  }

  setRaw(key, value) {
    try {
      this.backend.setItem(key, String(value));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Run safe storage migration.
 * @param {StorageAdapter} storage
 * @returns {{ migrated: boolean, fromVersion: number, toVersion: number }}
 */
export function runStorageMigration(storage = new StorageAdapter()) {
  const currentVer = Number(storage.get(KEY_SCHEMA_VERSION, 0)) || 0;

  if (currentVer >= CURRENT_SCHEMA_VERSION) {
    return { migrated: false, fromVersion: currentVer, toVersion: CURRENT_SCHEMA_VERSION };
  }

  // 1. Create safety backup of all existing speakup keys
  const backupPayload = {
    migratedAt: new Date().toISOString(),
    fromVersion: currentVer,
    keys: {},
  };

  const knownOldKeys = [
    KEY_AGENT_SESSION_UUID,
    "speakup_history",
    "speakup_profile",
    "speakup_settings",
    "speakup_user_name",
  ];

  for (const k of knownOldKeys) {
    const rawVal = storage.getRaw(k);
    if (rawVal !== null) {
      backupPayload.keys[k] = rawVal;
    }
  }

  storage.set(KEY_BACKUP_V1, backupPayload);

  // 2. Migrate or initialize Profile
  let profile = storage.get(KEY_PROFILE);
  if (!profile) {
    // Check if old profile or name existed
    const oldName = storage.get("speakup_user_name") || storage.getRaw("speakup_user_name") || "";
    profile = {
      ...DEFAULT_PROFILE,
      displayName: oldName || DEFAULT_PROFILE.displayName,
      onboardingCompleted: false,
    };
    storage.set(KEY_PROFILE, profile);
  }

  // 3. Migrate or initialize Settings
  let settings = storage.get(KEY_SETTINGS);
  if (!settings) {
    settings = { ...DEFAULT_SETTINGS };
    storage.set(KEY_SETTINGS, settings);
  } else {
    // Fill in any new settings keys without overwriting user choices
    settings = { ...DEFAULT_SETTINGS, ...settings, version: 2 };
    storage.set(KEY_SETTINGS, settings);
  }

  // 4. Migrate or initialize History
  let history = storage.get(KEY_HISTORY);
  if (!history || !Array.isArray(history)) {
    const oldHistory = storage.get("speakup_history");
    if (Array.isArray(oldHistory)) {
      history = oldHistory;
    } else {
      history = [];
    }
    storage.set(KEY_HISTORY, history);
  }

  // 5. Update schema version stamp
  storage.set(KEY_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION);

  return {
    migrated: true,
    fromVersion: currentVer,
    toVersion: CURRENT_SCHEMA_VERSION,
  };
}

/**
 * Export all user data as an omnibus JSON object.
 * @param {StorageAdapter} storage
 * @param {object} [apsData={}] - Extra data fetched from APS (e.g. notebook, progress)
 * @returns {object}
 */
export function exportAllUserData(storage = new StorageAdapter(), apsData = {}) {
  return {
    exportDate: new Date().toISOString(),
    app: "speakup-ai",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    profile: storage.get(KEY_PROFILE, DEFAULT_PROFILE),
    settings: storage.get(KEY_SETTINGS, DEFAULT_SETTINGS),
    history: storage.get(KEY_HISTORY, []),
    backup: storage.get(KEY_BACKUP_V1, null),
    aps: apsData,
  };
}

/**
 * Restore user data from a previously exported JSON object.
 * @param {object} payload
 * @param {StorageAdapter} storage
 * @returns {{ success: boolean, message: string }}
 */
export function restoreUserData(payload, storage = new StorageAdapter()) {
  if (!payload || typeof payload !== "object") {
    return { success: false, message: "Invalid backup file: not a JSON object." };
  }

  if (payload.app && payload.app !== "speakup-ai") {
    return { success: false, message: "Invalid backup file: file is not from SpeakUp AI." };
  }

  // Safety backup before overwriting
  const currentProfile = storage.get(KEY_PROFILE);
  const currentSettings = storage.get(KEY_SETTINGS);
  const currentHistory = storage.get(KEY_HISTORY);

  storage.set("speakup_pre_restore_backup", {
    restoredAt: new Date().toISOString(),
    profile: currentProfile,
    settings: currentSettings,
    history: currentHistory,
  });

  if (payload.profile && typeof payload.profile === "object") {
    storage.set(KEY_PROFILE, { ...DEFAULT_PROFILE, ...payload.profile, version: 2 });
  }

  if (payload.settings && typeof payload.settings === "object") {
    storage.set(KEY_SETTINGS, { ...DEFAULT_SETTINGS, ...payload.settings, version: 2 });
  }

  if (Array.isArray(payload.history)) {
    storage.set(KEY_HISTORY, payload.history);
  }

  storage.set(KEY_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION);

  return { success: true, message: "Data successfully restored." };
}
