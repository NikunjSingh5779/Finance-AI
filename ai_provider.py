import os
import logging
import requests
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# Free models known to work on OpenRouter as of 2025-09. Updated automatically
# via _get_openrouter_models() at runtime; this list is the static fallback.
_OPENROUTER_FREE_FALLBACK = [
    "deepseek/deepseek-v4.1-flash",      # auto-routing picks this; doesn't need :free
    "qwen/qwen3.8-27b:free",
    "mistralai/mistral-7b-instruct:free",
    "openrouter/auto",                    # last-resort: auto-selects cheapest available
]

# Free models known to work on OpenCode Zen. Updated automatically via _get_opencode_models()
_OPENCODE_FREE_FALLBACK = [
    "big-pickle",
    "deepseek-v4-flash-free",
    "mimo-v2.5-free",
    "auto",                               # last-resort: auto-selects available model
]


def _load_key():
    if os.getenv("OPENCODE_ZEN_API_KEY"):
        return "opencode", os.getenv("OPENCODE_ZEN_API_KEY")
    if os.getenv("OPENROUTER_API_KEY"):
        return "openrouter", os.getenv("OPENROUTER_API_KEY")
    if os.getenv("CLAUDE_API_KEY"):
        return "claude", os.getenv("CLAUDE_API_KEY")
    if os.getenv("OPENAI_API_KEY"):
        return "openai", os.getenv("OPENAI_API_KEY")
    raise RuntimeError(
        "No LLM API key configured. Please set at least one API key "
        "(OPENCODE_ZEN_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY, or CLAUDE_API_KEY) "
        "in your .env file."
    )


def _get_opencode_models(key: str) -> list[str]:
    """Fetch current free model IDs from OpenCode Zen. Falls back to static list on error."""
    try:
        r = requests.get(
            "https://opencode.ai/zen/v1/models",
            headers={"Authorization": f"Bearer {key}"},
            timeout=8,
        )
        if r.ok:
            data = r.json().get("data", [])
            # OpenCode free models may be identified by pricing or naming patterns
            free = []
            for m in data:
                model_id = m.get("id", "")
                pricing = m.get("pricing", {})
                # Check if it's free (price = 0) or has "free" in the name
                prompt_price = str(pricing.get("prompt", "1"))
                if prompt_price == "0" or "free" in model_id.lower():
                    free.append(model_id)
            if free:
                return free[:8] + ["auto"]
    except Exception as exc:
        logger.debug("OpenCode model fetch failed: %s", exc)
    return _OPENCODE_FREE_FALLBACK


def _get_openrouter_models(key: str) -> list[str]:
    """Fetch current free model IDs from OpenRouter. Falls back to static list on error."""
    try:
        r = requests.get(
            "https://openrouter.ai/api/v1/models",
            headers={"Authorization": f"Bearer {key}"},
            timeout=8,
        )
        if r.ok:
            data = r.json().get("data", [])
            free = [m["id"] for m in data if str(m.get("pricing", {}).get("prompt", "1")) == "0"]
            if free:
                return free[:8] + ["openrouter/auto"]
    except Exception as exc:
        logger.debug("OpenRouter model fetch failed: %s", exc)
    return _OPENROUTER_FREE_FALLBACK


def ask_ai(system_message: str = "", user_message: str = "", max_tokens: int = 600) -> str:
    try:
        provider, key = _load_key()
    except RuntimeError as e:
        return f"AI Configuration Error: {str(e)}"

    messages = []
    if system_message:
        messages.append({"role": "system", "content": system_message})
    messages.append({"role": "user", "content": user_message})

    if provider == "opencode":
        url = "https://opencode.ai/zen/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://finance-ai.app",
            "X-Title": "Finance AI",
        }
        models = _get_opencode_models(key)
        response = None
        last_error = ""
        for model in models:
            payload = {
                "model": model,
                "max_tokens": max_tokens,
                "temperature": 0.6,
                "messages": messages,
            }
            try:
                response = requests.post(url, json=payload, headers=headers, timeout=30)
                if response.ok:
                    break
                last_error = response.text[:200]
            except requests.exceptions.Timeout:
                last_error = "timeout"
                continue
            except requests.exceptions.ConnectionError:
                return 'AI provider "opencode" is unreachable. Check your internet connection.'
        if response is None:
            return f'AI provider "opencode" failed for all models. Last error: {last_error}'

    elif provider == "claude":
        url = "https://api.anthropic.com/v1/messages"
        model = os.getenv("CLAUDE_MODEL", "claude-sonnet-5")
        payload = {
            "model": model,
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": user_message}],
        }
        if system_message:
            payload["system"] = system_message
        headers = {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        try:
            response = requests.post(url, json=payload, headers=headers, timeout=30)
        except requests.exceptions.Timeout:
            return 'AI provider "claude" timed out after 30s. Please try again.'
        except requests.exceptions.ConnectionError:
            return 'AI provider "claude" is unreachable. Check your internet connection.'

    elif provider == "openai":
        url = "https://api.openai.com/v1/chat/completions"
        payload = {
            "model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            "max_tokens": max_tokens,
            "temperature": 0.6,
            "messages": messages,
        }
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }
        try:
            response = requests.post(url, json=payload, headers=headers, timeout=30)
        except requests.exceptions.Timeout:
            return 'AI provider "openai" timed out after 30s. Please try again.'
        except requests.exceptions.ConnectionError:
            return 'AI provider "openai" is unreachable. Check your internet connection.'

    elif provider == "openrouter":
        url = "https://openrouter.ai/api/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://finance-ai.app",
            "X-Title": "Finance AI",
        }
        models = _get_openrouter_models(key)
        response = None
        last_error = ""
        for model in models:
            payload = {
                "model": model,
                "max_tokens": max_tokens,
                "temperature": 0.6,
                "messages": messages,
            }
            try:
                response = requests.post(url, json=payload, headers=headers, timeout=30)
                if response.ok:
                    break
                last_error = response.text[:200]
            except requests.exceptions.Timeout:
                last_error = "timeout"
                continue
            except requests.exceptions.ConnectionError:
                return 'AI provider "openrouter" is unreachable. Check your internet connection.'
        if response is None:
            return f'AI provider "openrouter" failed for all models. Last error: {last_error}'

    else:
        return f"AI Configuration Error: Unsupported provider '{provider}'"

    # Parse response
    if not response.ok:
        host = url.split("/")[2]
        status = response.status_code
        logger.error("AI %s HTTP %s: %s", provider, status, response.text[:500])
        return (
            f'AI provider "{provider}" returned HTTP {status} from {host}. '
            f"Check your API key and configuration."
        )

    content_type = response.headers.get("content-type", "")
    if "json" not in content_type:
        logger.error("AI %s non-JSON response (%s): %s", provider, content_type, response.text[:500])
        return (
            f'AI provider "{provider}" returned an unexpected response (not JSON). '
            f"Check server logs for details."
        )

    try:
        data = response.json()
    except ValueError:
        logger.error("AI %s JSON parse error: %s", provider, response.text[:500])
        return f'AI provider "{provider}" returned malformed JSON. Check server logs.'

    try:
        if provider == "claude":
            text = data["content"][0]["text"]
        else:
            text = data["choices"][0]["message"]["content"]
        if not text:
            return "AI returned an empty response. Please try again."
        return text
    except (KeyError, IndexError, TypeError) as exc:
        logger.error("AI %s unexpected response shape: %s — %s", provider, exc, str(data)[:300])
        return f'AI provider "{provider}" returned an unexpected response format. Check server logs.'