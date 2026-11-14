/**
 * tests/storage-migration.test.js
 *
 * Verifies one-way data migration, zero data loss, backup creation, and JSON export/restore.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  StorageAdapter,
  runStorageMigration,
  exportAllUserData,
  restoreUserData,
  KEY_SCHEMA_VERSION,
  KEY_BACKUP_V1,
  KEY_PROFILE,
  KEY_SETTINGS,
  KEY_HISTORY,
  CURRENT_SCHEMA_VERSION,
} from "../bundle/storage-migration.js";

describe("Storage Migration & Safety (Safety Rule 2)", () => {
  it("migrates from unversioned (v0) state, creating safety backup and default v2 schema", () => {
    const memory = new StorageAdapter();

    // Seed v0 data
    memory.setRaw("speakup_agent_session_uuid", "uuid-12345");
    memory.setRaw("speakup_user_name", "Jane");
    memory.set("speakup_history", [
      { id: "sess-1", scenario: "introduction", date: "2026-11-01" },
    ]);

    // Run migration
    const res = runStorageMigration(memory);
    assert.equal(res.migrated, true);
    assert.equal(res.fromVersion, 0);
    assert.equal(res.toVersion, CURRENT_SCHEMA_VERSION);

    // Verify backup created
    const backup = memory.get(KEY_BACKUP_V1);
    assert.ok(backup);
    assert.equal(backup.keys.speakup_agent_session_uuid, "uuid-12345");
    assert.equal(backup.keys.speakup_user_name, "Jane");

    // Verify v2 profile preserved old name
    const profile = memory.get(KEY_PROFILE);
    assert.ok(profile);
    assert.equal(profile.displayName, "Jane");
    assert.equal(profile.version, 2);

    // Verify v2 history preserved old sessions
    const history = memory.get(KEY_HISTORY);
    assert.equal(history.length, 1);
    assert.equal(history[0].scenario, "introduction");

    // Verify version stamp updated
    assert.equal(memory.get(KEY_SCHEMA_VERSION), CURRENT_SCHEMA_VERSION);
  });

  it("is idempotent when run multiple times on already-migrated storage", () => {
    const memory = new StorageAdapter();
    memory.set(KEY_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION);
    memory.set(KEY_PROFILE, { displayName: "ExistingUser", version: 2 });

    const res = runStorageMigration(memory);
    assert.equal(res.migrated, false);
    assert.equal(res.fromVersion, CURRENT_SCHEMA_VERSION);

    const profile = memory.get(KEY_PROFILE);
    assert.equal(profile.displayName, "ExistingUser");
  });

  it("exports complete data bundle including APS KV data", () => {
    const memory = new StorageAdapter();
    runStorageMigration(memory);

    const apsMock = {
      notebook: [{ id: "note_1", mistake: "He go", correction: "He goes" }],
      progress: { sessions_completed: 4, minutes_practised: 40 },
    };

    const exported = exportAllUserData(memory, apsMock);
    assert.equal(exported.app, "speakup-ai");
    assert.equal(exported.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(exported.aps.notebook.length, 1);
    assert.equal(exported.profile.version, 2);
  });

  it("restores user data safely with pre-restore safety snapshot", () => {
    const memory = new StorageAdapter();
    runStorageMigration(memory);

    const restorePayload = {
      app: "speakup-ai",
      schemaVersion: 2,
      profile: { displayName: "RestoredAlice", targetCefr: "B2", version: 2 },
      settings: { handsFreeMode: true, silenceThresholdMs: 2000, version: 2 },
      history: [{ id: "sess-restored", scenario: "travel" }],
    };

    const restoreRes = restoreUserData(restorePayload, memory);
    assert.equal(restoreRes.success, true);

    // Verify restored data
    const profile = memory.get(KEY_PROFILE);
    assert.equal(profile.displayName, "RestoredAlice");
    assert.equal(profile.targetCefr, "B2");

    const settings = memory.get(KEY_SETTINGS);
    assert.equal(settings.handsFreeMode, true);
    assert.equal(settings.silenceThresholdMs, 2000);

    const history = memory.get(KEY_HISTORY);
    assert.equal(history.length, 1);
    assert.equal(history[0].id, "sess-restored");

    // Verify safety pre-restore backup exists
    const preRestore = memory.get("speakup_pre_restore_backup");
    assert.ok(preRestore);
  });

  it("rejects invalid restore files cleanly", () => {
    const memory = new StorageAdapter();
    const badRes = restoreUserData("not an object", memory);
    assert.equal(badRes.success, false);

    const wrongAppRes = restoreUserData({ app: "other-app" }, memory);
    assert.equal(wrongAppRes.success, false);
  });
});

