"""Style gallery: save ComfyUI-generated images as reusable workflow snapshots.

ComfyUI embeds the workflow JSON inside PNG `tEXt` chunks under the key
`workflow` (and `prompt`). We pull that JSON out, parse the LoRA/checkpoint
references, store the original image + workflow in our gallery, and let the
user load the workflow back into the canvas later.
"""

import os
import json
import hashlib

from PIL import Image

_STYLES_DIR = None
LORA_EXTS = (".safetensors", ".pt", ".ckpt")
WORKFLOW_KEYS = ("workflow", "prompt")
# Integrated checkpoint loaders (model + clip + vae bundled in one file).
CKPT_NODE_TYPES = ("CheckpointLoaderSimple", "CheckpointLoader",
                   "CheckpointLoaderSimpleWithNoiseSelect", "easy fullLoader")
# Split-model loaders — Flux/Qwen/SD3 workflows load the diffusion model
# separately from CLIP/VAE; the UNET file IS the foundation model there, so
# we treat it as the "checkpoint" for display purposes.
UNET_NODE_TYPES = ("UNETLoader", "UnetLoaderGGUF", "DiffusersLoader",
                   "CheckpointLoaderNF4", "UNETLoaderNF4")


def init(styles_dir):
    global _STYLES_DIR
    _STYLES_DIR = styles_dir
    os.makedirs(styles_dir, exist_ok=True)


def styles_dir():
    return _STYLES_DIR


def extract_workflow_from_png(path_or_bytes):
    """Read the workflow JSON from a ComfyUI PNG's text metadata. Accepts
    either a filesystem path or raw bytes. Returns parsed dict, or None."""
    try:
        if isinstance(path_or_bytes, (bytes, bytearray)):
            import io
            img = Image.open(io.BytesIO(path_or_bytes))
        else:
            img = Image.open(path_or_bytes)
        try:
            meta = img.info or {}
        finally:
            img.close()
        for key in WORKFLOW_KEYS:
            raw = meta.get(key)
            if not raw:
                continue
            try:
                return json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                continue
    except Exception:
        pass
    return None


def _norm(s):
    """Normalize backslashes to forward slashes (matches our loras DB)."""
    return str(s).replace("\\", "/")


def parse_loras_from_workflow(workflow):
    """Walk workflow.nodes, return [{display_name, strength, enabled}, ...].
    Handles built-in LoraLoader and rgthree Power Lora Loader.
    Respects node-level bypass (mode == 4) and rgthree per-slot `on=false`."""
    if not isinstance(workflow, dict):
        return []
    nodes = workflow.get("nodes") or []
    out = []
    for node in nodes:
        node_active = (node.get("mode", 0) == 0)  # 0=ALWAYS, 2=MUTE, 4=BYPASS
        vals = node.get("widgets_values") or []
        node_type = node.get("type", "")
        is_lora_node = "lora" in node_type.lower()

        # Built-in LoraLoader-style: first widget value is a string ending in
        # .safetensors. Node type must contain "lora" so CheckpointLoaderSimple
        # and other .safetensors-named loaders don't get misread as LoRAs.
        if is_lora_node and vals and isinstance(vals[0], str) and vals[0].lower().endswith(LORA_EXTS):
            strength = vals[1] if len(vals) > 1 and isinstance(vals[1], (int, float)) else 1.0
            out.append({
                "display_name": _norm(vals[0]),
                "strength": float(strength),
                "enabled": node_active,
            })
            continue

        # Multi-LoRA loaders store one dict per LoRA slot inside widgets_values.
        # Key naming AND nesting vary across packs:
        #   rgthree Power Lora Loader: {"lora": "...", "strength": x, "on": bool}
        #     as separate widget values
        #   easy-use / others:         {"name": "...", "strength": x, "active": bool}
        #     as separate widget values
        #   LoraManager (CivitAI Lora Manager): the whole slot array is packed
        #     into ONE widget value as a list of dicts
        # Flatten one level of list-nesting so all three layouts work.
        slots = []
        for v in vals:
            if isinstance(v, dict):
                slots.append(v)
            elif isinstance(v, list):
                slots.extend(item for item in v if isinstance(item, dict))

        for d in slots:
            lora_path = d.get("lora") or d.get("name") or d.get("lora_name")
            if not lora_path or not isinstance(lora_path, str):
                continue
            # Slot enable: rgthree uses `on`, easy-use/LoraManager use `active`.
            # Both default to True; either being explicit False disables the slot.
            slot_on = (d.get("on", True) is not False) and (d.get("active", True) is not False)
            # Strength can come in as float, int, or string ("0.50") depending
            # on the pack — coerce defensively.
            raw_strength = d.get("strength", d.get("strength_model", 1.0))
            try:
                strength = float(raw_strength)
            except (TypeError, ValueError):
                strength = 1.0
            out.append({
                "display_name": _norm(lora_path),
                "strength": strength,
                "enabled": node_active and slot_on,
            })
    return out


def parse_checkpoint_from_workflow(workflow):
    """Find the first checkpoint / UNET loader's filename.

    Three-tier match: integrated checkpoint loaders first (most specific),
    then split-model UNET loaders, then a keyword fallback (any node whose
    type contains 'checkpoint'/'ckpt'/'unet' with a .safetensors widget).
    The fallback catches custom packs we haven't enumerated."""
    if not isinstance(workflow, dict):
        return ""
    nodes = workflow.get("nodes") or []
    for typeset in (CKPT_NODE_TYPES, UNET_NODE_TYPES):
        for node in nodes:
            if node.get("type") in typeset:
                vals = node.get("widgets_values") or []
                if vals and isinstance(vals[0], str) and vals[0].lower().endswith(LORA_EXTS):
                    return _norm(vals[0])
    for node in nodes:
        t = (node.get("type") or "").lower()
        if any(k in t for k in ("checkpoint", "ckpt", "unet")):
            for v in (node.get("widgets_values") or []):
                if isinstance(v, str) and v.lower().endswith(LORA_EXTS):
                    return _norm(v)
    return ""


# Maximum hops to chase a CONDITIONING chain backwards before giving up. Most
# graphs land on the text encoder in 0-2 hops; a few hit a Combine/Concat/
# SetTimestepRange node in between. 4 is a safe upper bound.
_MAX_PROMPT_TRACE_DEPTH = 4


def _is_sampler_node(node_type):
    """KSampler, KSamplerAdvanced, SamplerCustom, easy ksampler, etc. all share
    'sampler' in the name. The few outliers (e.g. SDTurboScheduler) don't have
    CONDITIONING inputs anyway, so this catches what we care about."""
    return "sampler" in (node_type or "").lower()


def _is_text_encoder_node(node_type):
    """CLIPTextEncode and its many variants — CLIPTextEncodeSDXL, smZ_CLIPTextEncode,
    BNK_CLIPTextEncodeAdvanced, CLIPTextEncodeFlux, ImpactWildcardEncode, etc.
    All contain 'cliptextencode' or 'textencode' or 'textprompt' in some form."""
    t = (node_type or "").lower()
    return ("cliptextencode" in t) or ("textencode" in t) or ("textprompt" in t)


def _first_string_widget(node):
    """The text in a CLIPTextEncode-like node is the first non-empty string
    widget value. Some packs put extra widgets (lora syntax flags, encode mode)
    after it; the prompt is always first."""
    for v in (node.get("widgets_values") or []):
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _trace_conditioning_text(link_id, link_src, nodes_by_id, depth=0):
    """Walk the graph backwards from a CONDITIONING link until we reach a text
    encoder. Returns the prompt text, or '' if none found within depth limit."""
    if depth > _MAX_PROMPT_TRACE_DEPTH or link_id is None:
        return ""
    src_id = link_src.get(link_id)
    if src_id is None:
        return ""
    node = nodes_by_id.get(src_id)
    if not node:
        return ""

    if _is_text_encoder_node(node.get("type", "")):
        return _first_string_widget(node)

    # Mid-graph node (ConditioningCombine / ConditioningConcat / ConditioningZeroOut /
    # ConditioningSetTimestepRange / etc.) — recurse through ITS CONDITIONING inputs.
    for inp in (node.get("inputs") or []):
        if (inp.get("type") or "").upper() == "CONDITIONING":
            text = _trace_conditioning_text(
                inp.get("link"), link_src, nodes_by_id, depth + 1
            )
            if text:
                return text
    return ""


def parse_prompts_from_workflow(workflow):
    """Best-effort extraction of (positive, negative) prompts from a workflow.

    Strategy: find KSampler-like nodes (they have `positive` and `negative`
    CONDITIONING inputs by convention), follow each input's link back through
    the graph until we hit a text-encoder node, and pull its first string
    widget. Handles intermediate Combine/Concat/SetRange nodes by recursing.

    Bypassed sampler nodes (mode != 0) are skipped — if every sampler is
    bypassed we still try the last one as a fallback (some users save
    workflows with everything bypassed for reuse).

    Returns ('', '') if nothing matches — failure is silent and harmless."""
    if not isinstance(workflow, dict):
        return ("", "")
    nodes = workflow.get("nodes") or []
    links = workflow.get("links") or []

    nodes_by_id = {n.get("id"): n for n in nodes if n.get("id") is not None}
    # link entry shape: [link_id, src_node, src_slot, dst_node, dst_slot, type]
    link_src = {}
    for link in links:
        if isinstance(link, list) and len(link) >= 2:
            link_src[link[0]] = link[1]

    samplers_active = []
    samplers_any = []
    for node in nodes:
        if _is_sampler_node(node.get("type", "")):
            samplers_any.append(node)
            if node.get("mode", 0) == 0:
                samplers_active.append(node)
    candidates = samplers_active or samplers_any
    if not candidates:
        return ("", "")

    positive = ""
    negative = ""
    for node in candidates:
        for inp in (node.get("inputs") or []):
            iname = (inp.get("name") or "").lower()
            if iname not in ("positive", "negative"):
                continue
            text = _trace_conditioning_text(
                inp.get("link"), link_src, nodes_by_id
            )
            if not text:
                continue
            if iname == "positive" and not positive:
                positive = text
            elif iname == "negative" and not negative:
                negative = text
        if positive and negative:
            break
    return (positive, negative)


def save_image(data_bytes, original_name=None):
    """Write the image to data/styles/<sha>.<ext>. Hash-based naming dedupes
    identical drops. Returns the filename (basename) used."""
    if not _STYLES_DIR:
        raise RuntimeError("styles.init() not called")
    sha = hashlib.sha256(data_bytes).hexdigest()
    ext = os.path.splitext(original_name or "")[1].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".webp"):
        ext = ".png"
    fname = f"{sha}{ext}"
    path = os.path.join(_STYLES_DIR, fname)
    if not os.path.exists(path):
        with open(path, "wb") as f:
            f.write(data_bytes)
    return fname


def get_image_size(path):
    try:
        with Image.open(path) as img:
            return img.size
    except Exception:
        return (0, 0)
