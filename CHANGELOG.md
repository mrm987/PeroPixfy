# Changelog

Release notes for the ComfyUI Registry. The publish workflow reads the section matching
the version in `pyproject.toml` and sends it to the registry, so keep the `## <version>`
headings exact.

## 1.3.0

**Workspaces (Single)**

Keep separate projects side by side. Each workspace has its own output folder, image history and generation settings, while styles and LoRAs stay shared. Renaming a workspace renames its folder too, so nothing gets split across two places. You can copy images to another workspace, and closing a tab keeps your data — reopen it any time from the "+" button. Images now save straight into the workspace folder, without date subfolders.

**Much better inpainting**

Painted areas are now redrawn at full model resolution and blended back into the picture, so small edits like a face come out as detailed as a full generation instead of looking soft. Edges blend into the surrounding lighting and colour rather than cutting off at the mask line. Two new sliders, Mask expand and Mask feather, let you tune how far the blend reaches.

**Automatic trigger words in Multi**

Character Base now manages LoRA trigger words as badges, the same way Single does — no more copying them across by hand and missing some. Each character keeps its own set. Existing characters start with this turned off so your current prompts are untouched; switch it on per character when you're ready, then delete the trigger words you had typed in manually.

**Multi**

- Resolution, Sampling, Advanced and LUT moved next to the slots
- Slots and sections can be collapsed; lock or unlock every slot at once
- Seed pinned next to the Generate button; preset picker moved into Slots
- Presets stay in sync when several characters share the same one
- A dot marks tabs where new images finished while you were looking elsewhere
- New tabs start collapsed, with every slot unlocked
- Deleting a slot warns you first if it still has images

**Curation**

- Left/Right arrows move between images, Up/Down between slots
- Double-click an image to open curation on that image
- Each image shows its seed — click it to reuse it

**Also**

Click a seed on a result to reuse it, sort LoRAs by how often they're used in styles, and tag autocomplete now works in slot prompts and includes Anima rating tags.

**Fixes**

- Seed not changing between generations in slot mode
- Deleting slots or images left the image files behind
- Mouse wheel did nothing in the empty area beside the slot list
- Tag search broke on apostrophes (for example `another's`)
- During curation, Delete removed the viewed image instead of the selected text
- Dropdowns did not scroll to show the current selection
