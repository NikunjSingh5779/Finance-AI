import os
import requests
from dotenv import load_dotenv

load_dotenv()


def _load_key():
    if os.getenv("OPENCODE_API_KEY"):
        return "opencode", os.getenv("OPENCODE_API_KEY")
    if os.getenv("CLAUDE_API_KEY"):
        return "claude", os.getenv("CLAUDE_API_KEY")
    if os.getenv("OPENAI_API_KEY"):
        return "openai", os.getenv("OPENAI_API_KEY")
    if os.getenv("OPENROUTER_API_KEY"):
        return "openrouter", os.getenv("OPENROUTER_API_KEY")
    raise RuntimeError(
        "No LLM API key configured. Please set at least one API key "
        "(OPENROUTER_API_KEY, OPENCODE_API_KEY, OPENAI_API_KEY, or CLAUDE_API_KEY) "
        "in your .env file."
    )


def ask_ai(system_message: str = "", user_message: str = "", max_tokens: int = 150) -> str:
    try:
        provider, key = _load_key()
    except RuntimeError as e:
        return f"AI Configuration Error: {str(e)}"

    messages = []
    if system_message:
        messages.append({"role": "system", "content": system_message})
    messages.append({"role": "user", "content": user_message})

    if provider == "opencode":
        url = "https://api.opencode.ai/v1/chat/completions"
        payload = {
            "model": "deepseek-v4-flash-free",
            "max_tokens": max_tokens,
            "temperature": 0.6,
            "messages": messages
        }
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json"
        }

    elif provider == "claude":
        url = "https://api.anthropic.com/v1/messages"
        payload = {
            "model": "claude-3-5-sonnet-20240620",
            "max_tokens": max_tokens,
            "temperature": 0.6,
            "messages": [{"role": "user", "content": user_message}]
        }
        headers = {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
        }

    elif provider == "openai":
        url = "https://api.openai.com/v1/chat/completions"
        payload = {
            "model": "gpt-4o-mini",
            "max_tokens": max_tokens,
            "temperature": 0.6,
            "messages": messages
        }
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json"
        }

    elif provider == "openrouter":
        url = "https://openrouter.ai/api/v1/chat/completions"
        payload = {
            "model": "deepseek/deepseek-v4-flash",
            "max_tokens": max_tokens,
            "temperature": 0.6,
            "messages": messages
        }
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://finance-ai.app",
            "X-Title": "Finance AI"
        }

    else:
        return f"AI Configuration Error: Unsupported provider '{provider}'"

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        # If OpenRouter returns 402 (no credits), fall back to free model
        if response.status_code == 402 and provider == "openrouter":
            fallback = {
                "model": "openrouter/auto",
                "max_tokens": max_tokens,
                "temperature": 0.6,
                "messages": messages
            }
            response = requests.post(url, json=fallback, headers=headers, timeout=30)
        if not response.ok:
            return f"AI Error ({provider}): HTTP {response.status_code} - {response.text[:300].strip()}"
        try:
            data = response.json()
        except ValueError:
            return f"AI Error ({provider}): non-JSON response - {response.text[:200].strip()}"
        if provider == "claude":
            return data["content"][0]["text"]
        else:
            return data["choices"][0]["message"]["content"]
    except requests.exceptions.Timeout:
        return f"AI Error ({provider}): Request timed out after 30s. Please try again later."
    except requests.exceptions.ConnectionError:
        return f"AI Error ({provider}): Failed to connect to {provider} service. Check your internet connection."
    except Exception as e:
        return f"AI Error ({provider}): {str(e)}"
