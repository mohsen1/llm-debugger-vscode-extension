import json, pathlib, re
d = json.loads(pathlib.Path("package.json").read_text())
c = d["contributes"]
errs = []

if "viewsContainers" in c:
    errs.append("viewsContainers present (needs icon per container)")

for t in c.get("languageModelTools", []):
    for f in ("name", "displayName", "modelDescription"):
        if not isinstance(t.get(f), str):
            errs.append(f"tool {t.get('name')}: bad {f}")
    if t.get("canBeReferencedInPrompt") and not t.get("toolReferenceName"):
        errs.append(f"tool {t['name']}: canBeReferencedInPrompt without toolReferenceName")
    if not t.get("name", "").replace("-", "").replace("_", "").isalnum():
        errs.append(f"tool {t['name']}: id fails /^[\\w-]+$/")

for cmd in c.get("commands", []):
    if not cmd.get("command") or not cmd.get("title"):
        errs.append(f"command missing command/title: {cmd}")

for v in c.get("views", {}).get("debug", []):
    if not v.get("id") or not v.get("name"):
        errs.append(f"view missing id/name: {v}")

# top-level fields VSCode requires
for f in ("name", "publisher", "version", "engines"):
    if f not in d:
        errs.append(f"top-level {f} missing")

print("ERRORS:", errs if errs else "none — manifest clean")

# chat participant (verified against the workbench schema: required name+id,
# name must match /^[\w-]+$/, slash commands need names)
for part in c.get("chatParticipants", []):
    if not part.get("name") or not part.get("id"):
        errs.append("chat participant missing name/id")
    if not re.match(r"^[\w-]+$", part.get("name", "")):
        errs.append(f"participant bad name: {part.get('name')}")
    for cmd in part.get("commands", []):
        if not cmd.get("name"):
            errs.append("participant command missing name")
