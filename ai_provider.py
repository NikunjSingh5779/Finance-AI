import os
import requests


def _load_key():
    # order of preference: CLAUDE > OPENAI > OPENROUTER
    if os.getenv("CLAUDE_API_KEY"):
        return "claude", os.getenv("CLAUDE_API_KEY")
    if os.getenv("OPENAI_API_KEY"):
        return "openai", os.getenv("OPENAI_API_KEY")
    if os.getenv("OPENROUTER_API_KEY"):
        return "openrouter", os.getenv("OPENROUTER_API_KEY")
    raise RuntimeError("No LLM API key found in environment variables")


def ask_ai(prompt: str, max_tokens: int = 150) -> str:
    provider, key = _load_key()

    if provider == "claude":
        # Claude endpoint (via anthropic.com)
        url = "https://api.anthropic.com/v1/messages"
        payload = {
            "model": "claude-3-5-sonnet-20240620",
            "max_tokens": max_tokens,
            "temperature": 0.6,
            "messages": [
                {"role": "user", "content": prompt}
            ]
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
            "messages": [{"role": "user", "content": prompt}]
        }
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json"
        }

    elif provider == "openrouter":
        url = "https://openrouter.ai/api/v1/chat/completions"
        payload = {
            "model": "google/gemini-pro",
            "max_tokens": max_tokens,
            "temperature": 0.6,
            "messages": [{"role": "user", "content": prompt}]
        }
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json"
        }

    else:
        raise RuntimeError(f"Unsupported provider: {provider}")

    try:
        response = requests.post(
            url, json=payload, headers=headers, timeout=30
        )
        response.raise_for_status()
        data = response.json()
        # Different APIs have slightly different shapes
        if provider == "claude":
            return data["content"][0]["text"]
        else:
            return data["choices"][0]["message"]["content"]
    except Exception as e:
        return f"AI Error ({provider}): {str(e)}"