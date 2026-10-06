"""OmniRoute AI provider implementation."""

import logging
import os
import requests
from typing import Any, List
from .base import AIProvider

logger = logging.getLogger(__name__)


class OmniRouteProvider(AIProvider):
    """OmniRoute AI provider implementation."""

    def __init__(self, api_key: str, base_url: str):
        """
        Initialize the OmniRoute provider.

        Args:
            api_key: The API key for OmniRoute
            base_url: The base URL for the OmniRoute API
        """
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        })
        self.available_models = self._discover_models()

    def _discover_models(self) -> List[str]:
        """
        Discover available models from the OmniRoute API.

        Returns:
            List of available model IDs
        """
        try:
            response = self.session.get(f"{self.base_url}/v1/models", timeout=10)
            if response.ok:
                data = response.json()
                models = [model.get("id") for model in data.get("data", []) if model.get("id")]
                logger.info(f"Discovered {len(models)} models from OmniRoute")
                return models
            else:
                logger.warning(f"Failed to discover models from OmniRoute: {response.status_code}")
                return []
        except Exception as e:
            logger.warning(f"Error discovering models from OmniRoute: {e}")
            return []

    def generate_response(self, prompt: str) -> str:
        """
        Generate a response from the OmniRoute API.

        Args:
            prompt: The prompt to send to the AI provider

        Returns:
            The AI-generated response text

        Raises:
            Exception: If the API request fails
        """
        # Try each available model until one works
        for model in self.available_models or [os.getenv("OMNIROUTE_MODEL", "auto")]:
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
                    f"{self.base_url}/v1/chat/completions",
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
        Check if the OmniRoute provider is available.

        Returns:
            True if provider is available, False otherwise
        """
        if not self.api_key:
            return False

        try:
            # Try a simple request to check connectivity
            response = self.session.get(f"{self.base_url}/v1/models", timeout=5)
            return response.ok
        except Exception:
            return False