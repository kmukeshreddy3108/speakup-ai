#!/usr/bin/env node
/**
 * check-describe.js
 *
 * Smoke-tests and validates the Executa plugin's describe handshake and lifecycle
 * against official Anna Tool Executa Protocol rules (Guide 102).
 */

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const VALID_TYPES = new Set(["string", "integer", "number", "boolean", "array", "object"]);

async function testTarget(targetName, cmd, args, cwd) {
  console.log(`\n▶ Checking ${targetName}...`);
  console.log(`  command: ${cmd} ${args.join(" ")}`);
  console.log(`  cwd: ${cwd}`);

  const startMs = Date.now();
  const proc = spawn(cmd, args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  let stdoutBuffer = "";
  let stderrBuffer = "";
  const lines = [];

  proc.stdout.setEncoding("utf-8");
  proc.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    let idx;
    while ((idx = stdoutBuffer.indexOf("\n")) !== -1) {
      const line = stdoutBuffer.slice(0, idx).trim();
      stdoutBuffer = stdoutBuffer.slice(idx + 1);
      if (line) lines.push(line);
    }
  });

  proc.stderr.setEncoding("utf-8");
  proc.stderr.on("data", (chunk) => {
    stderrBuffer += chunk;
  });

  // Step 1: Send describe
  const req1 = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "describe" }) + "\n";
  proc.stdin.write(req1);

  // Wait for response 1
  let waited = 0;
  while (lines.length === 0 && waited < 5000) {
    await new Promise((r) => setTimeout(r, 50));
    waited += 50;
  }

  if (lines.length === 0) {
    proc.kill();
    throw new Error(`[FAIL] ${targetName}: describe timed out after 5s without response. stderr: ${stderrBuffer}`);
  }

  const describeDuration = Date.now() - startMs;
  console.log(`  ✓ describe responded in ${describeDuration}ms`);

  // Step 2: Validate describe response
  const rawResp1 = lines[0];
  let resp1;
  try {
    resp1 = JSON.parse(rawResp1);
  } catch (e) {
    throw new Error(`[FAIL] ${targetName}: describe response is not valid JSON: ${rawResp1}`);
  }

  if (resp1.jsonrpc !== "2.0") {
    throw new Error(`[FAIL] ${targetName}: expected jsonrpc: '2.0', got: '${resp1.jsonrpc}'`);
  }
  if (resp1.id !== 1) {
    throw new Error(`[FAIL] ${targetName}: expected id: 1, got: ${resp1.id}`);
  }
  if (!resp1.result || typeof resp1.result !== "object") {
    throw new Error(`[FAIL] ${targetName}: expected result object, got: ${JSON.stringify(resp1.result)}`);
  }

  const manifest = resp1.result;
  if (!manifest.name || typeof manifest.name !== "string") {
    throw new Error(`[FAIL] ${targetName}: manifest.name must be non-empty string`);
  }
  if (!manifest.version || typeof manifest.version !== "string") {
    throw new Error(`[FAIL] ${targetName}: manifest.version must be SemVer string`);
  }
  if (!Array.isArray(manifest.tools) || manifest.tools.length === 0) {
    throw new Error(`[FAIL] ${targetName}: manifest.tools must be a non-empty array`);
  }

  for (const tool of manifest.tools) {
    if (!tool.name || typeof tool.name !== "string") {
      throw new Error(`[FAIL] ${targetName}: tool missing valid name`);
    }
    if (!tool.description || typeof tool.description !== "string") {
      throw new Error(`[FAIL] ${targetName}: tool '${tool.name}' missing valid description`);
    }
    if (!Array.isArray(tool.parameters)) {
      throw new Error(
        `[FAIL] ${targetName}: tool '${tool.name}' parameters MUST be an array of objects (got ${typeof tool.parameters})`
      );
    }
    for (const p of tool.parameters) {
      if (!p.name || typeof p.name !== "string") {
        throw new Error(`[FAIL] ${targetName}: tool '${tool.name}' parameter missing name`);
      }
      if (!p.type || !VALID_TYPES.has(p.type)) {
        throw new Error(`[FAIL] ${targetName}: tool '${tool.name}' param '${p.name}' invalid type '${p.type}'`);
      }
      if (p.type === "array" && !p.items && !p.items_type) {
        throw new Error(`[FAIL] ${targetName}: tool '${tool.name}' array param '${p.name}' missing items/items_type`);
      }
    }
  }

  console.log(`  ✓ manifest verified: ${manifest.name} v${manifest.version} (${manifest.tools.length} tools)`);

  // Step 3: Send follow-up request (health) to verify the process stays alive
  const req2 = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "health" }) + "\n";
  proc.stdin.write(req2);

  waited = 0;
  while (lines.length < 2 && waited < 3000) {
    await new Promise((r) => setTimeout(r, 50));
    waited += 50;
  }

  if (lines.length < 2) {
    proc.kill();
    throw new Error(`[FAIL] ${targetName}: follow-up health request timed out`);
  }

  const rawResp2 = lines[1];
  const resp2 = JSON.parse(rawResp2);
  if (resp2.id !== 2 || resp2.result?.status !== "ready") {
    throw new Error(`[FAIL] ${targetName}: unexpected health response: ${rawResp2}`);
  }
  console.log(`  ✓ follow-up request succeeded (process remained alive)`);

  // Step 4: Close stdin and assert clean exit within 3s
  proc.stdin.end();

  const exitPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`[FAIL] ${targetName}: process failed to exit cleanly within 3s after stdin closed`));
    }, 3000);

    proc.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });

  const { code } = await exitPromise;
  if (code !== 0 && code !== null) {
    throw new Error(`[FAIL] ${targetName}: process exited with non-zero code ${code}`);
  }
  console.log(`  ✓ clean exit on EOF (code: ${code ?? 0})`);
  console.log(`✔ ${targetName} PASSED all protocol checks.\n`);
}

async function main() {
  console.log("=== Anna Executa Describe & Protocol Checker ===\n");

  // Target 1: Source plugin
  const pyDir = resolve(ROOT, "executas/speakup-ai");
  await testTarget(
    "Source Plugin (Python)",
    "python",
    ["speakup_ai_plugin.py"],
    pyDir
  );

  // Target 2: Built binary if present
  const winBin = resolve(pyDir, "dist/speakup-ai/0.3.2/speakup-ai-0.3.2-windows-x86_64.zip");
  const extractedBin = resolve(ROOT, "scratch/clean_binary_test/bin/tool-dev-speakup-ai.exe");
  if (existsSync(extractedBin)) {
    await testTarget(
      "Extracted Windows Binary",
      extractedBin,
      [],
      dirname(extractedBin)
    );
  } else {
    console.log(`ℹ Extracted binary not found at ${extractedBin} (run build or extract to test binary).`);
  }

  console.log("All checked Executa targets passed successfully!");
}

main().catch((err) => {
  console.error("\n" + err.message);
  process.exit(1);
});
