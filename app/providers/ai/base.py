"""Base interface for AI providers."""

from abc import ABC, abstractmethod


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
