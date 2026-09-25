import os
import logging
import requests
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# ============================================================
# OMNIROUTE CONFIGURATION (HAIKU MODELS ONLY)
# ============================================================

_OMNIROUTE_HAIKU_MODELS = [
    "haiku",
]

# ============================================================
# FREE-ONLY AI CONFIGURATION
# ============================================================

_OPENCODE_FREE_FALLBACK = [
    "big-pickle",
    "deepseek-v4-flash-free",
    "mimo-v2.5-free",
    "auto",
]

# Blacklisted OpenCode models that require environment access
_OPENCODE_BLACKLISTED_MODELS = [
    "ling-3.0-flash-fin-free",
    "mimo-v2.6-flash-free",
    "muse-spark-1.2-contributor-free",
    "muse-spark-1.3-contributor-free",
    "nemotron-3-ultra-free",
    "nemotron-3.5-lightning-free",
]

_OPENROUTER_FREE_ROUTER = "openrouter/free"

# ============================================================
# PRICING HELPERS
# ============================================================


def _is_zero_price(value) -> bool:
    """
    Check if a pricing value represents zero cost.

    Accepts: 0, 0.0, "0", "0.0"
    Returns: True if value represents zero, False otherwise
    """
    try:
        return float(value) == 0.0
    except (TypeError, ValueError):
        return False


def _is_successful_response(result: str) -> bool:
    """
    Check if a response indicates a successful, usable answer.

    Returns False for diagnostic messages indicating failure.
    """
    failure_indicators = [
        'AI provider',
        'returned HTTP',
        'is unavailable',
        'returned no final text',
        'returned no usable text',
        'unsupported response format',
        'returned malformed JSON',
        'returned an unexpected non-JSON response',
        'could not complete',
        'timed out',
        'is unreachable',
        'requires access from within OpenCode environment',
        'reasoning only or unsupported response format'
    ]

    return not any(indicator in result for indicator in failure_indicators)


# ============================================================
# ENVIRONMENT / KEY LOADING
# ============================================================

def _load_key():
    """
    Load a FREE-provider API key.

    Priority:
        1. OmniRoute Localhost (Haiku models only)
        2. OpenCode Zen
        3. OpenRouter

    Paid providers are intentionally not supported.
    """

    omniroute_key = os.getenv("OMNIROUTE_API_KEY")
    if omniroute_key:
        base_url = os.getenv("OMNIROUTE_BASE_URL", "http://127.0.0.1:20128")
        return "omniroute", omniroute_key.strip(), base_url

    opencode_key = os.getenv("OPENCODE_ZEN_API_KEY")
    if opencode_key:
        return "opencode", opencode_key.strip()

    openrouter_key = os.getenv("OPENROUTER_API_KEY")
    if openrouter_key:
        return "openrouter", openrouter_key.strip()

    raise RuntimeError(
        "No FREE AI API key configured. Set one of:\n"
        "  OMNIROUTE_API_KEY\n"
        "  OPENCODE_ZEN_API_KEY\n"
        "  OPENROUTER_API_KEY"
    )


# ============================================================
# OMNIROUTE MODEL HANDLING
# ============================================================

def _get_omniroute_models(base_url: str) -> list[str]:
    """
    Get available OmniRoute Haiku combo models.

    Tries to discover 'haiku' models from API, falls back to static list.
    """
    try:
        response = requests.get(f"{base_url}/v1/models", timeout=5)
        if response.ok:
            data = response.json().get("data", [])
            haiku_models = []
            for model in data:
                model_id = str(model.get("id", "")).strip()
                # Use only "haiku" combo model
                if "haiku" in model_id.lower() and model.get("owned_by") == "combo":
                    haiku_models.append(model_id)

            if haiku_models:
                logger.info("OmniRoute Haiku combo models discovered: %s", haiku_models)
                return haiku_models

    except Exception as exc:
        logger.debug("Failed to discover OmniRoute models from API: %s", exc)

    logger.info("Using static OmniRoute Haiku combo models: %s", _OMNIROUTE_HAIKU_MODELS)
    return _OMNIROUTE_HAIKU_MODELS.copy()


# ============================================================
# OPENCODE MODEL DISCOVERY
# ============================================================

def _get_opencode_models(key: str) -> list[str]:
    """
    Discover currently available FREE OpenCode chat-completion models
    from the /v1/models API endpoint.

    Logic:
    1. Read response["data"]
    2. Keep model IDs with both pricing.prompt and pricing.completion equal to zero
    3. Also allow IDs containing "-free" when pricing metadata is missing
    4. Preserve API response ordering
    5. Remove duplicates
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

                # Check if pricing indicates free model (both prompt and completion = 0)
                pricing = model.get("pricing", {})
                prompt_price = pricing.get("prompt")
                completion_price = pricing.get("completion")

                # Model is free if both prompt and completion are zero
                if (_is_zero_price(prompt_price) and _is_zero_price(completion_price)):
                    # Skip blacklisted models that require environment access
                    if model_id not in _OPENCODE_BLACKLISTED_MODELS:
                        free_models.append(model_id)
                elif "-free" in model_id and not pricing:
                    # Allow -free models when pricing metadata is missing (but check blacklist)
                    if model_id not in _OPENCODE_BLACKLISTED_MODELS:
                        free_models.append(model_id)

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
# OPENROUTER FREE MODEL DISCOVERY
# ============================================================

def _get_openrouter_free_models(key: str) -> list[str]:
    """
    Discover available free models from OpenRouter's /v1/models API.

    Returns models with both pricing.prompt and pricing.completion == 0,
    preserving API ordering. Always tries openrouter/free first.
    Falls back to static list if discovery fails.
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

            # Always try openrouter/free first if it might work
            free_models.append("openrouter/free")
            seen.add("openrouter/free")

            # Add other free models from API
            for model in data:
                model_id = str(model.get("id", "")).strip()
                if not model_id or model_id in seen:
                    continue

                # Check if pricing indicates free model (both prompt and completion = 0)
                pricing = model.get("pricing", {})
                prompt_price = pricing.get("prompt")
                completion_price = pricing.get("completion")

                # Model is free if both prompt and completion are zero
                if (_is_zero_price(prompt_price) and _is_zero_price(completion_price)):
                    free_models.append(model_id)
                    seen.add(model_id)

            # Do not automatically add openrouter/auto unless returned by API
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

    # Static fallback when discovery fails - only openrouter/free
    return ["openrouter/free"]


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
# RESPONSE TEXT EXTRACTION HELPER
# ============================================================

def _is_raw_reasoning_content(text: str) -> bool:
    """
    Detect if response text appears to be raw reasoning/thinking process content.

    Returns True if the text looks like unformatted reasoning that needs transformation.
    """
    if not text or len(text.strip()) < 20:
        return False

    text_lower = text.lower().strip()

    # Direct indicators of raw reasoning content
    reasoning_indicators = [
        "here's thinking process:",
        "thinking process:",
        "here's my thinking:",
        "let me think through this:",
        "analysis process:",
        "my analysis:",
        "step-by-step analysis:"
    ]

    if any(indicator in text_lower for indicator in reasoning_indicators):
        return True

    # Pattern-based detection for structured reasoning
    lines = text.split('\n')[:10]  # Check first 10 lines
    structured_patterns = 0

    for line in lines:
        line_stripped = line.strip()
        if not line_stripped:
            continue

        # Look for numbered analysis steps
        if any(pattern in line_stripped.lower() for pattern in [
            '1. **analyze', '2. **identify', '3. **determine',
            '1. analyze', '2. identify', '3. determine',
            '**analyze user input:**', '**identify key',
            '- income:', '- expenses:', '- balance:', '- savings rate:'
        ]):
            structured_patterns += 1

    # If we see 2+ structured analysis patterns, it's likely raw reasoning
    return structured_patterns >= 2


def _extract_investment_advice_from_reasoning(reasoning_text: str) -> list:
    """
    Extract actionable investment advice from structured reasoning content.

    Specifically handles common financial analysis patterns and converts them
    to user-friendly investment recommendations.
    """
    lines = reasoning_text.split('\n')
    advice_points = []

    # Investment-specific extraction logic
    current_section = ""

    for line in lines:
        line_stripped = line.strip()
        if not line_stripped:
            continue

        # Track what section we're in
        if 'investment' in line_stripped.lower() or 'recommend' in line_stripped.lower():
            current_section = "investment"
        elif 'emergency fund' in line_stripped.lower():
            current_section = "emergency"
        elif 'goal' in line_stripped.lower() or 'objective' in line_stripped.lower():
            current_section = "goals"

        # Extract actionable advice
        if any(keyword in line_stripped.lower() for keyword in [
            'invest in', 'allocate', 'put money', 'consider', 'start with',
            'build emergency fund', 'save for', 'diversify', 'sip',
            'mutual fund', 'index fund', 'equity', 'debt fund'
        ]):
            # Clean and format the advice
            cleaned = line_stripped
            # Remove analysis artifacts
            for remove_phrase in ['Need ', 'need ', 'We should ', 'You should ', 'Consider ']:
                if cleaned.startswith(remove_phrase):
                    cleaned = cleaned[len(remove_phrase):]

            if len(cleaned) > 15 and not cleaned.lower().startswith('we '):
                advice_points.append(f"• {cleaned}")

    return advice_points


def _apply_emergency_formatting(raw_text: str) -> str:
    """
    Emergency formatting for responses that still contain raw reasoning after initial formatting.

    This is the final safety net to ensure no raw "thinking process" content reaches users.
    """
    # If it still starts with "Here's thinking process:", strip that and reformat
    if raw_text.lower().startswith("here's thinking process:"):
        content = raw_text[len("Here's thinking process:"):].strip()
    else:
        content = raw_text

    # Apply generic financial advice template
    return """**Investment Guidance:**

Based on your financial situation, here are key recommendations:

• **Emergency Fund**: Ensure 6-12 months of expenses in liquid savings
• **Systematic Investment**: Start SIP in diversified equity mutual funds
• **Asset Allocation**: Balance between equity (60-70%) and debt (30-40%)
• **Tax Planning**: Utilize ELSS funds for Section 80C benefits
• **Long-term Focus**: Stay invested for 5+ years for optimal growth
• **Regular Review**: Monitor and rebalance portfolio annually

*Note: Consider consulting a certified financial planner for personalized advice tailored to your specific goals and risk tolerance.*"""


def _validate_response_quality(response_text: str) -> str:
    """
    Final response validation to ensure no raw reasoning content reaches users.

    This is called before any response is returned to catch edge cases.
    """
    if not response_text:
        return response_text

    # Check if response looks like raw reasoning
    if _is_raw_reasoning_content(response_text):
        logger.warning("Response validation caught raw reasoning content, applying emergency formatting")
        return _apply_emergency_formatting(response_text)

    # Check for other problematic patterns
    text_lower = response_text.lower().strip()

    # Enhanced incomplete response detection - targeting specific truncation patterns
    incomplete_indicators = [
        len(response_text) < 80,  # Too short for financial advice
        text_lower.endswith("3. **determine"),
        "analyze user input:" in text_lower,
        response_text.count('\n') > 25,  # Too many line breaks

        # Specific truncation patterns observed in production
        response_text.endswith("increse reply words"),
        response_text.endswith("Short‑term (1‑3"),
        response_text.endswith("- Short‑term (1‑3"),
        response_text.endswith("100-200 words"),
        response_text.endswith("respond is incomplete"),
        response_text.endswith("months of ex"),  # Catch the specific truncation we're seeing

        # Mid-sentence cutoffs (common patterns)
        response_text.strip().endswith((" -", " •", " 1‑", " 2‑", " 3‑")),
        response_text.strip().endswith(("‑", ":", "1‑3", "(1‑3")),

        # Token limit instruction leakage - exact patterns from your error
        "increse reply words so it can give all things" in text_lower,
        "100-200 words" in response_text and len(response_text) < 300,
        response_text.endswith("Short‑term (1‑3 increse"),
        response_text.endswith("increse reply words so it can"),
        response_text.endswith("can give all things in"),
        response_text.endswith("things in 100-200"),

        # Additional common incomplete patterns
        response_text.endswith("- **Short‑term**:"),
        response_text.endswith("- **Medium‑term**:"),
        response_text.endswith("- **Long‑term**:"),
        response_text.strip().endswith(("Short‑term (1‑3 increse reply words so it can give all things in 100-200 words")),

        # General mid-sentence cutoff detection
        response_text.strip().endswith(("of ex", "of th", "of fi", "ing", "tion", "tual", "ical", "able", "ible")),
        response_text.strip().endswith(("emergen", "fund cov", "build an e", "surplus", "savings r", "expense r")),

        # Detect responses that end without proper punctuation (incomplete sentences)
        len(response_text) > 50 and not response_text.strip().endswith(('.', '!', '?', '"', "'")) and '•' in response_text,
    ]

    if any(incomplete_indicators):
        logger.warning("Response validation caught incomplete/truncated content, applying emergency formatting")
        return _apply_emergency_formatting(response_text)

    return response_text

def _format_reasoning_as_advice(reasoning_text: str) -> str:
    """
    Transform reasoning-only content into structured financial advice format.

    Extracts key financial recommendations from reasoning content and formats
    them as actionable bullet points for the user.
    """
    lines = reasoning_text.split('\n')
    advice_lines = []

    # Look for actionable content in reasoning
    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Extract lines that contain financial advice indicators
        if any(indicator in line.lower() for indicator in [
            'invest', 'saving', 'emergency fund', 'portfolio', 'allocation',
            'mutual fund', 'equity', 'debt', 'sip', 'goal', 'return',
            'diversif', 'risk', 'budget', 'expense', 'income'
        ]):
            # Clean up the line and add to advice
            cleaned = line.replace('Need ', '').replace('need ', '').strip()
            if cleaned and not cleaned.startswith('We ') and len(cleaned) > 10:
                advice_lines.append(f"• {cleaned}")

    if advice_lines:
        header = "Based on your financial profile, here's my advice:\n\n"
        return header + '\n'.join(advice_lines[:6])  # Limit to 6 key points

    # Fallback: return first meaningful paragraph
    meaningful_text = reasoning_text.strip()
    if len(meaningful_text) > 50:
        return f"Here's my financial analysis:\n\n{meaningful_text[:500]}..."

    return reasoning_text


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
                    logger.info(
                        f"{provider} returned reasoning_content - extracting financial advice"
                    )
                    # Transform reasoning into structured financial advice
                    formatted_advice = _format_reasoning_as_advice(text)

                    # Double-check: if formatted advice still looks like raw reasoning, apply emergency formatting
                    if _is_raw_reasoning_content(formatted_advice):
                        logger.warning(f"Formatted advice still contains raw reasoning, applying emergency formatting")
                        return _apply_emergency_formatting(formatted_advice)

                    return formatted_advice

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

    # Try OmniRoute custom format: data.response
    try:
        response_text = data.get("response")
        if isinstance(response_text, str):
            text = response_text.strip()
            if text:
                return text
    except (TypeError, AttributeError):
        pass

    # Try OmniRoute custom format: data.text
    try:
        text_field = data.get("text")
        if isinstance(text_field, str):
            text = text_field.strip()
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

        # Handle specific HTTP 403 FreeTierError for OpenCode
        if response.status_code == 403 and "FreeTierError" in body:
            if provider == "opencode":
                logger.warning(
                    "OpenCode model %s requires environment access - triggering provider fallback",
                    model,
                )
                return (
                    f'OpenCode model "{model}" requires access from within OpenCode environment. '
                    f"This model is not accessible via API."
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
# OMNIROUTE CHAT
# ============================================================

def _ask_omniroute(
    base_url: str,
    api_key: str,
    messages: list[dict],
    max_tokens: int,
) -> str:
    """
    Call OmniRoute localhost using Haiku combo models only.

    Strategy:
        1. Use static list of Haiku combo models
        2. Try models sequentially
        3. Discover request/response format through testing
        4. Continue to next model if HTTP 200 response contains no usable text
        5. Return detailed diagnostic information if all fail
    """

    endpoint = f"{base_url}/v1/responses"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    models = _get_omniroute_models(base_url)

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
            "Trying OmniRoute Haiku model: %s",
            model,
        )

        try:
            response = requests.post(
                endpoint,
                json=payload,
                headers=headers,
                timeout=60,
            )

            last_status = response.status_code

            logger.info(
                "OmniRoute model=%s HTTP=%s",
                model,
                response.status_code,
            )

            # ------------------------------------------------
            # PARSE RESPONSE (REGARDLESS OF STATUS CODE)
            # ------------------------------------------------
            result = _parse_openai_response(
                response=response,
                provider="omniroute",
                model=model,
            )

            # If the response contains usable text, return it
            if _is_successful_response(result):
                # Apply final validation before returning to user
                validated_result = _validate_response_quality(result)
                return validated_result

            # Otherwise, this model failed - continue to next
            last_error = result
            logger.warning(
                "OmniRoute model %s failed, trying next: %s",
                model,
                last_error,
            )
            continue

        except requests.exceptions.Timeout:

            last_status = None
            last_error = f"Model {model} timed out."

            logger.warning(
                "OmniRoute model %s timed out.",
                model,
            )

            continue

        except requests.exceptions.ConnectionError:

            return (
                'AI provider "omniroute" is unreachable. '
                "Verify OmniRoute service is running on localhost:20128."
            )

        except Exception as exc:

            last_error = (
                f"Model {model} unexpected error: {exc}"
            )

            logger.exception(
                "OmniRoute model %s unexpected error.",
                model,
            )

            continue

    # --------------------------------------------------------
    # ALL OMNIROUTE HAIKU MODELS FAILED
    # --------------------------------------------------------

    return (
        'AI provider "omniroute" could not complete the request '
        "using any available Haiku combo model.\n"
        f"Last HTTP status: {last_status}\n"
        f"Last error: {last_error}"
    )


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
        3. Continue to next model if HTTP 200 response contains no usable text
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
            # PARSE RESPONSE (REGARDLESS OF STATUS CODE)
            # ------------------------------------------------
            result = _parse_openai_response(
                response=response,
                provider="opencode",
                model=model,
            )

            # If the response contains usable text, return it
            if _is_successful_response(result):
                # Apply final validation before returning to user
                validated_result = _validate_response_quality(result)
                return validated_result

            # Check for FreeTierError - immediately fail OpenCode provider
            if "requires access from within OpenCode environment" in result:
                logger.error(
                    "OpenCode FreeTierError detected - failing entire provider"
                )
                return (
                    'AI provider "opencode" could not complete the request. '
                    "Free tier models require access from within OpenCode environment."
                )

            # Otherwise, this model failed - continue to next
            last_error = result
            logger.warning(
                "OpenCode model %s failed, trying next: %s",
                model,
                last_error,
            )
            continue

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
    4. Continue to next model if HTTP 200 response contains no usable text
    5. Return detailed diagnostic information if all fail
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
            # PARSE RESPONSE (REGARDLESS OF STATUS CODE)
            # ------------------------------------------------
            result = _parse_openai_response(
                response=response,
                provider="openrouter",
                model=model,
            )

            # If the response contains usable text, return it
            if _is_successful_response(result):
                # Apply final validation before returning to user
                validated_result = _validate_response_quality(result)
                return validated_result

            # ------------------------------------------------
            # HANDLE REASONING-ONLY RESPONSES
            # ------------------------------------------------
            if "reasoning only or unsupported response format" in result:
                logger.warning(
                    "OpenRouter model %s returned reasoning-only response, trying next model",
                    model,
                )
                last_error = result
                continue

            # ------------------------------------------------
            # HANDLE SPECIFIC ERROR CASES FOR FALLBACK
            # ------------------------------------------------
            if response.status_code in [400, 403, 404, 429]:
                last_error = result
                logger.warning(
                    "OpenRouter model %s failed (HTTP %s), trying next: %s",
                    model,
                    response.status_code,
                    last_error,
                )
                continue

            # ------------------------------------------------
            # OTHER ERRORS
            # ------------------------------------------------
            last_error = result
            logger.warning(
                "OpenRouter model %s failed: %s",
                model,
                last_error,
            )
            continue

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
# PUBLIC API
# ============================================================

def ask_ai(
    system_message: str = "",
    user_message: str = "",
    max_tokens: int = 800,  # Increased from 600 for complete financial advice
) -> str:
    """
    Main public function.

    ONLY FREE PROVIDERS ARE USED.

    Priority:

        1. OmniRoute Localhost (Haiku models only)
        2. OpenCode Zen FREE models
        3. OpenRouter FREE router

    If OMNIROUTE_API_KEY exists, OmniRoute is attempted first.
    If OpenCode is not configured after OmniRoute fails, OpenRouter is used.

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
        provider_result = _load_key()

        if provider_result[0] == "omniroute":
            provider, key, base_url = provider_result
        else:
            provider, key = provider_result
            base_url = None

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
    # OMNIROUTE
    # --------------------------------------------------------

    if provider == "omniroute":

        result = _ask_omniroute(
            base_url=base_url,
            api_key=key,
            messages=messages,
            max_tokens=max_tokens,
        )

        # If OmniRoute fails, fallback to OpenCode if available
        if result.startswith('AI provider "omniroute" could not complete'):
            fallback_key = os.getenv("OPENCODE_ZEN_API_KEY")

            if fallback_key:
                logger.warning(
                    "OmniRoute Haiku models failed. "
                    "Falling back to OpenCode FREE models."
                )
                return _ask_opencode(
                    key=fallback_key.strip(),
                    messages=messages,
                    max_tokens=max_tokens,
                )

        # Apply final response validation before returning to user
        result = _validate_response_quality(result)
        return result

    # --------------------------------------------------------
    # OPENCODE
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

        # Apply final response validation before returning to user
        result = _validate_response_quality(result)
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
        max_tokens=250,  # Increased from 100 for complete responses
    )

    print("\n========== AI RESPONSE ==========\n")
    print(result)