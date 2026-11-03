"""AI provider discovery and fallback handling."""

import logging
import os

from .base import AIProvider
from .omniroute import OmniRouteProvider
from .opencode import OpenCodeProvider
from .openrouter import OpenRouterProvider

logger = logging.getLogger(__name__)

_provider_cache: list[AIProvider] | None = None
_provider_cache_key: tuple[str, ...] | None = None


def _config_key() -> tuple[str, ...]:
    return (
        os.getenv("OMNIROUTE_API_KEY", ""),
        os.getenv("OMNIROUTE_BASE_URL", ""),
        os.getenv("OMNIROUTE_COMBO_NAME", ""),
        os.getenv("OMNIROUTE_MODEL", ""),
        os.getenv("OPENCODE_ZEN_API_KEY", ""),
        os.getenv("OPENCODE_BASE_URL", ""),
        os.getenv("OPENCODE_MODEL", ""),
        os.getenv("OPENROUTER_API_KEY", ""),
        os.getenv("OPENROUTER_MODEL", ""),
    )


def get_ai_providers(force_refresh: bool = False) -> list[AIProvider]:
    """Return configured providers, reusing instances to avoid per-request setup."""
    global _provider_cache, _provider_cache_key

    key = _config_key()
    if not force_refresh and _provider_cache is not None and _provider_cache_key == key:
        return _provider_cache

    providers: list[AIProvider] = []
    for factory in (_try_omniroute, _try_opencode, _try_openrouter):
        try:
            provider = factory()
            if provider and provider.is_available():
                logger.info(
                    "AI provider available: %s",
                    provider.__class__.__name__,
                )
                providers.append(provider)
        except Exception as exc:
            logger.debug("AI provider discovery failed: %s", exc)

    _provider_cache = providers
    _provider_cache_key = key
    return providers


def reset_provider_cache() -> None:
    """Clear cached providers after changing environment/configuration."""
    global _provider_cache, _provider_cache_key
    _provider_cache = None
    _provider_cache_key = None


def get_ai_provider() -> AIProvider | None:
    """Return the highest-priority available AI provider."""
    providers = get_ai_providers()
    return providers[0] if providers else None


def _try_omniroute() -> AIProvider | None:
    api_key = os.getenv("OMNIROUTE_API_KEY")
    if not api_key:
        return None
    combo_name = (
        os.getenv("OMNIROUTE_COMBO_NAME")
        or os.getenv("OMNIROUTE_MODEL")
        or ""
    ).strip()
    if not combo_name or combo_name.lower() == "auto":
        logger.warning(
            "OmniRoute is configured but no exact combo name is set; "
            "set OMNIROUTE_COMBO_NAME to the combo created in OmniRoute."
        )
        return None

    return OmniRouteProvider(
        api_key.strip(),
        os.getenv("OMNIROUTE_BASE_URL", "http://127.0.0.1:20128/v1"),
        combo_name,
    )


def _try_opencode() -> AIProvider | None:
    api_key = os.getenv("OPENCODE_ZEN_API_KEY")
    if not api_key:
        return None
    return OpenCodeProvider(api_key.strip())


def _try_openrouter() -> AIProvider | None:
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        return None
    return OpenRouterProvider(api_key.strip())


def get_provider_info() -> dict:
    """Report configuration and selected provider without exposing secrets."""
    info = {
        "omniroute": {"configured": bool(os.getenv("OMNIROUTE_API_KEY"))},
        "opencode": {"configured": bool(os.getenv("OPENCODE_ZEN_API_KEY"))},
        "openrouter": {"configured": bool(os.getenv("OPENROUTER_API_KEY"))},
    }
    providers = get_ai_providers()
    info["selected"] = (
        providers[0].__class__.__name__ if providers else None
    )
    info["fallbacks"] = [
        provider.__class__.__name__ for provider in providers[1:]
    ]
    return info
