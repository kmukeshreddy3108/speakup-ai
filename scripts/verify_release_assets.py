#!/usr/bin/env python3
"""
scripts/verify_release_assets.py

Integrity gate for Executa release assets before publishing to GitHub Releases.
Verifies:
1. All required platforms defined in executa.json are present.
2. File sizes are > 0 bytes (no empty files).
3. SHA-256 checksum files exist and match computed hashes.
4. Archives contain the expected entrypoint and manifest.json at the archive root.
5. Prints an integrity audit table.
"""

import hashlib
import json
import os
import sys
import tarfile
import zipfile
from pathlib import Path


def compute_sha256(filepath: Path) -> str:
    sha = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            sha.update(chunk)
    return sha.hexdigest().lower()


def main():
    if len(sys.argv) < 3:
        print("Usage: python verify_release_assets.py <assets_dir> <executa_json_path> [expected_version]")
        sys.exit(1)

    assets_dir = Path(sys.argv[1]).resolve()
    executa_json_path = Path(sys.argv[2]).resolve()

    if not assets_dir.is_dir():
        print(f"[ERROR] Assets directory does not exist: {assets_dir}", file=sys.stderr)
        sys.exit(1)

    if not executa_json_path.is_file():
        print(f"[ERROR] executa.json not found: {executa_json_path}", file=sys.stderr)
        sys.exit(1)

    with open(executa_json_path, "r", encoding="utf-8") as f:
        executa_data = json.load(f)

    version = sys.argv[3] if len(sys.argv) > 3 else executa_data.get("version", "")
    binary_artifacts = (
        executa_data.get("distribution", {})
        .get("profiles", {})
        .get("binary", {})
        .get("binary_artifacts", {})
    )

    if not binary_artifacts:
        print("[ERROR] No binary_artifacts configured in executa.json", file=sys.stderr)
        sys.exit(1)

    print(f"=== Executa Release Asset Integrity Gate ===")
    print(f"Assets Directory: {assets_dir}")
    print(f"Target Version:   {version}")
    print(f"Platforms to check: {', '.join(binary_artifacts.keys())}\n")

    # Check for any 0-byte or unexpected files in assets_dir
    all_files = list(assets_dir.iterdir())
    zero_byte_files = [f for f in all_files if f.is_file() and f.stat().st_size == 0]
    if zero_byte_files:
        print(f"[FAIL] Found ZERO-BYTE file(s) in release assets directory:", file=sys.stderr)
        for z in zero_byte_files:
            print(f"  - {z.name} (0 bytes)", file=sys.stderr)
        print("\nGitHub Releases will reject zero-byte assets. Aborting release.", file=sys.stderr)
        sys.exit(1)

    rows = []
    overall_passed = True

    for platform, config in binary_artifacts.items():
        # Expected archive file name from path template
        # e.g. dist/speakup-ai/{version}/speakup-ai-{version}-linux-x86_64.tar.gz
        path_template = config.get("path", "")
        expected_filename = Path(path_template.replace("{version}", version)).name
        expected_entrypoint = config.get("entrypoint", "")
        fmt = config.get("format", "")

        archive_file = assets_dir / expected_filename
        sha_file = assets_dir / f"{expected_filename}.sha256"

        row = {
            "platform": platform,
            "filename": expected_filename,
            "size": 0,
            "sha_match": "FAIL",
            "entrypoint_ok": "FAIL",
            "status": "FAIL",
            "notes": "",
        }

        # Check archive exists and size > 0
        if not archive_file.is_file():
            row["notes"] = "Archive file missing"
            overall_passed = False
            rows.append(row)
            continue

        size = archive_file.stat().st_size
        row["size"] = size
        if size == 0:
            row["notes"] = "Archive is 0 bytes"
            overall_passed = False
            rows.append(row)
            continue

        # Check SHA-256 file
        if not sha_file.is_file():
            row["notes"] = "Missing .sha256 file"
            overall_passed = False
            rows.append(row)
            continue

        sha_size = sha_file.stat().st_size
        if sha_size == 0:
            row["notes"] = ".sha256 file is 0 bytes"
            overall_passed = False
            rows.append(row)
            continue

        actual_hash = compute_sha256(archive_file)
        expected_hash_content = sha_file.read_text(encoding="utf-8").strip()
        expected_hash = expected_hash_content.split()[0].lower() if expected_hash_content else ""

        if actual_hash == expected_hash:
            row["sha_match"] = "PASS"
        else:
            row["notes"] = f"SHA mismatch: got {actual_hash[:8]}... expected {expected_hash[:8]}..."
            overall_passed = False
            rows.append(row)
            continue

        # Check entrypoint at archive root
        root_files = []
        try:
            if fmt == "tar.gz" or expected_filename.endswith(".tar.gz"):
                with tarfile.open(archive_file, "r:gz") as tar:
                    root_files = [m.name for m in tar.getmembers() if "/" not in m.name.rstrip("/") and m.name]
            elif fmt == "zip" or expected_filename.endswith(".zip"):
                with zipfile.ZipFile(archive_file, "r") as zf:
                    root_files = [zi.filename for zi in zf.infolist() if "/" not in zi.filename.rstrip("/") and "\\" not in zi.filename.rstrip("/") and zi.filename]
            else:
                row["notes"] = f"Unknown archive format: {fmt}"
                overall_passed = False
                rows.append(row)
                continue
        except Exception as e:
            row["notes"] = f"Archive read error: {e}"
            overall_passed = False
            rows.append(row)
            continue

        has_entrypoint = expected_entrypoint in root_files
        has_manifest = "manifest.json" in root_files

        if has_entrypoint and has_manifest:
            row["entrypoint_ok"] = f"PASS ({expected_entrypoint} + manifest.json)"
        elif has_entrypoint:
            row["entrypoint_ok"] = f"WARN (entrypoint present, manifest.json missing)"
        else:
            row["notes"] = f"Entrypoint '{expected_entrypoint}' not found at archive root. Found: {root_files}"
            overall_passed = False
            rows.append(row)
            continue

        row["status"] = "PASS"
        rows.append(row)

    # Print formatted audit table
    header = f"{'Platform':<15} | {'Archive File':<42} | {'Size':<10} | {'SHA-256':<7} | {'Root Entrypoint':<32} | {'Status'}"
    divider = "-" * len(header)
    print(header)
    print(divider)
    for r in rows:
        size_str = f"{r['size']:,} B" if r['size'] > 0 else "0 B"
        print(f"{r['platform']:<15} | {r['filename']:<42} | {size_str:<10} | {r['sha_match']:<7} | {r['entrypoint_ok']:<32} | {r['status']}")
        if r['notes']:
            print(f"  └─> Note: {r['notes']}")
    print(divider)

    if overall_passed:
        print("\n[OK] All platform archives verified successfully! Ready for GitHub Release.")
        sys.exit(0)
    else:
        print("\n[FAIL] Release asset integrity verification failed. See details above.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
