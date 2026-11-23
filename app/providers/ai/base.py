"""Base interface and output-budget helpers for AI providers."""

import os
from abc import ABC, abstractmethod
from collections.abc import Iterator


DEFAULT_OUTPUT_TOKENS = 2048
MAX_OUTPUT_TOKENS = 8192
MIN_OUTPUT_TOKENS = 512


class FreeModelConfigurationError(RuntimeError):
    """Raised when a configured AI route cannot be proven free to use."""


def configured_free_routes(env_name: str) -> frozenset[str]:
    """Return exact, explicitly configured free model or combo names.

    Providers without a pricing API must never infer that a route is free from
    a name such as ``*-free``.  Their operator has to opt it in explicitly.
    """
    return frozenset(
        value.strip()
        for value in os.getenv(env_name, "").split(",")
        if value.strip()
    )


def require_free_route(
    route: str,
    *,
    allowlist_env: str,
    provider_name: str,
) -> None:
    """Fail closed unless *route* is an exact configured free route."""
    allowed_routes = configured_free_routes(allowlist_env)
    if route and route in allowed_routes:
        return

    if not allowed_routes:
        raise FreeModelConfigurationError(
            f"{provider_name} is disabled until {allowlist_env} explicitly "
            "lists the configured free route."
        )

    raise FreeModelConfigurationError(
        f"{provider_name} route {route!r} is not explicitly allowlisted as "
        f"free in {allowlist_env}."
    )


def get_output_token_limit(env_name: str) -> int:
    """Read a safe, configurable output budget for an AI provider."""
    raw_value = os.getenv(env_name, str(DEFAULT_OUTPUT_TOKENS)).strip()
    try:
        configured = int(raw_value)
    except (TypeError, ValueError):
        configured = DEFAULT_OUTPUT_TOKENS
    return min(MAX_OUTPUT_TOKENS, max(MIN_OUTPUT_TOKENS, configured))


def expanded_output_token_limit(current: int) -> int:
    """Double a truncated response's budget, without exceeding the safe cap."""
    return min(MAX_OUTPUT_TOKENS, max(current + MIN_OUTPUT_TOKENS, current * 2))


class AIProvider(ABC):
    """Abstract interface shared by all AI providers."""

    @abstractmethod
    def generate_response(self, prompt: str) -> str:
        """Generate a text response for a prompt."""
        raise NotImplementedError

    def stream_response(self, prompt: str) -> Iterator[str]:
        """Yield provider text deltas when the provider supports streaming.

        This is intentionally optional so callers can retain the existing
        whole-response path for provider implementations that do not expose
        a safe streaming endpoint.
        """
        raise NotImplementedError("This AI provider does not support streaming")

    @abstractmethod
    def is_available(self) -> bool:
        """Return whether the provider is configured and reachable."""
        raise NotImplementedError
