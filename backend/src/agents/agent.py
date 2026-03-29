"""Backward-compatible re-export of build_llm from agents.core.

Kept for any code that imports build_llm from agents.agent directly.
"""

from agents.core import build_llm  # noqa: F401

__all__ = ["build_llm"]
