#!/usr/bin/env python3
"""Package an already-built, committed Stoplight candidate without rebuilding it."""

import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import posixpath
import re
import subprocess
import zipfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", type=Path, required=True)
    parser.add_argument("--build-receipt", type=Path, required=True,
                        help="Trusted clean-build receipt with source_commit, source_tree and dist_files SHA-256 map")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    git = lambda *argv: subprocess.check_output(["git", *argv], cwd=root, text=True).strip()
    if git("status", "--porcelain", "--untracked-files=no"):
        raise SystemExit("Commit tracked source changes before packaging a candidate.")
    revision = git("rev-parse", "HEAD")
    tree = git("rev-parse", "HEAD^{tree}")
    build_receipt = json.loads(args.build_receipt.read_text())
    if build_receipt.get("source_commit") != revision or build_receipt.get("source_tree") != tree:
        raise SystemExit("Build receipt does not identify this committed source tree.")
    source_manifest = json.loads((root / "extension/public/manifest.json").read_text())
    dist = args.dist.resolve()
    manifest = json.loads((dist / "manifest.json").read_text())
    if manifest != source_manifest:
        raise SystemExit("Built manifest differs from the committed source manifest.")
    version = manifest.get("version_name", manifest["version"])
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+-alpha\.[0-9]+", version):
        raise SystemExit("Expected an explicit alpha version_name.")
    files = {}
    for path in sorted(dist.rglob("*")):
        if path.is_symlink():
            raise SystemExit(f"Refusing symlink in bundle: {path.name}")
        if path.is_file():
            name = path.relative_to(dist).as_posix()
            if name not in {"manifest.json", "sidepanel.html"} and not name.startswith("assets/"):
                raise SystemExit(f"Unexpected bundle entry: {name}")
            files[name] = path.read_bytes()
    inventory = {name: digest(data) for name, data in sorted(files.items())}
    if inventory != build_receipt.get("dist_files"):
        raise SystemExit("Distribution files differ from the verified build receipt.")
    for name in (manifest["background"]["service_worker"], manifest["side_panel"]["default_path"]):
        if name not in files:
            raise SystemExit(f"Missing manifest asset: {name}")
    if not any(name.endswith(".wasm") for name in files):
        raise SystemExit("Missing WASM asset.")

    def require_asset(source, reference):
        if re.match(r"^[a-z]+:", reference) or reference.startswith("//"):
            return
        reference = reference.split("?", 1)[0].split("#", 1)[0]
        target = posixpath.normpath(reference.lstrip("/") if reference.startswith("/")
                                   else posixpath.join(posixpath.dirname(source), reference))
        if target not in files:
            raise SystemExit(f"Missing asset referenced by {source}: {reference}")

    class AssetParser(HTMLParser):
        def handle_starttag(self, tag, attrs):
            attrs = dict(attrs)
            if tag == "script" and attrs.get("src"):
                require_asset("sidepanel.html", attrs["src"])
            if tag == "link" and attrs.get("href"):
                require_asset("sidepanel.html", attrs["href"])

    AssetParser().feed(files["sidepanel.html"].decode())
    for name, data in files.items():
        if name.endswith(".js"):
            source = data.decode()
            for reference in re.findall(r'''(?:from|import)\s*\(?\s*["']([^"']+\.(?:js|css|wasm))["']''', source):
                require_asset(name, reference)
            for reference in re.findall(r'''new URL\(\s*["']([^"']+\.(?:js|css|wasm))["']''', source):
                require_asset(name, reference)
    files["LICENSE"] = (root / "LICENSE").read_bytes()
    files["THIRD_PARTY_NOTICES.txt"] = (root / "THIRD_PARTY_NOTICES.txt").read_bytes()
    identity = {
        "release": f"v{version}",
        "extension_version": manifest["version"],
        "manifest_version": manifest["manifest_version"],
        "source_commit": revision,
        "source_tree": tree,
        "files": {name: digest(data) for name, data in sorted(files.items())},
    }
    files["release-info.json"] = (json.dumps(identity, indent=2) + "\n").encode()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f"stoplight-v{version}.zip"
    if archive.exists():
        raise SystemExit(f"Refusing to replace existing candidate: {archive}")
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for name, data in sorted(files.items()):
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            bundle.writestr(entry, data)
    archive_hash = digest(archive.read_bytes())
    (output / "SHA256SUMS").write_text(f"{archive_hash}  {archive.name}\n")
    receipt = {**identity, "archive": archive.name, "sha256": archive_hash,
               "build_receipt_sha256": digest(args.build_receipt.read_bytes()),
               "packaged_files": {name: digest(data) for name, data in sorted(files.items())}}
    (output / "package-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({"archive": str(archive), "sha256": archive_hash, "source_commit": revision}, indent=2))


if __name__ == "__main__":
    main()
