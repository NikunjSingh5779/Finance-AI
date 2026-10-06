"""Backward-compatible AI facade for older integrations."""

from app.core.exceptions import ProviderUnavailableError
from app.providers.ai.discovery import get_ai_provider, get_provider_info


def ask_ai(
    system_message: str,
    user_message: str,
    max_tokens: int = 512,
) -> str:
    """Generate text through the configured provider."""
    provider = get_ai_provider()
    if provider is None:
        raise ProviderUnavailableError(
            "ai",
            "No configured provider is available",
        )

    prompt = (
        f"{system_message.strip()}\n\n"
        f"USER REQUEST:\n{user_message.strip()}\n\n"
        "Respond with practical, factual guidance. "
        "Do not invent financial facts or guarantee returns."
    )

    try:
        return provider.generate_response(prompt)
    except Exception as exc:
        raise ProviderUnavailableError("ai", str(exc)) from exc


__all__ = ["ask_ai", "get_ai_provider", "get_provider_info"]
