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

## 1.5.1

Sending a Single result to a Multi character no longer bakes the LoRA trigger words into the prompt as plain text — the @triggers chip keeps its place, order and on/off state, so the words are no longer inserted twice when the character has automatic trigger words on · Wildcard names in Korean and other non-Latin scripts now work: #이름 is recognised as a pool heading, replaced on generation, and offered in autocomplete. Full details in the commit history.

## 1.5.0

LoRA cards rebuilt around the preview image — filename on a single line, trigger words and buttons only on hover, so far more cards fit on screen · Favourites and in-stack are filters now instead of pinned sections, so cards stay where you found them as you add and remove LoRAs · Styles can be favourited too · Tag weights without typing brackets: Alt+arrows, Alt+wheel or Alt+drag on any prompt field, Alt+middle-click to clear, and selecting several tags wraps them in one weight · The same controls work on LoRA strength, which now accepts negative values and can be cleared · Fixed Ultimate SD Upscale failing with "no upscale model selected" · Fixed reusing an older generation silently dropping parameters added since · Removed the CivitAI update check. Full details in the commit history.

## 1.4.0

Wildcards: write #name in a prompt and a random line from that pool is used on every generation — with a built-in editor and autocomplete · The slot prompt insertion point is now a draggable @slot chip inside Base positive, replacing the separate position picker · Preset-only Base prompts in Multi: give a character a different positive or negative for just one preset tab · Closing a preset tab now keeps its finished results, and reopening restores them · Loading a past image or applying a style now restores trigger words exactly as they were · Various fixes. Full details in the commit history.

## 1.3.0

Workspaces in Single mode — a separate output folder, image history and settings per workspace · Much better inpainting: small areas like a face are redrawn at full resolution and blended into the surrounding lighting instead of looking soft · Automatic LoRA trigger words in Multi character Base · Presets stay in sync across characters · Curation: arrow keys to move between images and slots, click an image's seed to reuse it · Various fixes. Full details in the commit history.
