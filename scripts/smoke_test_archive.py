#!/usr/bin/env python3
"""
scripts/smoke_test_archive.py

Validates an unpacked Executa binary and manifest against the Anna Tool Executa Protocol.
Used in GitHub Actions CI across Linux, macOS (x86_64 & arm64), and Windows runners.
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

VALID_TYPES = {"string", "integer", "number", "boolean", "array", "object"}


def main():
    if len(sys.argv) < 3:
        print("Usage: python smoke_test_archive.py <path_to_binary> <expected_version> [path_to_manifest]")
        sys.exit(1)

    raw_bin_path = sys.argv[1]
    expected_version = sys.argv[2]
    manifest_path = Path(sys.argv[3]).resolve() if len(sys.argv) > 3 else None

    bin_path = Path(raw_bin_path).resolve()
    print(f"=== Smoke Testing Binary Archive ===")
    print(f"Target Binary: {bin_path}")
    print(f"Expected Version: {expected_version}")

    if not bin_path.is_file():
        print(f"ERROR: Target binary does not exist: {bin_path}")
        sys.exit(1)

    # Ensure executable permissions on Unix
    if os.name != "nt":
        os.chmod(bin_path, 0o755)

    if manifest_path:
        print(f"Target Manifest: {manifest_path}")
        if not manifest_path.is_file():
            print(f"ERROR: Target manifest.json does not exist: {manifest_path}")
            sys.exit(1)
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest_json = json.load(f)
            assert manifest_json.get("version") == expected_version, (
                f"manifest.json version {manifest_json.get('version')} does not match expected {expected_version}"
            )
        print("✓ Root manifest.json verified")

    start_time = time.time()
    proc = None
    stdout_lines = []
    max_describe_duration = 15.0 if sys.platform == "win32" else 10.0
    try:
        proc = subprocess.Popen(
            [str(bin_path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

        # 1. Send describe
        req1 = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "describe"}) + "\n"
        proc.stdin.write(req1)
        proc.stdin.flush()

        line1 = proc.stdout.readline()
        describe_duration = time.time() - start_time
        if not line1:
            exit_code = proc.poll()
            stderr_info = ""
            if proc.stderr:
                try:
                    stderr_info = proc.stderr.read()
                except Exception:
                    pass
            raise RuntimeError(
                f"Empty stdout response for describe (duration: {describe_duration:.2f}s, exit code: {exit_code}, stderr: {stderr_info})"
            )
        stdout_lines.append(line1)

        if describe_duration > max_describe_duration:
            raise RuntimeError(f"Describe response exceeded {max_describe_duration}s limit: {describe_duration:.2f}s")

        resp1 = json.loads(line1.strip())
        assert resp1.get("jsonrpc") == "2.0", f"Invalid jsonrpc: {resp1}"
        assert resp1.get("id") == 1, f"Mismatched id: {resp1}"
        manifest = resp1.get("result")
        assert isinstance(manifest, dict), f"Result not dict: {manifest}"
        assert manifest.get("name") == "tool-dev-speakup-ai", f"Invalid name: {manifest.get('name')}"
        assert manifest.get("version") == expected_version, (
            f"Version mismatch: {manifest.get('version')} vs {expected_version}"
        )
        assert manifest.get("description"), "Missing manifest description"
        tools = manifest.get("tools")
        assert isinstance(tools, list) and len(tools) > 0, "Tools missing or empty"

        for t in tools:
            assert isinstance(t.get("name"), str) and t["name"], f"Invalid tool name: {t}"
            assert isinstance(t.get("description"), str), f"Missing description for {t.get('name')}"
            params = t.get("parameters")
            assert isinstance(params, list), f"Tool {t['name']} parameters MUST be list, got {type(params)}"
            for p in params:
                assert isinstance(p, dict), f"Param not dict: {p}"
                assert p.get("name"), f"Param missing name: {p}"
                assert p.get("type") in VALID_TYPES, f"Param {p.get('name')} invalid type: {p.get('type')}"
                if p.get("type") == "array":
                    assert "items" in p or "items_type" in p, f"Array param missing items: {p}"

        print(f"✓ Describe verified in {describe_duration:.2f}s: {manifest['name']} v{manifest['version']} ({len(tools)} tools)")

        # 2. Send health follow-up
        req2 = json.dumps({"jsonrpc": "2.0", "id": 2, "method": "health"}) + "\n"
        proc.stdin.write(req2)
        proc.stdin.flush()

        line2 = proc.stdout.readline()
        if not line2:
            raise RuntimeError("Empty stdout response for health")
        stdout_lines.append(line2)

        resp2 = json.loads(line2.strip())
        assert resp2.get("id") == 2, f"Mismatched id: {resp2}"
        assert resp2.get("result", {}).get("status") == "ready", f"Health not ready: {resp2}"
        print("✓ Health verified; process remained alive across multiple requests")

        # 3. Close stdin and assert clean exit
        proc.stdin.close()
        exit_code = proc.wait(timeout=10)
        assert exit_code == 0, f"Process non-zero exit code: {exit_code}"
        print(f"✓ Clean exit on stdin EOF (exit code: {exit_code})")

        # Save logs
        stderr_output = proc.stderr.read()
        Path("smoke_test_stdout.log").write_text("".join(stdout_lines), encoding="utf-8")
        Path("smoke_test_stderr.log").write_text(stderr_output, encoding="utf-8")
        print("✔ Smoke test PASSED successfully!")

    except Exception as exc:
        print(f"\n[ERROR] Smoke test failed: {exc}", file=sys.stderr)
        stderr_output = ""
        if proc and proc.stderr:
            try:
                stderr_output = proc.stderr.read()
            except Exception:
                pass
        if stderr_output:
            print(f"STDERR output:\n{stderr_output}", file=sys.stderr)
            Path("smoke_test_stderr.log").write_text(stderr_output, encoding="utf-8")
        if stdout_lines:
            Path("smoke_test_stdout.log").write_text("".join(stdout_lines), encoding="utf-8")
        sys.exit(1)

    finally:
        if proc and proc.poll() is None:
            proc.kill()


if __name__ == "__main__":
    main()

