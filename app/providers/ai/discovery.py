"""AI provider discovery and fallback handling."""

import logging
import os

from .base import AIProvider
from .groq import GROQ_FREE_MODELS, GroqProvider
from .nvidia_nim import NVIDIA_NIM_DEVELOPMENT_MODELS, NvidiaNimProvider
from .openrouter import OpenRouterProvider

logger = logging.getLogger(__name__)

_provider_cache: list[AIProvider] | None = None
_provider_cache_key: tuple[str, ...] | None = None


def _config_key() -> tuple[str, ...]:
    """Track non-secret configuration values that change provider instances."""
    return (
        os.getenv("NVIDIA_NIM_API_KEY", ""),
        os.getenv("NVIDIA_NIM_BASE_URL", ""),
        os.getenv("NVIDIA_NIM_MODEL", ""),
        os.getenv("NVIDIA_NIM_MODELS", ""),
        os.getenv("NVIDIA_NIM_PRODUCTION_LICENSED", ""),
        os.getenv("GROQ_API_KEY", ""),
        os.getenv("GROQ_BASE_URL", ""),
        os.getenv("GROQ_MODEL", ""),
        os.getenv("OPENROUTER_API_KEY", ""),
        os.getenv("OPENROUTER_MODEL", ""),
        os.getenv("OPENROUTER_FREE_MODELS", ""),
        os.getenv("OPENROUTER_MAX_FREE_FALLBACKS", ""),
        os.getenv("AI_PROVIDER_ATTEMPT_TIMEOUT_SECONDS", ""),
    )


def get_ai_providers(force_refresh: bool = False) -> list[AIProvider]:
    """Return configured providers in priority order, reusing live clients."""
    global _provider_cache, _provider_cache_key

    key = _config_key()
    if (
        not force_refresh
        and _provider_cache is not None
        and _provider_cache_key == key
    ):
        return _provider_cache

    providers: list[AIProvider] = []
    # NIM is preferred when available and explicitly licensed for production.
    # Otherwise Groq Free and OpenRouter form the hosted free fallback chain.
    for factory in (_try_nvidia_nim, _try_groq, _try_openrouter):
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


def _try_nvidia_nim() -> AIProvider | None:
    api_key = os.getenv("NVIDIA_NIM_API_KEY")
    if not api_key:
        return None
    return NvidiaNimProvider(api_key.strip())


def _try_groq() -> AIProvider | None:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return None
    return GroqProvider(api_key.strip())


def _try_openrouter() -> AIProvider | None:
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        return None
    return OpenRouterProvider(api_key.strip())


def get_provider_info() -> dict:
    """Report configuration and selection without exposing credentials."""
    nim_model = os.getenv("NVIDIA_NIM_MODEL", "openai/gpt-oss-20b").strip()
    nim_models = {
        value.strip()
        for value in os.getenv(
            "NVIDIA_NIM_MODELS",
            "openai/gpt-oss-20b",
        ).split(",")
        if value.strip()
    }
    groq_model = os.getenv("GROQ_MODEL", GROQ_FREE_MODELS[0]).strip()
    production = (
        os.getenv("APP_ENV", "").strip().lower() in {"production", "prod"}
        or os.getenv("ENVIRONMENT", "").strip().lower() in {"production", "prod"}
        or os.getenv("AUTH_REQUIRED", "").strip().lower() in {"1", "true", "yes"}
    )
    nim_license = os.getenv(
        "NVIDIA_NIM_PRODUCTION_LICENSED", ""
    ).strip().lower() in {"1", "true", "yes"}

    info = {
        "nvidia_nim": {
            "configured": bool(os.getenv("NVIDIA_NIM_API_KEY")),
            "model_configured": nim_model in nim_models,
            "production_licensed": nim_license,
            "production_blocked": production and not nim_license,
            "allowlisted_models": list(NVIDIA_NIM_DEVELOPMENT_MODELS),
        },
        "groq": {
            "configured": bool(os.getenv("GROQ_API_KEY")),
            "model_configured": groq_model in GROQ_FREE_MODELS,
            "free_models": list(GROQ_FREE_MODELS),
        },
        "openrouter": {
            "configured": bool(os.getenv("OPENROUTER_API_KEY")),
            "model_configured": bool(
                os.getenv("OPENROUTER_MODEL", "openrouter/free").strip()
            ),
        },
    }
    providers = get_ai_providers()
    info["selected"] = (
        providers[0].__class__.__name__ if providers else None
    )
    info["fallbacks"] = [
        provider.__class__.__name__ for provider in providers[1:]
    ]
    return info
