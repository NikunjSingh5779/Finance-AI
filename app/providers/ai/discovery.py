"""Discover the first configured AI provider."""

import logging
import os

from .base import AIProvider
from .omniroute import OmniRouteProvider
from .opencode import OpenCodeProvider
from .openrouter import OpenRouterProvider

logger = logging.getLogger(__name__)


def get_ai_provider() -> AIProvider | None:
    """Return the first available provider in configured priority order."""
    for factory in (_try_omniroute, _try_opencode, _try_openrouter):
        try:
            provider = factory()
            if provider and provider.is_available():
                logger.info("Using %s AI provider", provider.__class__.__name__)
                return provider
        except Exception as exc:
            logger.debug("AI provider discovery failed: %s", exc)

    logger.warning("No AI provider available")
    return None


def _try_omniroute() -> AIProvider | None:
    api_key = os.getenv("OMNIROUTE_API_KEY")
    if not api_key:
        return None
    return OmniRouteProvider(
        api_key.strip(),
        os.getenv("OMNIROUTE_BASE_URL", "http://127.0.0.1:20128"),
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
    provider = get_ai_provider()
    info["selected"] = (
        provider.__class__.__name__ if provider is not None else None
    )
    return info
