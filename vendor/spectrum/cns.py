"""CNS — Colored Noise Sampling, shipped as an ``er_sde_cns`` sampler entry.

Training-free SDE plug-in (Davidson, Issachar, Benaim — arXiv 2605.30332,
Algorithm 1). Replaces the **white** noise that the ER-SDE solver injects each
step with **frequency-colored**, RMS-normalized noise that dumps the fixed
stochastic-energy budget into the radial frequency bands the network has *not
yet resolved* at that step (per a precomputed completion matrix γ(f, t)). It is
a zero-sum reallocation of a fixed variance budget — not a global noise
scale-up — so RMS renormalization (paper §A) is load-bearing.

CNS lives at the sampler's per-step noise-injection seam, which no model patch
can reach (the injected noise is drawn *inside* the sampler, downstream of every
``model_options`` hook — same reason SPD owns its loop, see ``spd.py``). So we
ship it as a custom ER-SDE sample function and register it under the name
``er_sde_cns`` in ComfyUI's global sampler dropdown: pick it in the
``sampler_name`` field of any KSampler and the per-step noise is recolored, full
strength, with the shipped Anima γ matrix.

The recolorer (``CNSRecolorer``) and ``radial_bins`` are vendored verbatim from
``anima_lora/library/inference/corrections/cns.py``; ``sample_er_sde_cns`` is a
copy of ``comfy.k_diffusion.sampling.sample_er_sde`` with the single
noise-injection line routed through the recolorer (``float(sigmas[i])`` σ, to
match the CLI's ``ERSDESampler._sample_noise`` bit-for-bit). With CNS disabled
the math is identical to stock ``er_sde``.

Notes:
  * **Anima-calibrated.** The shipped γ is measured on Anima's spectral-bias
    staircase at cfg=4. On a non-Anima model it is mis-calibrated (still
    variance-conserving, so degraded-not-broken), but the global dropdown entry
    gives no per-model signal — intended for Anima workflows.
  * **er_sde only.** This is the stochastic ER-SDE solver; there is no ODE/euler
    surface for colored noise (white draw → no-op). Composes with the Spectrum
    model wrapper and the DCW / SMC-CFG / mod-guidance model patches (different
    seams), exactly as the CLI stacks ``--cns`` with ``SPECTRUM=1`` / ``MOD=1``.
"""

from __future__ import annotations

import logging
import os
import threading
import time
import urllib.request
from pathlib import Path
from typing import Optional

import numpy as np
import torch

import folder_paths

logger = logging.getLogger(__name__)

# Shipped completion-matrix artifact. Tiny (~6KB); auto-downloaded on first use
# into models/anima_cns/ (same convention as the DCW calibrator). Bump the tag +
# this URL together when γ is recalibrated.
DEFAULT_GAMMA_FILENAME = "cns_gamma.npz"
DEFAULT_GAMMA_URL = (
    "https://github.com/sorryhyun/ComfyUI-Spectrum-KSampler/releases/download/"
    "0530/cns_gamma.npz"
)
DEFAULT_GAMMA_SUBDIR = "anima_cns"

CNS_SAMPLER_NAME = "er_sde_cns"

_DOWNLOAD_LOCK = threading.Lock()


# ---------------------------------------------------------------------------
# Auto-download (mirrors dcw_calibrator.get_default_calibrator_path)
# ---------------------------------------------------------------------------


def get_default_gamma_path() -> str:
    """Return the local path to the shipped γ matrix, downloading it if missing."""
    target_dir = os.path.join(folder_paths.models_dir, DEFAULT_GAMMA_SUBDIR)
    target_path = os.path.join(target_dir, DEFAULT_GAMMA_FILENAME)
    if os.path.exists(target_path) and os.path.getsize(target_path) > 0:
        return target_path

    with _DOWNLOAD_LOCK:
        if os.path.exists(target_path) and os.path.getsize(target_path) > 0:
            return target_path
        try:
            os.makedirs(target_dir, exist_ok=True)
        except OSError as e:
            raise RuntimeError(
                f"CNS: cannot create directory {target_dir} ({e}). "
                f"If ComfyUI is installed under Program Files, move it or run as admin. "
                f"Otherwise download manually from {DEFAULT_GAMMA_URL} and place it at {target_path}."
            ) from e
        tmp_path = target_path + ".download"
        logger.info(f"CNS: downloading default γ matrix from {DEFAULT_GAMMA_URL}")
        try:
            req = urllib.request.Request(
                DEFAULT_GAMMA_URL,
                headers={"User-Agent": "comfyui-spectrum/cns"},
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                total = int(resp.headers.get("Content-Length") or 0)
                downloaded = 0
                with open(tmp_path, "wb") as fh:
                    while True:
                        chunk = resp.read(128 * 1024)
                        if not chunk:
                            break
                        fh.write(chunk)
                        downloaded += len(chunk)
                if total and downloaded != total:
                    raise RuntimeError(
                        f"truncated download: got {downloaded} of {total} bytes"
                    )
        except Exception as e:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
            raise RuntimeError(
                f"CNS: failed to download γ matrix from {DEFAULT_GAMMA_URL} ({e}). "
                f"If this is a corporate network or TLS-intercepting proxy, try `pip install -U certifi`. "
                f"Otherwise download manually and place the file at {target_path}."
            ) from e
        last_err: Optional[Exception] = None
        for attempt in range(5):
            try:
                os.replace(tmp_path, target_path)
                last_err = None
                break
            except PermissionError as e:
                last_err = e
                time.sleep(0.2 * (attempt + 1))
        if last_err is not None:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
            raise RuntimeError(
                f"CNS: γ matrix downloaded but could not rename into place ({last_err}). "
                f"This is usually Windows antivirus holding the file open. "
                f"Try adding {target_dir} to your AV exclusions, or download manually from "
                f"{DEFAULT_GAMMA_URL} and place it at {target_path}."
            ) from last_err
        logger.info(f"CNS: saved γ matrix to {target_path}")
        return target_path


# ---------------------------------------------------------------------------
# Recolorer — vendored verbatim from
# anima_lora/library/inference/corrections/cns.py
# ---------------------------------------------------------------------------


def radial_bins(h: int, w: int, n_bins: int) -> tuple[np.ndarray, np.ndarray]:
    """Radial-frequency bin index per FFT cell + bin centers in [0, 1].

    The normalization (r / r.max()) makes the bin *centers* independent of
    (h, w), so a γ matrix calibrated at one aspect's grid maps cleanly onto
    another shape's radial map by bin index.
    """
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    r = np.sqrt(fy**2 + fx**2)
    r = r / r.max()
    edges = np.linspace(0.0, 1.0 + 1e-9, n_bins + 1)
    idx = np.clip(np.digitize(r, edges) - 1, 0, n_bins - 1)
    centers = 0.5 * (edges[:-1] + edges[1:])
    return idx, centers


class CNSRecolorer:
    """Recolors per-step SDE white noise from a precomputed γ(f, t) matrix.

    On first use the recolorer locks onto the calibrated aspect closest in
    aspect-ratio to the inference latent shape, then for each step
    σ-interpolates γ and applies::

        scale(f)  = sqrt(1 - γ(f, σ))          # Eq. 11 numerator
        W         = fft2(white) * scale[bin(f)]
        w_c       = ifft2(W).real
        w_c      /= std(w_c)                    # RMS-normalize → conserve variance

    ``strength`` ∈ [0, 1] blends white↔recolored (then renormalizes) as a safety
    knob; 1.0 is full CNS, 0.0 is a pass-through (== white noise).
    """

    def __init__(
        self,
        gamma: np.ndarray,          # (A, T, F)
        aspects: np.ndarray,        # (A, 2) pixel (H, W)
        sigmas: np.ndarray,         # (T+1,) calibration σ schedule
        strength: float = 1.0,
    ) -> None:
        if gamma.ndim != 3:
            raise ValueError(f"CNS gamma must be (A, T, F); got shape {gamma.shape}")
        self.gamma_all = np.asarray(gamma, dtype=np.float64)
        self.aspects = np.asarray(aspects, dtype=np.float64).reshape(-1, 2)
        self.F = self.gamma_all.shape[-1]
        self.strength = float(strength)

        sig_mid = np.asarray(sigmas, dtype=np.float64)[:-1]
        self._order = np.argsort(sig_mid)
        self._sig_asc = sig_mid[self._order]

        self._bin_cache: dict[tuple[int, int], torch.Tensor] = {}
        self._sel_gamma: Optional[np.ndarray] = None  # (T, F) ascending-σ, chosen aspect
        self._sel_idx: Optional[int] = None

    @classmethod
    def from_path(cls, path: str, strength: float = 1.0) -> "CNSRecolorer":
        """Load from an npz path, or the literal ``"auto"`` (shipped default)."""
        resolved = get_default_gamma_path() if path == "auto" else path
        if not Path(resolved).exists():
            raise FileNotFoundError(
                f"CNS calibration not found: {resolved}. Use 'auto' for the shipped "
                f"matrix or pass a valid cns_gamma.npz path."
            )
        d = np.load(resolved)
        return cls(d["gamma"], d["aspects"], d["sigmas"], strength=strength)

    def _select_aspect(self, h_lat: int, w_lat: int) -> None:
        """Lock onto the calibrated aspect closest in AR to this latent shape."""
        ar = w_lat / max(h_lat, 1)
        cal_ar = self.aspects[:, 1] / np.maximum(self.aspects[:, 0], 1.0)
        self._sel_idx = int(np.argmin(np.abs(cal_ar - ar)))
        self._sel_gamma = self.gamma_all[self._sel_idx][self._order]  # (T, F)

    def _gamma_row(self, sigma_s: float) -> np.ndarray:
        """γ(f) at this σ for the selected aspect, via per-bin interpolation."""
        g = self._sel_gamma
        return np.array(
            [np.interp(sigma_s, self._sig_asc, g[:, f]) for f in range(self.F)],
            dtype=np.float64,
        )

    def _bin_map(self, h: int, w: int, device: torch.device) -> torch.Tensor:
        key = (h, w)
        cached = self._bin_cache.get(key)
        if cached is None:
            idx, _ = radial_bins(h, w, self.F)
            cached = torch.from_numpy(idx).to(device=device, dtype=torch.long)
            self._bin_cache[key] = cached
        return cached

    def recolor(self, white: torch.Tensor, sigma_s: float) -> torch.Tensor:
        """Return frequency-recolored noise of the same shape/dtype as ``white``.

        ``white`` is ``(B, C, 1, H, W)`` (Anima's fake-5D latent) or ``(B, C, H,
        W)`` — FFT runs over the trailing two dims either way; RMS renorm is
        per-(leading-dims) over the spatial plane so each channel keeps unit
        variance, exactly like the white noise it replaces.
        """
        if self.strength <= 0.0:
            return white
        h, w = white.shape[-2], white.shape[-1]
        if self._sel_gamma is None:
            self._select_aspect(h, w)

        scale_vec = np.sqrt(np.clip(1.0 - self._gamma_row(float(sigma_s)), 0.0, 1.0))
        bin_idx = self._bin_map(h, w, white.device)
        scale = torch.from_numpy(scale_vec).to(device=white.device, dtype=torch.float32)
        scale_map = scale[bin_idx]  # (H, W)

        wf = torch.fft.fft2(white.float(), dim=(-2, -1)) * scale_map
        wc = torch.fft.ifft2(wf, dim=(-2, -1)).real

        wc = wc / wc.std(dim=(-2, -1), keepdim=True).clamp_min(1e-6)
        if self.strength < 1.0:
            wc = (1.0 - self.strength) * white.float() + self.strength * wc
            wc = wc / wc.std(dim=(-2, -1), keepdim=True).clamp_min(1e-6)
        return wc.to(white.dtype)


# ---------------------------------------------------------------------------
# Lazy γ singleton — load the npz once, build a fresh recolorer per sample
# (so a per-sample aspect change can't get pinned by a stale aspect lock).
# ---------------------------------------------------------------------------

_GAMMA_ARRAYS: Optional[dict] = None
_GAMMA_LOCK = threading.Lock()


def _load_gamma_arrays() -> dict:
    global _GAMMA_ARRAYS
    if _GAMMA_ARRAYS is None:
        with _GAMMA_LOCK:
            if _GAMMA_ARRAYS is None:
                path = get_default_gamma_path()
                d = np.load(path)
                _GAMMA_ARRAYS = {k: d[k] for k in ("gamma", "aspects", "sigmas")}
    return _GAMMA_ARRAYS


def _make_recolorer(strength: float = 1.0) -> CNSRecolorer:
    a = _load_gamma_arrays()
    return CNSRecolorer(a["gamma"], a["aspects"], a["sigmas"], strength=strength)


# ---------------------------------------------------------------------------
# Sampler — copy of comfy.k_diffusion.sampling.sample_er_sde with the single
# noise-injection line routed through the recolorer.
# ---------------------------------------------------------------------------


@torch.no_grad()
def sample_er_sde_cns(
    model,
    x,
    sigmas,
    extra_args=None,
    callback=None,
    disable=None,
    s_noise=1.0,
    noise_sampler=None,
    noise_scaler=None,
    max_stage=3,
):
    """ER-SDE-Solver-3 (arXiv 2309.06169) with CNS-recolored per-step noise.

    Verbatim copy of ``comfy.k_diffusion.sampling.sample_er_sde``; the only
    change is the final stochastic-injection line, where the white draw is
    recolored via :class:`CNSRecolorer` at σ = ``float(sigmas[i])`` (matching the
    CLI ``ERSDESampler._sample_noise`` seam). With recoloring removed the math is
    bit-identical to stock ``er_sde``.
    """
    from comfy.k_diffusion.sampling import (
        default_noise_sampler,
        offset_first_sigma_for_snr,
        sigma_to_half_log_snr,
    )
    from comfy.utils import model_trange as trange

    recolorer = _make_recolorer(strength=1.0)

    extra_args = {} if extra_args is None else extra_args
    seed = extra_args.get("seed", None)
    noise_sampler = default_noise_sampler(x, seed=seed) if noise_sampler is None else noise_sampler
    s_in = x.new_ones([x.shape[0]])

    def default_er_sde_noise_scaler(x):
        return x * ((x ** 0.3).exp() + 10.0)

    noise_scaler = default_er_sde_noise_scaler if noise_scaler is None else noise_scaler
    num_integration_points = 200.0
    point_indice = torch.arange(0, num_integration_points, dtype=torch.float32, device=x.device)

    model_sampling = model.inner_model.model_patcher.get_model_object("model_sampling")
    sigmas = offset_first_sigma_for_snr(sigmas, model_sampling)
    half_log_snrs = sigma_to_half_log_snr(sigmas, model_sampling)
    er_lambdas = half_log_snrs.neg().exp()  # er_lambda_t = sigma_t / alpha_t

    old_denoised = None
    old_denoised_d = None

    for i in trange(len(sigmas) - 1, disable=disable):
        denoised = model(x, sigmas[i] * s_in, **extra_args)
        if callback is not None:
            callback({'x': x, 'i': i, 'sigma': sigmas[i], 'sigma_hat': sigmas[i], 'denoised': denoised})
        stage_used = min(max_stage, i + 1)
        if sigmas[i + 1] == 0:
            x = denoised
        else:
            er_lambda_s, er_lambda_t = er_lambdas[i], er_lambdas[i + 1]
            alpha_s = sigmas[i] / er_lambda_s
            alpha_t = sigmas[i + 1] / er_lambda_t
            r_alpha = alpha_t / alpha_s
            r = noise_scaler(er_lambda_t) / noise_scaler(er_lambda_s)

            # Stage 1 Euler
            x = r_alpha * r * x + alpha_t * (1 - r) * denoised

            if stage_used >= 2:
                dt = er_lambda_t - er_lambda_s
                lambda_step_size = -dt / num_integration_points
                lambda_pos = er_lambda_t + point_indice * lambda_step_size
                scaled_pos = noise_scaler(lambda_pos)

                # Stage 2
                s = torch.sum(1 / scaled_pos) * lambda_step_size
                denoised_d = (denoised - old_denoised) / (er_lambda_s - er_lambdas[i - 1])
                x = x + alpha_t * (dt + s * noise_scaler(er_lambda_t)) * denoised_d

                if stage_used >= 3:
                    # Stage 3
                    s_u = torch.sum((lambda_pos - er_lambda_s) / scaled_pos) * lambda_step_size
                    denoised_u = (denoised_d - old_denoised_d) / ((er_lambda_s - er_lambdas[i - 2]) / 2)
                    x = x + alpha_t * ((dt ** 2) / 2 + s_u * noise_scaler(er_lambda_t)) * denoised_u
                old_denoised_d = denoised_d

            if s_noise > 0:
                # CNS seam: recolor the white draw before injection (σ = sigmas[i],
                # matching anima_lora ERSDESampler._sample_noise). Variance-conserving.
                white = noise_sampler(sigmas[i], sigmas[i + 1])
                colored = recolorer.recolor(white, float(sigmas[i]))
                x = x + alpha_t * colored * s_noise * (er_lambda_t ** 2 - er_lambda_s ** 2 * r ** 2).sqrt().nan_to_num(nan=0.0)

        old_denoised = denoised
    return x


# ---------------------------------------------------------------------------
# Registration — make `er_sde_cns` selectable in the sampler_name dropdown
# ---------------------------------------------------------------------------


def register_cns_sampler() -> None:
    """Register ``er_sde_cns`` into ComfyUI's global sampler registry.

    ``comfy.samplers.ksampler(name)`` dispatches via
    ``getattr(comfy.k_diffusion.sampling, "sample_" + name)``, and the dropdown
    reads the live ``KSampler.SAMPLERS`` list — so we set the attribute and
    append the name. Idempotent; called once at node import.
    """
    try:
        import comfy.samplers
        import comfy.k_diffusion.sampling as kds

        if not hasattr(kds, "sample_er_sde_cns"):
            kds.sample_er_sde_cns = sample_er_sde_cns
        samplers = comfy.samplers.KSampler.SAMPLERS
        if CNS_SAMPLER_NAME not in samplers:
            samplers.append(CNS_SAMPLER_NAME)
        logger.info("CNS: registered sampler '%s' (Anima-calibrated colored ER-SDE)", CNS_SAMPLER_NAME)
    except Exception as e:  # noqa: BLE001 — never break the node pack over this
        logger.warning("CNS: failed to register '%s' sampler (%s)", CNS_SAMPLER_NAME, e)
