"""Market Predictor Module — ML-powered price forecasting using Kronos.

Provides price prediction for financial instruments using the Kronos
foundation model (NeoQuasar/Kronos-small) as the primary engine, with
automatic fallback to linear regression and trend-based methods.

The Kronos model is optional — if torch/huggingface dependencies are not
installed, prediction gracefully degrades to statistical methods.

Pattern adapted from ARES agents/kronos_predictor.py and the Kronos
model (NeoQuasar/Kronos-small), the first open-source foundation model
for financial candlesticks trained on 45+ global exchanges.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

KRONOS_MODEL_ID = "NeoQuasar/Kronos-small"
KRONOS_TOKENIZER_ID = "NeoQuasar/Kronos-Tokenizer-base"
MAX_CONTEXT = 512
DEFAULT_LOOKBACK = 400
DEFAULT_PRED_LEN = 24


# ---------------------------------------------------------------------------
# Kronos Model Wrapper (lazy-loaded singleton)
# ---------------------------------------------------------------------------

class _KronosModel:
    """Lazy singleton wrapper around the Kronos model.

    Loads the model on first call, not at import time. This keeps the
    module importable even when torch/Kronos is not installed.
    """

    _instance: _KronosModel | None = None
    _loaded: bool = False
    _model: Any = None
    _tokenizer: Any = None
    _predictor: Any = None
    _load_error: str | None = None

    def __new__(cls) -> _KronosModel:
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    @property
    def available(self) -> bool:
        return self._loaded

    @property
    def load_error(self) -> str | None:
        return self._load_error

    def load(self) -> bool:
        """Load model from HuggingFace. Returns True on success."""
        if self._loaded:
            return True

        try:
            import torch
            import os
            import sys

            # Try multiple locations for the Kronos model module
            kronos_paths = [
                os.path.join(os.path.dirname(__file__), "kronos_model"),
                os.path.join(os.path.dirname(__file__), "..", "Kronos", "model"),
                os.path.join(
                    os.path.dirname(__file__),
                    "..", "..", "OneDrive", "Desktop", "Kronos", "model"
                ),
            ]
            for kp in kronos_paths:
                kp = os.path.abspath(kp)
                if os.path.isdir(kp) and kp not in sys.path:
                    sys.path.insert(0, kp)

            # Try pip-installed first, then local module
            try:
                from kronos.model import Kronos, KronosTokenizer, KronosPredictor  # type: ignore[import-untyped]
            except ImportError:
                from model import Kronos, KronosTokenizer, KronosPredictor  # type: ignore[import-untyped]

            device = "cuda" if torch.cuda.is_available() else "cpu"
            logger.info(f"Loading Kronos model {KRONOS_MODEL_ID} on {device}")

            self._tokenizer = KronosTokenizer.from_pretrained(KRONOS_TOKENIZER_ID)
            self._model = Kronos.from_pretrained(KRONOS_MODEL_ID)
            self._model.to(device)
            self._model.eval()

            self._predictor = KronosPredictor(
                self._model, self._tokenizer, max_context=MAX_CONTEXT
            )

            self._loaded = True
            logger.info("Kronos model loaded successfully")
            return True

        except ImportError as e:
            self._load_error = (
                f"Kronos dependencies not installed: {e}. "
                "Install with: pip install torch huggingface_hub safetensors einops"
            )
            logger.warning(self._load_error)
            return False

        except Exception as e:
            self._load_error = f"Failed to load Kronos model: {e}"
            logger.error(self._load_error, exc_info=True)
            return False


# ---------------------------------------------------------------------------
# Prediction functions
# ---------------------------------------------------------------------------

def _prepare_dataframe(records: list[dict[str, Any]]) -> Any:
    """Convert OHLCV records to the pandas DataFrame Kronos expects."""
    try:
        import pandas as pd
    except ImportError:
        raise ImportError("pandas is required for Kronos predictor")

    data = []
    for r in records:
        data.append({
            "open": float(r.get("open", 0)),
            "high": float(r.get("high", 0)),
            "low": float(r.get("low", 0)),
            "close": float(r.get("close", 0)),
            "volume": float(r.get("volume", 0)),
        })

    df = pd.DataFrame(data)
    for col in ["open", "high", "low", "close", "volume"]:
        if col not in df.columns:
            df[col] = 0.0

    return df


def _make_timestamps(
    records: list[dict[str, Any]],
    pred_len: int,
) -> tuple[Any, Any]:
    """Create x_timestamp and y_timestamp for Kronos."""
    try:
        import pandas as pd
    except ImportError:
        raise ImportError("pandas is required for Kronos predictor")

    # Parse dates or use sequential indices
    dates = []
    for r in records:
        date_val = r.get("date", r.get("timestamp", ""))
        if isinstance(date_val, str) and date_val:
            try:
                dates.append(pd.Timestamp(date_val))
            except (ValueError, TypeError):
                dates.append(pd.Timestamp(datetime.now(timezone.utc)))
        else:
            dates.append(pd.Timestamp(datetime.now(timezone.utc)))

    x_ts = pd.Series(dates, name="timestamps")

    # Estimate interval
    if len(dates) >= 2:
        delta = dates[-1] - dates[-2]
        if delta.total_seconds() <= 0:
            delta = pd.Timedelta(hours=1)
    else:
        delta = pd.Timedelta(hours=1)

    future_dates = [dates[-1] + delta * (i + 1) for i in range(pred_len)]
    y_ts = pd.Series(future_dates, name="timestamps")

    return x_ts, y_ts


def _analysis_from_prediction(
    symbol: str,
    records: list[dict[str, Any]],
    pred_closes: list[float],
    model_used: str,
) -> dict[str, Any]:
    """Convert predicted values into a structured analysis result."""
    if not pred_closes:
        return _empty_result("No predictions generated")

    actual_closes = [r["close"] for r in records[-20:]] if len(records) >= 20 else [r["close"] for r in records]
    current_price = actual_closes[-1] if actual_closes else pred_closes[0]
    predicted_final = pred_closes[-1]
    predicted_change_pct = ((predicted_final - current_price) / current_price) * 100 if current_price > 0 else 0

    # Trend direction
    if len(pred_closes) >= 3:
        mid = len(pred_closes) // 2
        first_half_avg = sum(pred_closes[:mid]) / mid
        second_half_avg = sum(pred_closes[mid:]) / (len(pred_closes) - mid)
        trend = "bullish" if second_half_avg > first_half_avg else "bearish"
    else:
        trend = "bullish" if predicted_change_pct > 0 else "bearish"

    # Direction and confidence
    abs_change = abs(predicted_change_pct)
    if abs_change < 0.5:
        direction = "flat"
        confidence = max(20, abs_change * 20)
    elif predicted_change_pct > 0:
        direction = "long"
        confidence = min(30 + abs_change * 3, 85)
    else:
        direction = "short"
        confidence = min(30 + abs_change * 3, 85)

    pred_range = (max(pred_closes) - min(pred_closes)) / current_price * 100 if current_price > 0 else 0

    return {
        "symbol": symbol.upper(),
        "confidence": round(float(confidence), 1),
        "direction": direction,
        "trend": trend,
        "predicted_prices": [round(float(p), 4) for p in pred_closes],
        "predicted_change_pct": round(float(predicted_change_pct), 2),
        "predicted_range_pct": round(float(pred_range), 2),
        "current_price": round(float(current_price), 4),
        "model_used": model_used,
        "prediction_date": datetime.now(timezone.utc).isoformat(),
        "rationale": (
            f"Model predicts {direction} direction over {len(pred_closes)} periods "
            f"({predicted_change_pct:+.2f}% change). "
            f"Trend: {trend}. Range: {pred_range:.2f}%."
        ),
    }


def _empty_result(reason: str) -> dict[str, Any]:
    return {
        "symbol": "",
        "confidence": 0.0,
        "direction": "flat",
        "trend": "neutral",
        "predicted_prices": [],
        "predicted_change_pct": 0.0,
        "predicted_range_pct": 0.0,
        "current_price": 0.0,
        "model_used": "none",
        "prediction_date": datetime.now(timezone.utc).isoformat(),
        "rationale": reason,
    }


# ---------------------------------------------------------------------------
# Public prediction API
# ---------------------------------------------------------------------------

async def predict_with_kronos(
    symbol: str,
    records: list[dict[str, Any]],
    pred_len: int = DEFAULT_PRED_LEN,
) -> dict[str, Any] | None:
    """Run Kronos ML model prediction on OHLCV data.

    Args:
        symbol: Ticker symbol.
        records: List of OHLCV dicts (must have open, high, low, close keys).
        pred_len: Number of candles to predict forward.

    Returns:
        Analysis dict with prediction results, or None if model unavailable.
    """
    if len(records) < 50:
        logger.warning(f"Insufficient data for Kronos ({len(records)} records, need 50+)")
        return None

    model_wrapper = _KronosModel()
    if not model_wrapper.load():
        return None

    try:
        df = _prepare_dataframe(records)
        x_ts, y_ts = _make_timestamps(records, pred_len)

        pred_df = model_wrapper._predictor.predict(
            df=df,
            x_timestamp=x_ts,
            y_timestamp=y_ts,
            pred_len=pred_len,
            T=1.0,
            top_p=0.9,
            sample_count=1,
        )

        pred_closes = pred_df["close"].values.tolist()
        return _analysis_from_prediction(symbol, records, pred_closes, KRONOS_MODEL_ID)

    except Exception as e:
        logger.error(f"Kronos prediction runtime error: {e}", exc_info=True)
        return None


def predict_trend_fallback(
    symbol: str,
    records: list[dict[str, Any]],
    pred_len: int = 24,
) -> dict[str, Any]:
    """Simple trend-based fallback when Kronos model is unavailable.

    Uses linear regression on recent close prices to estimate direction.
    """
    if len(records) < 20:
        return _empty_result(f"Insufficient data ({len(records)} records, need 20+)")

    closes = [r["close"] for r in records]
    recent = closes[-20:]
    x = list(range(len(recent)))

    # Linear regression (simple polyfit)
    n = len(recent)
    sum_x = sum(x)
    sum_y = sum(recent)
    sum_xy = sum(x[i] * recent[i] for i in range(n))
    sum_x2 = sum(x[i] ** 2 for i in range(n))

    try:
        slope = (n * sum_xy - sum_x * sum_y) / (n * sum_x2 - sum_x * sum_x)
    except ZeroDivisionError:
        slope = 0

    # Generate predicted prices by extending the slope
    predicted_closes = [float(closes[-1] + slope * i) for i in range(1, pred_len + 1)]

    return _analysis_from_prediction(symbol, records, predicted_closes, "linear_regression_fallback")


async def predict_prices(
    symbol: str,
    records: list[dict[str, Any]],
    pred_len: int = 24,
) -> dict[str, Any]:
    """Full prediction pipeline: try Kronos, fall back to trend analysis.

    This is the main entry point for price prediction. It first attempts
    the Kronos ML model (if available) and gracefully falls back to
    linear regression trend analysis.

    Args:
        symbol: Ticker symbol (e.g., "AAPL").
        records: List of OHLCV records with open/high/low/close/volume.
        pred_len: Number of periods to predict forward.

    Returns:
        Analysis dict with prediction results.
    """
    if not records or len(records) < 2:
        return _empty_result("No historical data provided")

    if len(records) < 20:
        return _empty_result(f"Insufficient data ({len(records)} records, need 20+)")

    # Step 1: Try Kronos ML model
    result = await predict_with_kronos(symbol, records, pred_len)
    if result is not None:
        return result

    # Step 2: Fallback to trend analysis
    return predict_trend_fallback(symbol, records, pred_len)
