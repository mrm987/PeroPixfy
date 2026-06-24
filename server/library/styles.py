"""Style gallery: save ComfyUI-generated images as reusable workflow snapshots.

ComfyUI embeds the workflow JSON inside PNG `tEXt` chunks under the key
`workflow` (and `prompt`). We pull that JSON out, parse the LoRA/checkpoint
references, store the original image + workflow in our gallery, and let the
user load the workflow back into the canvas later.
"""

import os
import re
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


def is_api_prompt(workflow):
    """ComfyUI(및 PeroPixfy)가 PNG에 임베드하는 'prompt'는 UI 워크플로우(nodes[] 배열)가
    아니라 API 형식 {node_id: {class_type, inputs}} 다. 그 형식인지 판별."""
    if not isinstance(workflow, dict) or "nodes" in workflow:
        return False
    return any(isinstance(v, dict) and "class_type" in v for v in workflow.values())


def parse_api_prompt(workflow):
    """API 프롬프트 형식에서 checkpoint/loras/positive/negative/sampler를 추출한다.
    PeroPixfy 이미지는 UNETLoader + LoraLoaderModelOnly + CLIPTextEncode + (Spectrum)KSampler
    구성이라 UI 형식 파서로는 전부 빈 값이 나온다 — 이 경로가 그걸 메운다.
    반환 형태는 parse_*_from_workflow들과 호환(loras 리스트 / checkpoint 문자열 / (pos,neg) / samp dict)."""
    nodes = {k: v for k, v in workflow.items() if isinstance(v, dict) and "class_type" in v}

    def inp(n):
        return n.get("inputs") or {}

    def _num(x, cast, default):
        try:
            return cast(x)
        except (TypeError, ValueError):
            return default

    # checkpoint: 분리형(UNETLoader.unet_name) 우선, 없으면 통합형(Checkpoint*.ckpt_name)
    checkpoint = ""
    for n in nodes.values():
        if n.get("class_type") in UNET_NODE_TYPES:
            v = inp(n).get("unet_name") or inp(n).get("model_name")
            if isinstance(v, str):
                checkpoint = _norm(v)
                break
    if not checkpoint:
        for n in nodes.values():
            if n.get("class_type") in CKPT_NODE_TYPES:
                v = inp(n).get("ckpt_name")
                if isinstance(v, str):
                    checkpoint = _norm(v)
                    break

    # loras: class_type에 'lora' 포함 + lora_name이 safetensors. (API 그래프엔 bypass된
    # 로라가 아예 없으므로 그래프에 있는 건 전부 enabled.)
    loras = []
    for n in nodes.values():
        if "lora" in (n.get("class_type") or "").lower():
            i = inp(n)
            name = i.get("lora_name")
            if isinstance(name, str) and name.lower().endswith(LORA_EXTS):
                loras.append({
                    "display_name": _norm(name),
                    "strength": _num(i.get("strength_model", i.get("strength", 1.0)), float, 1.0),
                    "enabled": True,
                })

    # sampler + prompts: class_type에 'sampler' 포함 노드의 positive/negative 링크를 따라
    # CLIPTextEncode.text를 읽는다(conditioning 체인을 거슬러 올라감).
    sampler = {"sampler": "", "scheduler": "", "seed": 0, "steps": 0, "cfg": 0.0}
    positive = negative = ""
    samp = next((n for n in nodes.values() if "sampler" in (n.get("class_type") or "").lower()), None)
    if samp:
        i = inp(samp)
        sampler = {
            "sampler": i.get("sampler_name") or "",
            "scheduler": i.get("scheduler") or "",
            "seed": _num(i.get("seed", i.get("noise_seed", 0)), int, 0),
            "steps": _num(i.get("steps", 0), int, 0),
            "cfg": _num(i.get("cfg", 0), float, 0.0),
        }

        def text_of(ref):
            seen = set()
            stack = [ref[0]] if isinstance(ref, list) and ref else []
            while stack:
                nid = str(stack.pop())
                if nid in seen:
                    continue
                seen.add(nid)
                node = nodes.get(nid)
                if not node:
                    continue
                ni = inp(node)
                if isinstance(ni.get("text"), str):
                    return ni["text"]
                for v in ni.values():        # text가 링크면 입력을 거슬러 올라간다
                    if isinstance(v, list) and v:
                        stack.append(v[0])
            return ""

        positive = text_of(i.get("positive"))
        negative = text_of(i.get("negative"))

    return {"checkpoint": checkpoint, "loras": loras,
            "positive": positive, "negative": negative, "sampler": sampler}


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

        # 슬롯-dict 분기는 LoRA 노드에만 적용한다. 다른 노드(예: rgthree Image Comparer)도
        # widgets_values에 {"name": "A"/"B", ...} 같은 dict를 담는데, 아래의 name 폴백이
        # 이를 로라로 오인하기 때문이다. 실제 멀티-로라 로더는 모두 타입에 'lora'를 포함한다.
        if not is_lora_node:
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
    """실제 생성에 쓰인 베이스 모델 파일명을 찾는다.

    1순위: 활성 샘플러의 MODEL 입력을 역추적해 베이스 로더를 찾는다(가장 정확). 워크플로우에
    SAM/세그멘테이션·디테일러용 보조 CheckpointLoader가 따로 있어도, 샘플러로 실제 들어가는
    모델만 고른다. 추적 실패 시에만 타입 기반 탐색(통합 체크포인트 → UNET → 키워드)으로 폴백한다."""
    if not isinstance(workflow, dict):
        return ""
    traced = _trace_checkpoint(workflow)
    if traced:
        return traced
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
# SetTimestepRange node, and Set/Get 가상 노드는 매 라우팅마다 한 홉을 더 쓴다.
# civitai 워크플로우는 Set/Get + concat을 많이 써서 여유를 둔다.
_MAX_PROMPT_TRACE_DEPTH = 16


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


_TEXT_INPUT_NAMES = (
    "text", "text_g", "text_l", "string", "prompt", "positive", "negative",
    "wildcard_text", "populated_text", "text_positive", "text_negative",
)
_CONTEXT_BASE_NAMES = ("base_ctx", "ctx", "context", "base_context")


def _is_get_node(node_type):
    return "getnode" in (node_type or "").lower()


def _is_set_node(node_type):
    return "setnode" in (node_type or "").lower()


def _is_context_node(node_type):
    # rgthree Context / Context Big / Context Switch 등 — positive/negative를 비롯한
    # 여러 값을 하나의 CONTEXT로 묶어 라우팅한다 (civitai 워크플로우에 매우 흔함).
    return "context" in (node_type or "").lower()


def _node_key(node):
    """Set/Get 가상 노드의 변수명 (보통 widgets_values의 첫 문자열)."""
    for v in (node.get("widgets_values") or []):
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _is_showtext_node(node_type):
    """ShowText|pysssss / easy showAnything / Display Any 등 — 실행 시 입력으로
    들어온 '해석된' 텍스트를 위젯에 캡처해 화면에 표시하는 노드들."""
    t = (node_type or "").lower().replace(" ", "").replace("|", "")
    return ("showtext" in t) or ("showany" in t) or ("displaytext" in t) \
        or ("displayany" in t) or ("previewtext" in t)


def _showtext_value(node):
    """ShowText류가 실행 시점에 표시한 '해석된' 텍스트. widgets_values 안에서
    가장 긴 문자열을 취한다 (구조가 [["text"]]처럼 중첩될 수 있음)."""
    best = ""
    stack = [node.get("widgets_values")]
    while stack:
        v = stack.pop()
        if isinstance(v, str):
            s = v.strip()
            if len(s) > len(best):
                best = s
        elif isinstance(v, list):
            stack.extend(v)
    return best


def _showtext_input_link(node):
    """ShowText류의 입력 링크 (text/anything/* 어느 이름이든)."""
    link = _input_link_by_name(node, ("text", "anything", "string", "text_input", "value"))
    if link is not None:
        return link
    links = _string_inputs(node)
    return links[0] if links else None


def _resolve_getset_source(link, link_src, link_slot, nodes_by_id, set_by_key):
    """링크의 소스를 Get→Set 가상 노드 체인을 통과해 실제 '생산 노드'(src_id, slot)로
    해석한다. ShowText가 Get을 통해 값을 받는 경우, 인코더가 같은 Set/소스를 거쳐
    도달하는 실제 노드와 키를 맞추기 위해 쓴다."""
    seen = set()
    for _ in range(8):
        sid = link_src.get(link)
        slot = link_slot.get(link, 0)
        node = nodes_by_id.get(sid)
        if not node or sid in seen:
            return (sid, slot)
        seen.add(sid)
        if _is_get_node(node.get("type", "")):
            setn = set_by_key.get(_node_key(node))
            nxt = _cond_input_link(setn) if setn else None
            if nxt is None:
                return (sid, slot)
            link = nxt
            continue
        return (sid, slot)
    return (link_src.get(link), link_slot.get(link, 0))


def _consumes_clip(node):
    """CLIP 입력을 받는 노드 = (이름이 무엇이든) 텍스트 인코더로 간주."""
    return any((inp.get("type") or "").upper() == "CLIP"
               for inp in (node.get("inputs") or []))


def _cond_input_link(node):
    """노드의 CONDITIONING 입력 링크 (없으면 첫 입력 = SetNode의 값 입력)."""
    if not node:
        return None
    for inp in (node.get("inputs") or []):
        if (inp.get("type") or "").upper() == "CONDITIONING":
            return inp.get("link")
    inps = node.get("inputs") or []
    return inps[0].get("link") if inps else None


def _output_name(node, slot):
    outs = node.get("outputs") or []
    if isinstance(slot, int) and 0 <= slot < len(outs):
        o = outs[slot] or {}
        return o.get("name") or o.get("label") or ""
    return ""


def _input_link_by_name(node, names):
    for inp in (node.get("inputs") or []):
        if (inp.get("name") or "").lower() in names:
            return inp.get("link")
    return None


_MODEL_EXTS = (".safetensors", ".ckpt", ".gguf", ".sft", ".pt")


def _input_link_by_type(node, typ):
    for inp in (node.get("inputs") or []):
        if (inp.get("type") or "").upper() == typ and inp.get("link") is not None:
            return inp.get("link")
    return None


def _model_file_widget(node):
    for v in (node.get("widgets_values") or []):
        if isinstance(v, str) and v.lower().endswith(_MODEL_EXTS):
            return _norm(v)
    return ""


def _follow_model_link(g, link, depth=0):
    """MODEL 링크를 역추적해 실제 '베이스 모델 로더'의 파일명을 찾는다. Set/Get 가상
    노드, rgthree Context, 그리고 LoRA·패치 노드(ModelSampling/ModelPatch 등)는
    통과한다 — LoRA/패치는 베이스가 아니라 MODEL을 변형만 하므로 그 위로 더 올라간다."""
    seen = set()
    for _ in range(64):
        node, _slot = _src(g, link)
        if not node:
            return ""
        nid = node.get("id")
        if nid in seen:
            return ""
        seen.add(nid)
        t = node.get("type", "")
        if _is_get_node(t):  # Get → 같은 key의 Set로 점프
            setn = g["sets"].get(_node_key(node))
            if not setn:
                return ""
            link = _input_link_by_type(setn, "MODEL")
            if link is None:
                inps = setn.get("inputs") or []
                link = inps[0].get("link") if inps else None
            continue
        if _is_context_node(t):  # rgthree Context — model 필드(없으면 base_ctx)
            link = _input_link_by_name(node, ("model",)) or _input_link_by_name(node, _CONTEXT_BASE_NAMES)
            continue
        mf = _model_file_widget(node)
        # 파일 위젯이 있고 LoRA 노드가 아니면 베이스 로더로 본다. LoRA/패치 노드는
        # 베이스가 아니므로 MODEL 입력으로 계속 거슬러 올라간다.
        if mf and "lora" not in t.lower():
            return mf
        link = _input_link_by_type(node, "MODEL")
        if link is None:
            return ""
    return ""


def _trace_checkpoint(workflow):
    """활성 샘플러의 MODEL 입력을 역추적해 실제 베이스 모델 파일명을 반환 (실패 시 '')."""
    nodes = workflow.get("nodes") or []
    nodes_by_id = {n.get("id"): n for n in nodes if n.get("id") is not None}
    link_src, link_slot = {}, {}
    for link in (workflow.get("links") or []):
        if isinstance(link, list) and len(link) >= 2:
            link_src[link[0]] = link[1]
            link_slot[link[0]] = link[2] if len(link) >= 3 else 0
    set_by_key = {}
    for node in nodes:
        if _is_set_node(node.get("type", "")):
            key = _node_key(node)
            if key and key not in set_by_key:
                set_by_key[key] = node
    g = {"src": link_src, "slot": link_slot, "nodes": nodes_by_id, "sets": set_by_key}
    active = [n for n in nodes if _is_sampler_node(n.get("type", "")) and n.get("mode", 0) == 0]
    for s in (active or [n for n in nodes if _is_sampler_node(n.get("type", ""))]):
        link = _input_link_by_name(s, ("model",))
        if link is None:
            continue
        found = _follow_model_link(g, link)
        if found:
            return found
    return ""


# 추적 함수들은 그래프 컨텍스트 g = {src, slot, nodes, sets} 를 공유한다.
#   src:  link_id -> 소스 노드 id
#   slot: link_id -> 소스 출력 슬롯 인덱스 (Context 출력 이름 판별용)
#   nodes: node_id -> 노드
#   sets:  Set/Get key -> SetNode
def _src(g, link_id):
    if link_id is None:
        return (None, None)
    nid = g["src"].get(link_id)
    if nid is None:
        return (None, None)
    return (g["nodes"].get(nid), g["slot"].get(link_id, 0))


def _longest_widget(node):
    """노드 위젯 중 가장 긴 문자열(=내용일 확률이 높음). 구분자(',')·토글('True')
    같은 짧은 값에 속지 않도록."""
    best = ""
    for v in (node.get("widgets_values") or []):
        if isinstance(v, str) and len(v.strip()) > len(best):
            best = v.strip()
    return best


def _maybe_json_prompt(s):
    """위젯 값이 JSON이면(예: DanbooruGallery의 selections) 그 안의 prompt/text류
    필드만 뽑아낸다. JSON이 아니면 원문 그대로."""
    st = s.strip()
    if not (st.startswith("{") or st.startswith("[")):
        return s
    try:
        data = json.loads(st)
    except Exception:
        return s
    found = []

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if isinstance(v, str) and k.lower() in ("prompt", "text", "positive", "tags"):
                    if v.strip():
                        found.append(v.strip())
                else:
                    walk(v)
        elif isinstance(o, list):
            for it in o:
                walk(it)

    walk(data)
    return ", ".join(found) if found else s


def _string_inputs(node):
    out = []
    for inp in (node.get("inputs") or []):
        if inp.get("link") is None:
            continue
        iname = (inp.get("name") or "").lower()
        itype = (inp.get("type") or "").upper()
        # STRING/텍스트류 + *(any) 라우터(ifElse/switch/reroute) 입력까지 따라간다.
        if itype in ("STRING", "*") or iname in _TEXT_INPUT_NAMES:
            out.append(inp.get("link"))
    return out


def _resolve_string(g, link_id, depth=0):
    """STRING 링크를 거슬러 실제 문자열을 조립한다.
    - GetNode → 같은 key의 SetNode 값 입력으로 점프.
    - '내용 위젯'(>8자)이 있으면 그게 이 노드의 값 (PrimitiveString의 프롬프트,
      TriggerWord Toggle의 토글된 출력 등). 짧은 위젯(구분자/토글)엔 속지 않음.
    - 그게 없고 STRING 입력 링크들이 있으면(Concatenate류) 각각 풀어 join."""
    if depth > _MAX_PROMPT_TRACE_DEPTH:
        return ""
    src, _slot = _src(g, link_id)
    if not src:
        return ""
    # 이 출력 와이어를 ShowText류가 캡처해 뒀다면, 그게 실행 시점의 '해석된'
    # 최종 텍스트다 (템플릿 {user_prompt} 치환·와일드카드 등 이미 반영됨). 위젯의
    # stale 템플릿보다 이걸 우선한다.
    cap = g.get("showtext", {}).get((src.get("id"), _slot))
    if cap:
        return cap
    if _is_get_node(src.get("type", "")):
        setn = g["sets"].get(_node_key(src))
        inps = setn.get("inputs") if setn else None
        return _resolve_string(g, inps[0].get("link"), depth + 1) if inps else ""
    widget = _longest_widget(src)
    if len(widget) > 8:  # 변환 결과/리프 텍스트가 위젯에 들어 있음
        return _maybe_json_prompt(widget)
    parts = []
    for lk in _string_inputs(src):
        t = _resolve_string(g, lk, depth + 1)
        if t and t not in parts:  # 중복 제거 (ifElse 양 분기가 같은 소스일 때 등)
            parts.append(t)
    if parts:
        sep = widget if 0 < len(widget) <= 4 else ", "  # 짧은 위젯은 구분자로 사용
        return sep.join(parts)
    return widget


def _encoder_text(g, node, depth):
    """인코더의 프롬프트. text 입력이 링크로 연결돼 있으면 그게 실제 프롬프트이며
    위젯 값은 stale 기본값(예: 모델 데모 프롬프트)일 수 있으므로 링크를 우선한다."""
    if depth <= _MAX_PROMPT_TRACE_DEPTH:
        for lk in _string_inputs(node):
            text = _resolve_string(g, lk, depth + 1)
            if text:
                return text
    return _first_string_widget(node)


def _trace_context_field(g, node, field, depth):
    """rgthree Context 노드에서 'positive'/'negative' 필드를 거슬러 추적한다.
    해당 이름 입력이 연결돼 있으면 그 conditioning을 따라가고, 없으면 base_ctx
    (상위 Context)로 한 단계 올라가 같은 필드를 다시 찾는다."""
    if depth > _MAX_PROMPT_TRACE_DEPTH or not node:
        return ""
    link = _input_link_by_name(node, (field,))
    if link is not None:
        return _trace_conditioning_text(g, link, depth + 1)
    base = _input_link_by_name(node, _CONTEXT_BASE_NAMES)
    if base is not None:
        up, _slot = _src(g, base)
        # base_ctx가 Set/Get 가상 노드면 같은 key의 SetNode로 점프해 실제 상위
        # Context를 찾는다 (체인 가능). civitai 워크플로우가 Context를 Get/Set으로
        # 멀리 떨어뜨려 두는 경우가 많다.
        guard = 0
        while up and _is_get_node(up.get("type", "")) and guard < _MAX_PROMPT_TRACE_DEPTH:
            setn = g["sets"].get(_node_key(up))
            up, _slot = _src(g, _cond_input_link(setn)) if setn else (None, None)
            guard += 1
        if up and _is_context_node(up.get("type", "")):
            return _trace_context_field(g, up, field, depth + 1)
    return ""


def _trace_conditioning_text(g, link_id, depth=0):
    """CONDITIONING 링크를 거슬러 올라가 텍스트 인코더의 프롬프트를 찾는다.

    Set/Get 가상 노드(이름 key 연결), rgthree Context(여러 값 묶음 라우팅),
    CLIP을 소비하는 커스텀 인코더, 텍스트가 별도 노드 링크로 오는 경우까지
    best-effort로 추적한다 — civitai의 커스텀 노드 워크플로우 대응."""
    if depth > _MAX_PROMPT_TRACE_DEPTH:
        return ""
    node, slot = _src(g, link_id)
    if not node:
        return ""
    node_type = node.get("type", "")

    if _is_get_node(node_type):  # Set/Get 가상 노드 점프
        setn = g["sets"].get(_node_key(node))
        return _trace_conditioning_text(g, _cond_input_link(setn), depth + 1) if setn else ""

    if _is_context_node(node_type):  # rgthree Context — 출력 슬롯 이름으로 필드 판별
        oname = _output_name(node, slot).lower()
        field = "negative" if "neg" in oname else "positive"
        return _trace_context_field(g, node, field, depth + 1)

    if _is_text_encoder_node(node_type) or _consumes_clip(node):
        text = _encoder_text(g, node, depth)
        if text:
            return text

    # 중간 CONDITIONING 노드 (Combine/Concat/ZeroOut/SetTimestepRange 등) — 재귀.
    for inp in (node.get("inputs") or []):
        if (inp.get("type") or "").upper() == "CONDITIONING":
            text = _trace_conditioning_text(g, inp.get("link"), depth + 1)
            if text:
                return text
    return ""


# {user_prompt} 같은 미치환 템플릿 자리표시자 (정상 추적이 런타임 조립을 못 풀고
# 템플릿 원문을 돌려준 신호). 단순 강조용 {}와 구분하기 위해 {식별자} 형태만 본다.
_PLACEHOLDER_RE = re.compile(r"\{[a-zA-Z_]\w*\}")
_NEG_MARKERS = (
    "worst quality", "low quality", "lowres", "bad anatomy", "bad hands",
    "jpeg artifacts", "watermark", "signature", "score_1", "score_2", "score_3",
    "blurry", "artist name", "username", "missing fingers", "extra digits",
    "cropped", "deformed", "mutated", "bad proportions",
)


def _looks_unresolved(text):
    """비어 있거나 미치환 템플릿 자리표시자를 포함하면 정적 추적이 실패한 것."""
    return (not text) or bool(_PLACEHOLDER_RE.search(text))


def _neg_marker_count(text):
    tl = text.lower()
    return sum(1 for m in _NEG_MARKERS if m in tl)


def _harvest_showtext_prompts(nodes):
    """런타임에 조립/치환된 프롬프트를 ShowText류 노드의 캡처값에서 best-effort로
    복원한다 — 정적 추적이 실패하거나 미치환 템플릿을 돌려줄 때만 쓰는 폴백.
    활성(mode 0)·비어있지 않음·lora 문자열 아님 인 캡처 중에서, 네거티브 마커가
    2개 이상이면 네거티브 후보, 나머지는 포지티브 후보로 보고 각 그룹에서 가장 긴
    것을 고른다 (전체 조립본이 부분 태그본보다 길다)."""
    pos_cands, neg_cands = [], []
    for n in nodes:
        if not _is_showtext_node(n.get("type", "")) or n.get("mode", 0) != 0:
            continue
        t = _showtext_value(n)
        if not t or t.lstrip().startswith("<lora:"):
            continue
        (neg_cands if _neg_marker_count(t) >= 2 else pos_cands).append(t)
    pos = max(pos_cands, key=len) if pos_cands else ""
    neg = max(neg_cands, key=len) if neg_cands else ""
    return (pos, neg)


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
    link_slot = {}
    for link in links:
        if isinstance(link, list) and len(link) >= 2:
            link_src[link[0]] = link[1]
            link_slot[link[0]] = link[2] if len(link) >= 3 else 0
    # Set/Get 가상 노드: 변수명(key) → SetNode. GetNode가 같은 key로 값을 받아온다.
    set_by_key = {}
    for node in nodes:
        if _is_set_node(node.get("type", "")):
            key = _node_key(node)
            if key and key not in set_by_key:
                set_by_key[key] = node
    # ShowText류가 캡처한 (소스노드, 슬롯) → 해석된 텍스트. 런타임에 조립/치환된
    # 최종 프롬프트를 정적으로 복원하기 위한 핵심 (civitai의 템플릿·와일드카드 대응).
    showtext = {}
    for node in nodes:
        if not _is_showtext_node(node.get("type", "")):
            continue
        txt = _showtext_value(node)
        if not txt:
            continue
        lk = _showtext_input_link(node)
        if lk is None:
            continue
        # 직접 와이어 + Get→Set 통과 후의 실제 소스, 둘 다 키로 등록한다. 인코더가
        # Get/Set을 거쳐 같은 생산 노드(예: Merge/Concatenate 출력)에 도달할 때 매칭되도록.
        keys = {
            (link_src.get(lk), link_slot.get(lk)),
            _resolve_getset_source(lk, link_src, link_slot, nodes_by_id, set_by_key),
        }
        for key in keys:
            if key[0] is not None:
                showtext.setdefault(key, txt)
    g = {"src": link_src, "slot": link_slot, "nodes": nodes_by_id,
         "sets": set_by_key, "showtext": showtext}

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
            text = _trace_conditioning_text(g, inp.get("link"))
            if not text:
                continue
            if iname == "positive" and not positive:
                positive = text
            elif iname == "negative" and not negative:
                negative = text
        if positive and negative:
            break
    # 폴백: 추적이 실패(빈 값)했거나 미치환 템플릿({user_prompt} 등)을 돌려줬으면,
    # ShowText류가 캡처해 둔 런타임 결과에서 복원한다.
    if _looks_unresolved(positive) or _looks_unresolved(negative):
        hp, hn = _harvest_showtext_prompts(nodes)
        if _looks_unresolved(positive) and hp:
            positive = hp
        if _looks_unresolved(negative) and hn:
            negative = hn
    return (positive, negative)


_SAMPLER_NAMES = {
    "euler", "euler_cfg_pp", "euler_ancestral", "euler_ancestral_cfg_pp", "heun",
    "heunpp2", "dpm_2", "dpm_2_ancestral", "lms", "dpm_fast", "dpm_adaptive",
    "dpmpp_2s_ancestral", "dpmpp_sde", "dpmpp_sde_gpu", "dpmpp_2m", "dpmpp_2m_alt",
    "dpmpp_2m_cfg_pp", "dpmpp_2m_sde", "dpmpp_2m_sde_gpu", "dpmpp_3m_sde",
    "dpmpp_3m_sde_gpu", "ddpm", "lcm", "ipndm", "ipndm_v", "deis", "res_multistep",
    "res_multistep_cfg_pp", "gradient_estimation", "gradient_estimation_cfg_pp",
    "er_sde", "er_sde_cns", "seeds_2", "seeds_3", "sa_solver", "sa_solver_pece",
    "ddim", "uni_pc", "uni_pc_bh2", "lcm_custom_noise",
}
_SCHEDULER_NAMES = {
    "normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform",
    "beta", "linear_quadratic", "kl_optimal", "ays", "ays+", "ays_30", "ays_30+",
    "gits", "beta_1_1",
}


def _to_num(v):
    try:
        f = float(v)
        return int(f) if f == int(f) else f
    except (TypeError, ValueError):
        return None


def parse_sampler_from_workflow(workflow):
    """Best-effort: 활성 sampler 노드의 위젯에서 sampler/scheduler/seed/steps/cfg를
    뽑는다. 알려진 sampler_name 값을 앵커로, 그 직전 숫자들에서 cfg·steps·seed를
    읽는다 (KSampler/KSamplerAdvanced 및 다수 커스텀 샘플러의 위젯 순서를 커버).
    찾지 못한 값은 기본값(0/'')으로 남긴다 — 실패는 무해."""
    out = {"sampler": "", "scheduler": "", "seed": 0, "steps": 0, "cfg": 0}
    if not isinstance(workflow, dict):
        return out
    nodes = workflow.get("nodes") or []
    cand = [n for n in nodes if _is_sampler_node(n.get("type", ""))]
    cand = [n for n in cand if n.get("mode", 0) == 0] or cand
    for node in cand:
        wv = node.get("widgets_values")
        if not isinstance(wv, list):
            continue
        si = next((i for i, v in enumerate(wv)
                   if isinstance(v, str) and v.lower() in _SAMPLER_NAMES), None)
        if si is None:
            continue
        out["sampler"] = wv[si]
        if (si + 1 < len(wv) and isinstance(wv[si + 1], str)
                and wv[si + 1].lower() in _SCHEDULER_NAMES):
            out["scheduler"] = wv[si + 1]
        nums = [(i, _to_num(wv[i])) for i in range(si)]
        nums = [(i, n) for i, n in nums if n is not None]
        if nums:
            out["cfg"] = nums[-1][1]  # sampler 직전 숫자 = cfg
            ints_before = [(i, n) for i, n in nums[:-1] if isinstance(n, int)]
            if ints_before:
                out["steps"] = ints_before[-1][1]
            if len(ints_before) >= 2:
                out["seed"] = ints_before[-2][1]
        if out["sampler"]:
            break
    return out


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
