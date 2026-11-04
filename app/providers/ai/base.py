"""Base interface and output-budget helpers for AI providers."""

import os
from abc import ABC, abstractmethod


DEFAULT_OUTPUT_TOKENS = 2048
MAX_OUTPUT_TOKENS = 8192
MIN_OUTPUT_TOKENS = 512


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

    @abstractmethod
    def is_available(self) -> bool:
        """Return whether the provider is configured and reachable."""
        raise NotImplementedError
