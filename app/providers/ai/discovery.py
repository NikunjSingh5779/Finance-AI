"""AI provider discovery and selection."""

import os
import logging
from typing import Optional, Tuple
from .base import AIProvider
from .omniroute import OmniRouteProvider
from .opencode import OpenCodeProvider
from .openrouter import OpenRouterProvider

logger = logging.getLogger(__name__)


def get_ai_provider() -> Optional[AIProvider]:
    """
    Discover and initialize the best available AI provider.

    Returns:
        An initialized AIProvider instance, or None if no provider is available

    Priority order:
    1. OmniRoute (if API key configured)
    2. OpenCode (if API key configured)
    3. OpenRouter (if API key configured)
    """
    try:
        # Try OmniRoute first
        omniroute_provider = _try_omniroute()
        if omniroute_provider and omniroute_provider.is_available():
            logger.info("Using OmniRoute AI provider")
            return omniroute_provider
    except Exception as e:
        logger.debug(f"OmniRoute provider initialization failed: {e}")

    try:
        # Try OpenCode second
        opencode_provider = _try_opencode()
        if opencode_provider and opencode_provider.is_available():
            logger.info("Using OpenCode AI provider")
            return opencode_provider
    except Exception as e:
        logger.debug(f"OpenCode provider initialization failed: {e}")

    try:
        # Try OpenRouter third
        openrouter_provider = _try_openrouter()
        if openrouter_provider and openrouter_provider.is_available():
            logger.info("Using OpenRouter AI provider")
            return openrouter_provider
    except Exception as e:
        logger.debug(f"OpenRouter provider initialization failed: {e}")

    logger.warning("No AI provider available")
    return None


def _try_omniroute() -> Optional[AIProvider]:
    """Try to initialize OmniRoute provider."""
    api_key = os.getenv("OMNIROUTE_API_KEY")
    if not api_key:
        return None

    base_url = os.getenv("OMNIROUTE_BASE_URL", "http://127.0.0.1:20128")
    return OmniRouteProvider(api_key.strip(), base_url)


def _try_opencode() -> Optional[AIProvider]:
    """Try to initialize OpenCode provider."""
    api_key = os.getenv("OPENCODE_ZEN_API_KEY")
    if not api_key:
        return None

    return OpenCodeProvider(api_key.strip())


def _try_openrouter() -> Optional[AIProvider]:
    """Try to initialize OpenRouter provider."""
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        return None

    return OpenRouterProvider(api_key.strip())


def get_provider_info() -> dict:
    """
    Get information about available providers.

    Returns:
        Dictionary with provider availability information
    """
    info = {
        "omniroute": {
            "available": bool(os.getenv("OMNIROUTE_API_KEY")),
            "configured": bool(os.getenv("OMNIROUTE_API_KEY"))
        },
        "opencode": {
            "available": bool(os.getenv("OPENCODE_ZEN_API_KEY")),
            "configured": bool(os.getenv("OPENCODE_ZEN_API_KEY"))
        },
        "openrouter": {
            "available": bool(os.getenv("OPENROUTER_API_KEY")),
            "configured": bool(os.getenv("OPENROUTER_API_KEY"))
        }
    }

    # Determine which provider would be selected
    provider = get_ai_provider()
    if provider:
        if isinstance(provider, OmniRouteProvider):
            info["selected"] = "omniroute"
        elif isinstance(provider, OpenCodeProvider):
            info["selected"] = "opencode"
        elif isinstance(provider, OpenRouterProvider):
            info["selected"] = "openrouter"
    else:
        info["selected"] = None

    return info