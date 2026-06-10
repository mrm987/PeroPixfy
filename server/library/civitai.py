"""CivitAI lookup by file hash.

Verified against the real collection: ~90% of files match by SHA256, returning
trainedWords, a preview image/video URL, and the model id for a page link.
Misses (video LoRAs, self-trained) simply return None and fall back to
safetensors metadata / manual entry.
"""

import time
import requests

API = "https://civitai.com/api/v1/model-versions/by-hash/"
HEADERS = {"User-Agent": "ComfyUI-Style-Manager"}


TRANSIENT = "TRANSIENT"  # sentinel for "couldn't reach CivitAI right now"


def lookup_by_hash(sha256, timeout=20):
    """Return:
      - parsed info dict on match
      - None for a definitive no-match (404 / malformed body)
      - TRANSIENT for retryable failures (5xx, timeout, network error)

    Caller should treat TRANSIENT as 'try later' and NOT mark the row scanned —
    otherwise a CivitAI outage permanently classifies fresh rows as Unknown.
    """
    for attempt in range(2):
        try:
            r = requests.get(API + sha256, headers=HEADERS, timeout=timeout)
        except requests.RequestException:
            return TRANSIENT
        if r.status_code == 429 and attempt == 0:
            time.sleep(2)
            continue
        if r.status_code == 404:
            return None
        if r.status_code != 200:
            return TRANSIENT
        try:
            return _parse(r.json())
        except ValueError:
            return None
    return TRANSIENT


def lookup_model(model_id):
    """Fetch the model (not version) endpoint to find the newest version.
    Returns: dict {latest_version_id, latest_version_name, latest_published_at}
    on success, None for 404/empty, TRANSIENT on 5xx/timeout/network."""
    if not model_id:
        return None
    url = f"https://civitai.com/api/v1/models/{model_id}"
    for attempt in range(2):
        try:
            r = requests.get(url, headers=HEADERS, timeout=20)
        except requests.RequestException:
            return TRANSIENT
        if r.status_code == 429 and attempt == 0:
            time.sleep(2)
            continue
        if r.status_code == 404:
            return None
        if r.status_code != 200:
            return TRANSIENT
        try:
            data = r.json()
        except ValueError:
            return None
        versions = data.get("modelVersions") or []
        if not versions:
            return None
        latest = versions[0]  # API returns versions in descending date order
        return {
            "latest_version_id": int(latest.get("id") or 0),
            "latest_version_name": latest.get("name") or "",
            "latest_published_at": latest.get("publishedAt") or "",
        }
    return TRANSIENT


def _pick_preview(images):
    """Prefer the first still image; fall back to the first item (may be video)."""
    if not images:
        return "", ""
    for img in images:
        if img.get("type") == "image":
            return img.get("url", ""), "image"
    first = images[0]
    return first.get("url", ""), first.get("type", "image")


def _parse(data):
    model = data.get("model") or {}
    model_id = data.get("modelId")
    version_id = data.get("id")
    # civitai.red mirrors model pages with the full NSFW view (the .com domain
    # restricts NSFW content under its current policy). API stays on .com.
    url = ""
    if model_id:
        url = f"https://civitai.red/models/{model_id}"
        if version_id:
            url += f"?modelVersionId={version_id}"
    thumb_url, thumb_type = _pick_preview(data.get("images"))
    return {
        "name": model.get("name") or data.get("name") or "",
        "trigger_words": ", ".join(data.get("trainedWords") or []),
        "civitai_url": url,
        "thumb_url": thumb_url,
        "thumb_type": thumb_type,
        # CivitAI's coarse family label ("Anima", "Illustrious", "SDXL 1.0"...).
        # Detailed model name (e.g., "anima base v1.0") comes from safetensors
        # `ss_sd_model_name` and is set by indexer.process_one as `base_model`.
        "base_category": data.get("baseModel") or "",
        "nsfw": 1 if (model.get("nsfw") or data.get("nsfwLevel", 0) > 3) else 0,
        "source": "civitai",
    }
