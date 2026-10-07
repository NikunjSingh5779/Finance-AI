"""AI provider discovery and fallback handling."""

import logging
import os

from .base import AIProvider
from .omniroute import OmniRouteProvider
from .opencode import OpenCodeProvider
from .openrouter import OpenRouterProvider

logger = logging.getLogger(__name__)


def get_ai_providers() -> list[AIProvider]:
    """Return all configured and currently reachable providers in priority order."""
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

    return providers


def get_ai_provider() -> AIProvider | None:
    """Return the highest-priority available AI provider."""
    providers = get_ai_providers()
    return providers[0] if providers else None


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
    providers = get_ai_providers()
    info["selected"] = (
        providers[0].__class__.__name__ if providers else None
    )
    info["fallbacks"] = [
        provider.__class__.__name__ for provider in providers[1:]
    ]
    return info
