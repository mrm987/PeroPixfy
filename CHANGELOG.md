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

## 1.3.0

Workspaces in Single mode — a separate output folder, image history and settings per workspace · Much better inpainting: small areas like a face are redrawn at full resolution and blended into the surrounding lighting instead of looking soft · Automatic LoRA trigger words in Multi character Base · Presets stay in sync across characters · Curation: arrow keys to move between images and slots, click an image's seed to reuse it · Various fixes. Full details in the commit history.
