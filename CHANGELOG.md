# Changelog

Short release blurbs for the ComfyUI Registry — **not** the full history. The detailed
record is the git commit history: https://github.com/mrm987/PeroPixfy/commits/main

The publish workflow sends the section matching `version` in `pyproject.toml` to the
registry's changelog field, so:

- Keep the `## <version>` headings exact — the workflow matches on them.
- **Write plain text, one short paragraph.** The registry renders this field as plain
  text: it does not parse Markdown (`**bold**` shows the asterisks) and it collapses
  newlines, so bullets and line breaks end up as one run-on line. Use ` · ` to separate
  points instead.

## 1.4.0

Wildcards: write #name in a prompt and a random line from that pool is used on every generation — with a built-in editor and autocomplete · The slot prompt insertion point is now a draggable @slot chip inside Base positive, replacing the separate position picker · Preset-only Base prompts in Multi: give a character a different positive or negative for just one preset tab · Closing a preset tab now keeps its finished results, and reopening restores them · Loading a past image or applying a style now restores trigger words exactly as they were · Various fixes. Full details in the commit history.

## 1.3.0

Workspaces in Single mode — a separate output folder, image history and settings per workspace · Much better inpainting: small areas like a face are redrawn at full resolution and blended into the surrounding lighting instead of looking soft · Automatic LoRA trigger words in Multi character Base · Presets stay in sync across characters · Curation: arrow keys to move between images and slots, click an image's seed to reuse it · Various fixes. Full details in the commit history.
