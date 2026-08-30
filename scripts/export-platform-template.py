from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "platform-template"
DIST = ROOT / "dist" / "platform-template"
ARCHIVE = ROOT / "dist" / "ARGWS-Platform-Template"

if DIST.parent.exists():
    shutil.rmtree(DIST.parent)
DIST.parent.mkdir(parents=True, exist_ok=True)
shutil.copytree(SOURCE, DIST)
shutil.make_archive(str(ARCHIVE), "zip", root_dir=DIST.parent, base_dir=DIST.name)
print(f"Template exportado: {ARCHIVE}.zip")
