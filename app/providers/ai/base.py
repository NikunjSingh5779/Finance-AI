"""Base AI provider interface."""

from abc import ABC, abstractmethod
from typing import Optional


class AIProvider(ABC):
    """Abstract base class for AI providers."""

    @abstractmethod
    def generate_response(self, prompt: str) -> str:
        """
        Generate a response from the AI provider.

        Args:
            prompt: The prompt to send to the AI provider

        Returns:
            The AI-generated response text
        """
        pass

    @abstractmethod
    def is_available(self) -> bool:
        """
        Check if the provider is available and configured correctly.

        Returns:
            True if provider is available, False otherwise
        """
        pass