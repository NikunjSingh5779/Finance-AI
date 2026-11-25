"""Groq Cloud provider restricted to the documented free-tier chat models."""

import os

from .openai_compatible import OpenAICompatibleProvider

# Groq's current Free plan documents these two production chat models.
# Preview/paid/enterprise-only models are deliberately excluded.
GROQ_FREE_MODELS = (
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
)


class GroqProvider(OpenAICompatibleProvider):
    """OpenAI-compatible Groq API client with a strict free-model allowlist."""

    def __init__(self, api_key: str):
        model = os.getenv("GROQ_MODEL", GROQ_FREE_MODELS[0]).strip()
        super().__init__(
            api_key=api_key,
            base_url=os.getenv(
                "GROQ_BASE_URL",
                "https://api.groq.com/openai/v1",
            ),
            model=model,
            allowed_models=GROQ_FREE_MODELS,
            provider_name="Groq",
        )
