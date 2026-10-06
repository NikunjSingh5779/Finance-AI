"""OpenRouter AI provider implementation."""

import logging
import os
import requests
from typing import Any, List
from .base import AIProvider

logger = logging.getLogger(__name__)


class OpenRouterProvider(AIProvider):
    """OpenRouter AI provider implementation."""

    def __init__(self, api_key: str):
        """
        Initialize the OpenRouter provider.

        Args:
            api_key: The API key for OpenRouter
        """
        self.api_key = api_key
        self.base_url = "https://openrouter.ai/api/v1"
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://financeai.local",  # Optional but recommended
            "X-Title": "Finance AI"  # Optional but recommended
        })
        self.available_models = self._discover_models()

    def _discover_models(self) -> List[str]:
        """
        Discover available free models from the OpenRouter API.

        Returns:
            List of available free model IDs
        """
        try:
            response = self.session.get(f"{self.base_url}/models", timeout=10)
            if response.ok:
                data = response.json()
                models = []
                for model in data.get("data", []):
                    model_id = model.get("id")
                    if not model_id:
                        continue

                    # Check if it's a free model
                    pricing = model.get("pricing") or {}
                    has_explicit_pricing = (
                        "prompt" in pricing and "completion" in pricing
                    )

                    if has_explicit_pricing:
                        try:
                            prompt_float = float(pricing["prompt"])
                            completion_float = float(pricing["completion"])
                            is_free = prompt_float == 0.0 and completion_float == 0.0
                        except (ValueError, TypeError):
                            is_free = ":free" in model_id or "/free" in model_id
                    else:
                        is_free = ":free" in model_id or "/free" in model_id

                    if is_free:
                        models.append(model_id)

                logger.info(f"Discovered {len(models)} free models from OpenRouter")
                return models
            else:
                logger.warning(f"Failed to discover models from OpenRouter: {response.status_code}")
                return []
        except Exception as e:
            logger.warning(f"Error discovering models from OpenRouter: {e}")
            return []

    def generate_response(self, prompt: str) -> str:
        """
        Generate a response from the OpenRouter API.

        Args:
            prompt: The prompt to send to the AI provider

        Returns:
            The AI-generated response text

        Raises:
            Exception: If the API request fails
        """
        # Try each available model until one works
        for model in self.available_models or [os.getenv("OPENROUTER_MODEL", "openrouter/free")]:
            try:
                payload = {
                    "model": model,
                    "messages": [
                        {"role": "user", "content": prompt}
                    ],
                    "max_tokens": 1024,
                    "temperature": 0.7
                }

                response = self.session.post(
                    f"{self.base_url}/chat/completions",
                    json=payload,
                    timeout=30
                )

                if response.ok:
                    data = response.json()
                    if data.get("choices") and len(data["choices"]) > 0:
                        message = data["choices"][0].get("message", {})
                        content = message.get("content", "")
                        if content:
                            return content.strip()

                logger.warning(f"Model {model} returned unsuccessful response: {response.status_code}")

            except Exception as e:
                logger.warning(f"Error with model {model}: {e}")
                continue

        raise Exception("All models failed to generate a response")

    def is_available(self) -> bool:
        """
        Check if the OpenRouter provider is available.

        Returns:
            True if provider is available, False otherwise
        """
        if not self.api_key:
            return False

        try:
            # Try a simple request to check connectivity
            response = self.session.get(f"{self.base_url}/models", timeout=5)
            return response.ok
        except Exception:
            return False