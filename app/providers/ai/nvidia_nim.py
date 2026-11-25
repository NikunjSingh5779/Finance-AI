"""NVIDIA NIM API Catalog provider for development and licensed deployments."""

import os

from .openai_compatible import OpenAICompatibleProvider

# Keep this list deliberately small and documented. NIM's hosted Developer
# Program API Catalog access is for prototyping/testing, not production use.
NVIDIA_NIM_DEVELOPMENT_MODELS = (
    "openai/gpt-oss-20b",
)


def _production_mode() -> bool:
    return (
        os.getenv("APP_ENV", "").strip().lower() in {"production", "prod"}
        or os.getenv("ENVIRONMENT", "").strip().lower() in {"production", "prod"}
        or os.getenv("AUTH_REQUIRED", "").strip().lower() in {"1", "true", "yes"}
    )


class NvidiaNimProvider(OpenAICompatibleProvider):
    """NVIDIA NIM client, gated from production unless licensed for production."""

    def __init__(self, api_key: str):
        model = os.getenv(
            "NVIDIA_NIM_MODEL",
            "openai/gpt-oss-20b",
        ).strip()
        # An operator can narrow this list, but cannot expand it to arbitrary
        # or paid models through environment configuration.
        configured = {
            value.strip()
            for value in os.getenv(
                "NVIDIA_NIM_MODELS",
                "openai/gpt-oss-20b",
            ).split(",")
            if value.strip()
        }
        allowed = tuple(
            model_id
            for model_id in NVIDIA_NIM_DEVELOPMENT_MODELS
            if model_id in configured
        )
        super().__init__(
            api_key=api_key,
            base_url=os.getenv(
                "NVIDIA_NIM_BASE_URL",
                "https://integrate.api.nvidia.com/v1",
            ),
            model=model,
            allowed_models=allowed,
            provider_name="NVIDIA NIM",
        )

    def is_available(self) -> bool:
        if _production_mode() and os.getenv(
            "NVIDIA_NIM_PRODUCTION_LICENSED", ""
        ).strip().lower() not in {"1", "true", "yes"}:
            return False
        return super().is_available()
