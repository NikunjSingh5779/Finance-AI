import os
import logging
import requests
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# ============================================================
# FREE-ONLY AI CONFIGURATION
# ============================================================
#
# This module intentionally supports ONLY:
#
#   1. OpenCode Zen free chat models
#   2. OpenRouter free models
#
# Paid Claude/OpenAI models are NOT supported by this module.
#
# IMPORTANT:
#   Jev is NOT included here because Jev uses:
#       /v1/systemone
#
#   This file is for normal conversational AI:
#       /v1/chat/completions
# ============================================================


# ============================================================
# OPENCODE ZEN
# ============================================================
#
# Static fallback list for OpenCode free models when API discovery fails.
# Used only when the /v1/models endpoint is unavailable.
# ============================================================

_OPENCODE_FREE_FALLBACK = [
    "big-pickle",
    "deepseek-v4-flash-free",
    "mimo-v2.5-free",
    "auto",
]


# ============================================================
# OPENROUTER
# ============================================================
#
# OpenRouter provides:
#
#   openrouter/free
#
# which routes to currently available FREE models.
#
# This is preferable to hard-coding individual free models.
# ============================================================

_OPENROUTER_FREE_ROUTER = "openrouter/free"


# ============================================================
# ENVIRONMENT / KEY LOADING
# ============================================================

def _load_key():
    """
    Load a FREE-provider API key.

    Priority:
        1. OpenCode Zen
        2. OpenRouter

    Paid providers are intentionally not supported.
    """

    opencode_key = os.getenv("OPENCODE_ZEN_API_KEY")
    if opencode_key:
        return "opencode", opencode_key.strip()

    openrouter_key = os.getenv("OPENROUTER_API_KEY")
    if openrouter_key:
        return "openrouter", openrouter_key.strip()

    raise RuntimeError(
        "No FREE AI API key configured. Set one of:\n"
        "  OPENCODE_ZEN_API_KEY\n"
        "  OPENROUTER_API_KEY"
    )


# ============================================================
# OPENCODE MODEL DISCOVERY
# ============================================================

def _get_opencode_models(key: str) -> list[str]:
    """
    Discover currently available FREE OpenCode chat-completion models
    from the /v1/models API endpoint.

    Logic:
    1. Read response["data"]
    2. Keep model IDs with pricing.prompt equal to "0"
    3. Also allow IDs containing "-free" when pricing metadata is missing
    4. Preserve API response ordering
    5. Add "auto" at the end if not already present
    6. If discovery fails, return _OPENCODE_FREE_FALLBACK
    """

    try:
        response = requests.get(
            "https://opencode.ai/zen/v1/models",
            headers={
                "Authorization": f"Bearer {key}",
            },
            timeout=10,
        )

        if response.ok:
            data = response.json().get("data", [])
            free_models = []
            seen = set()

            for model in data:
                model_id = str(model.get("id", "")).strip()
                if not model_id or model_id in seen:
                    continue

                seen.add(model_id)

                # Check if pricing indicates free model (prompt = "0")
                pricing = model.get("pricing", {})
                prompt_price = str(pricing.get("prompt", "")).strip()

                if prompt_price == "0":
                    free_models.append(model_id)
                elif "-free" in model_id and not pricing:
                    # Allow -free models when pricing metadata is missing
                    free_models.append(model_id)

            # Add "auto" if not already present
            if "auto" not in seen:
                free_models.append("auto")

            if free_models:
                logger.info(
                    "OpenCode free chat models discovered: %s",
                    free_models,
                )
                return free_models

            logger.warning(
                "No free OpenCode models found in current catalog."
            )

        else:
            logger.warning(
                "OpenCode /v1/models returned HTTP %s: %s",
                response.status_code,
                response.text[:500],
            )

    except requests.exceptions.Timeout:
        logger.warning("OpenCode model discovery timed out.")

    except requests.exceptions.ConnectionError:
        logger.warning("OpenCode model discovery connection error.")

    except ValueError:
        logger.warning("OpenCode model discovery returned invalid JSON.")

    except Exception as exc:
        logger.exception(
            "Unexpected OpenCode model discovery error: %s",
            exc,
        )

    # Static FREE fallback when discovery fails
    return _OPENCODE_FREE_FALLBACK.copy()


# ============================================================
# OPENROUTER FREE MODEL CHECK
# ============================================================

def _get_openrouter_free_models(key: str) -> list[str]:
    """
    Discover available free models from OpenRouter's /v1/models API.

    Returns models with pricing.prompt == "0", preserving API ordering.
    Falls back to ["openrouter/free", "openrouter/auto"] if discovery fails.
    """

    try:
        response = requests.get(
            "https://openrouter.ai/api/v1/models",
            headers={
                "Authorization": f"Bearer {key}",
            },
            timeout=10,
        )

        if response.ok:
            data = response.json().get("data", [])
            free_models = []
            seen = set()

            # Always try openrouter/free first
            free_models.append("openrouter/free")
            seen.add("openrouter/free")

            # Add other free models from API
            for model in data:
                model_id = str(model.get("id", "")).strip()
                if not model_id or model_id in seen:
                    continue

                # Check if pricing indicates free model (prompt = "0")
                pricing = model.get("pricing", {})
                if isinstance(pricing, dict):
                    prompt_price = str(pricing.get("prompt", "")).strip()
                    if prompt_price == "0":
                        free_models.append(model_id)
                        seen.add(model_id)

            # Add fallback models
            for fallback in ["openrouter/auto"]:
                if fallback not in seen:
                    free_models.append(fallback)

            if len(free_models) > 1:  # More than just openrouter/free
                logger.info(
                    "OpenRouter free models discovered: %s",
                    free_models,
                )
                return free_models

        else:
            logger.warning(
                "OpenRouter /v1/models returned HTTP %s: %s",
                response.status_code,
                response.text[:500],
            )

    except Exception as exc:
        logger.warning(
            "OpenRouter free-model discovery failed: %s",
            exc,
        )

    # Static fallback when discovery fails
    return ["openrouter/free", "openrouter/auto"]


# ============================================================
# BUILD MESSAGES
# ============================================================

def _build_messages(
    system_message: str = "",
    user_message: str = "",
):
    """
    Build OpenAI-compatible chat messages.
    """

    messages = []

    if system_message:
        messages.append(
            {
                "role": "system",
                "content": system_message,
            }
        )

    messages.append(
        {
            "role": "user",
            "content": user_message,
        }
    )

    return messages


# ============================================================
# OPENCODE CHAT
# ============================================================

def _ask_opencode(
    key: str,
    messages: list[dict],
    max_tokens: int,
) -> str:
    """
    Call OpenCode Zen using only FREE chat-completion models.

    Strategy:

        1. Discover currently available free models.
        2. Try them sequentially.
        3. If one is unavailable, try the next.
        4. Return detailed diagnostic information if all fail.
    """

    url = "https://opencode.ai/zen/v1/chat/completions"

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    models = _get_opencode_models(key)

    last_status = None
    last_error = ""

    for model in models:

        payload = {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": 0.6,
            "messages": messages,
        }

        logger.info(
            "Trying OpenCode FREE model: %s",
            model,
        )

        try:
            response = requests.post(
                url,
                json=payload,
                headers=headers,
                timeout=60,
            )

            last_status = response.status_code

            logger.info(
                "OpenCode model=%s HTTP=%s",
                model,
                response.status_code,
            )

            # ------------------------------------------------
            # SUCCESS
            # ------------------------------------------------
            if response.ok:
                return _parse_openai_response(
                    response=response,
                    provider="opencode",
                    model=model,
                )

            # ------------------------------------------------
            # MODEL UNAVAILABLE
            # ------------------------------------------------
            body = response.text[:2000]

            if "Model is unavailable" in body:
                last_error = (
                    f"Model {model} is unavailable. "
                    "Trying the next FREE model."
                )

                logger.warning(
                    "OpenCode: %s",
                    last_error,
                )

                continue

            # ------------------------------------------------
            # RATE LIMIT
            # ------------------------------------------------
            if response.status_code == 429:
                last_error = (
                    f"Model {model} rate-limited: "
                    f"{body}"
                )

                logger.warning(
                    "OpenCode rate limit on %s",
                    model,
                )

                continue

            # ------------------------------------------------
            # OTHER ERROR
            # ------------------------------------------------
            last_error = (
                f"Model {model} returned HTTP "
                f"{response.status_code}: {body}"
            )

            logger.warning(
                "OpenCode model %s failed: %s",
                model,
                last_error,
            )

        except requests.exceptions.Timeout:

            last_status = None
            last_error = f"Model {model} timed out."

            logger.warning(
                "OpenCode model %s timed out.",
                model,
            )

            continue

        except requests.exceptions.ConnectionError:

            return (
                'AI provider "opencode" is unreachable. '
                "Check your internet connection."
            )

        except Exception as exc:

            last_error = (
                f"Model {model} unexpected error: {exc}"
            )

            logger.exception(
                "OpenCode model %s unexpected error.",
                model,
            )

            continue

    # --------------------------------------------------------
    # ALL MODELS FAILED
    # --------------------------------------------------------

    return (
        'AI provider "opencode" could not complete the request '
        "using any currently available FREE chat model.\n"
        f"Last HTTP status: {last_status}\n"
        f"Last error: {last_error}"
    )


# ============================================================
# OPENROUTER CHAT
# ============================================================

def _ask_openrouter(
    key: str,
    messages: list[dict],
    max_tokens: int,
) -> str:
    """
    Call OpenRouter using FREE models only.

    Strategy:
    1. Try openrouter/free first
    2. If that fails with HTTP 404/400/403/429, discover free models from API
    3. Try free models sequentially
    4. Return detailed diagnostic information if all fail
    """

    url = "https://openrouter.ai/api/v1/chat/completions"

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://finance-ai.app",
        "X-Title": "Finance AI",
    }

    # Get available free models (includes openrouter/free first)
    models = _get_openrouter_free_models(key)

    last_status = None
    last_error = ""

    for model in models:

        payload = {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": 0.6,
            "messages": messages,
        }

        logger.info(
            "Trying OpenRouter model: %s",
            model,
        )

        try:
            response = requests.post(
                url,
                json=payload,
                headers=headers,
                timeout=60,
            )

            last_status = response.status_code

            logger.info(
                "OpenRouter model=%s HTTP=%s",
                model,
                response.status_code,
            )

            # ------------------------------------------------
            # SUCCESS
            # ------------------------------------------------
            if response.ok:
                return _parse_openai_response(
                    response=response,
                    provider="openrouter",
                    model=model,
                )

            # ------------------------------------------------
            # MODEL UNAVAILABLE OR ERROR - TRY NEXT
            # ------------------------------------------------
            body = response.text[:2000]

            if response.status_code in [400, 403, 404, 429]:
                last_error = (
                    f"Model {model} returned HTTP "
                    f"{response.status_code}: {body}"
                )

                logger.warning(
                    "OpenRouter model %s failed, trying next: %s",
                    model,
                    last_error,
                )
                continue

            # ------------------------------------------------
            # OTHER ERROR
            # ------------------------------------------------
            last_error = (
                f"Model {model} returned HTTP "
                f"{response.status_code}: {body}"
            )

            logger.warning(
                "OpenRouter model %s failed: %s",
                model,
                last_error,
            )

        except requests.exceptions.Timeout:
            last_status = None
            last_error = f"Model {model} timed out."

            logger.warning(
                "OpenRouter model %s timed out.",
                model,
            )
            continue

        except requests.exceptions.ConnectionError:
            return (
                'AI provider "openrouter" is unreachable. '
                "Check your internet connection."
            )

        except Exception as exc:
            last_error = (
                f"Model {model} unexpected error: {exc}"
            )

            logger.exception(
                "OpenRouter model %s unexpected error.",
                model,
            )
            continue

    # --------------------------------------------------------
    # ALL MODELS FAILED
    # --------------------------------------------------------

    return (
        f'AI provider "openrouter" returned HTTP {last_status}.\n'
        f'Details: {last_error}'
    )


# ============================================================
# RESPONSE TEXT EXTRACTION HELPER
# ============================================================

def _extract_response_text(data: dict, provider: str) -> str | None:
    """
    Extract final response text from various provider response formats.

    Handles:
    - Standard OpenAI format: choices[0].message.content (string)
    - Content as list of text objects: [{"type": "text", "text": "..."}]
    - Content as list of strings: ["text1", "text2", ...]
    - Reasoning content fallback: choices[0].message.reasoning_content
    - Output text format: data.output_text

    Returns clean string or None if no usable text found.
    """

    # Try standard choices[0].message.content first
    try:
        choices = data.get("choices")
        if choices and len(choices) > 0:
            message = choices[0].get("message", {})
            content = message.get("content")

            # Handle string content
            if isinstance(content, str):
                text = content.strip()
                if text:
                    return text

            # Handle content as list of objects
            elif isinstance(content, list):
                parts = []

                for item in content:
                    if isinstance(item, dict):
                        # Handle {"type": "text", "text": "..."}
                        if item.get("type") == "text" and item.get("text"):
                            parts.append(str(item["text"]))
                        # Handle generic text field
                        elif item.get("text"):
                            parts.append(str(item["text"]))
                    elif isinstance(item, str):
                        # Handle list of strings
                        parts.append(item)

                if parts:
                    return "".join(parts).strip()

            # Fallback to reasoning_content (last resort)
            reasoning = message.get("reasoning_content")
            if isinstance(reasoning, str):
                text = reasoning.strip()
                if text:
                    logger.warning(
                        f"{provider} returned only reasoning_content, no final content"
                    )
                    return text

    except (KeyError, IndexError, TypeError, AttributeError):
        pass

    # Try data.output_text format
    try:
        output_text = data.get("output_text")
        if isinstance(output_text, str):
            text = output_text.strip()
            if text:
                return text
    except (TypeError, AttributeError):
        pass

    return None


# ============================================================
# GENERIC OPENAI-COMPATIBLE RESPONSE PARSER
# ============================================================

def _parse_openai_response(
    response,
    provider: str,
    model: str,
) -> str:
    """
    Parse a normal OpenAI-compatible chat completion response.
    """

    # --------------------------------------------------------
    # HTTP ERROR
    # --------------------------------------------------------

    if not response.ok:

        body = response.text[:2000]

        logger.error(
            "%s model=%s HTTP %s: %s",
            provider,
            model,
            response.status_code,
            body,
        )

        # Make model-unavailable errors much more useful.
        if "Model is unavailable" in body:
            return (
                f'AI provider "{provider}" model "{model}" '
                "is currently unavailable."
            )

        return (
            f'AI provider "{provider}" returned HTTP '
            f"{response.status_code}.\n"
            f"Details: {body}"
        )

    # --------------------------------------------------------
    # CONTENT TYPE
    # --------------------------------------------------------

    content_type = response.headers.get(
        "content-type",
        "",
    ).lower()

    if "json" not in content_type:

        logger.error(
            "%s returned non-JSON response (%s): %s",
            provider,
            content_type,
            response.text[:1000],
        )

        return (
            f'AI provider "{provider}" returned an '
            "unexpected non-JSON response."
        )

    # --------------------------------------------------------
    # JSON
    # --------------------------------------------------------

    try:
        data = response.json()

    except ValueError:

        logger.error(
            "AI provider %s returned malformed JSON: %s",
            provider,
            response.text[:2000],
        )

        return (
            f'AI provider "{provider}" returned malformed JSON.'
        )

    # --------------------------------------------------------
    # EXTRACT RESPONSE TEXT
    # --------------------------------------------------------

    # Log response structure safely (truncated, no API keys)
    logger.debug(
        "%s model=%s response structure: %s",
        provider,
        model,
        str(data)[:1000],  # Truncated for safety
    )

    text = _extract_response_text(data, provider)

    if text:
        logger.info(
            "%s successfully generated response using %s",
            provider,
            model,
        )
        return text

    # --------------------------------------------------------
    # NO USABLE TEXT FOUND
    # --------------------------------------------------------

    logger.error(
        "%s returned no usable text. Response structure: %s",
        provider,
        str(data)[:1500],
    )

    return (
        f'AI provider "{provider}" returned no final text. '
        f'Selected model "{model}" may have returned reasoning only '
        f"or unsupported response format."
    )


# ============================================================
# PUBLIC API
# ============================================================

def ask_ai(
    system_message: str = "",
    user_message: str = "",
    max_tokens: int = 600,
) -> str:
    """
    Main public function.

    ONLY FREE PROVIDERS ARE USED.

    Priority:

        1. OpenCode Zen FREE models
        2. OpenRouter FREE router

    If OPENCODE_ZEN_API_KEY exists, OpenCode is attempted first.

    If OpenCode is not configured, OpenRouter is used.

    NOTE:
        This function does NOT silently fall back to paid APIs.
    """

    # --------------------------------------------------------
    # Validate input
    # --------------------------------------------------------

    if not user_message or not user_message.strip():

        return (
            "AI Configuration Error: user_message is empty."
        )

    # --------------------------------------------------------
    # Get provider
    # --------------------------------------------------------

    try:
        provider, key = _load_key()

    except RuntimeError as exc:

        logger.error(str(exc))

        return (
            f"AI Configuration Error: {exc}"
        )

    # --------------------------------------------------------
    # Messages
    # --------------------------------------------------------

    messages = _build_messages(
        system_message=system_message,
        user_message=user_message,
    )

    # --------------------------------------------------------
    # OPENCode
    # --------------------------------------------------------

    if provider == "opencode":

        result = _ask_opencode(
            key=key,
            messages=messages,
            max_tokens=max_tokens,
        )

        # ----------------------------------------------------
        # Optional FREE fallback to OpenRouter
        # ----------------------------------------------------
        #
        # Only do this when explicitly configured with an
        # OpenRouter API key too.
        #
        # This is STILL FREE because OpenRouter uses
        # openrouter/free.
        # ----------------------------------------------------

        if result.startswith(
            'AI provider "opencode" could not complete'
        ):

            fallback_key = os.getenv(
                "OPENROUTER_API_KEY"
            )

            if fallback_key:

                logger.warning(
                    "OpenCode FREE models failed. "
                    "Falling back to OpenRouter FREE router."
                )

                return _ask_openrouter(
                    key=fallback_key.strip(),
                    messages=messages,
                    max_tokens=max_tokens,
                )

        return result

    # --------------------------------------------------------
    # OPENROUTER
    # --------------------------------------------------------

    if provider == "openrouter":

        return _ask_openrouter(
            key=key,
            messages=messages,
            max_tokens=max_tokens,
        )

    # --------------------------------------------------------
    # Should never happen
    # --------------------------------------------------------

    return (
        f"AI Configuration Error: unsupported provider "
        f"'{provider}'."
    )


# ============================================================
# OPTIONAL DEBUG TEST
# ============================================================
#
# Run:
#
#   python your_file.py
#
# only if you want a direct command-line test.
#
# ============================================================

if __name__ == "__main__":

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    result = ask_ai(
        system_message=(
            "You are a helpful financial assistant. "
            "Use only the information provided by the application. "
            "Do not invent financial facts."
        ),
        user_message=(
            "Say hello and confirm that the free AI API is working."
        ),
        max_tokens=100,
    )

    print("\n========== AI RESPONSE ==========\n")
    print(result)
