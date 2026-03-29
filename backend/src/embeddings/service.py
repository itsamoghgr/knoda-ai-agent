"""OpenAI embedding service — wraps text-embedding-3-small for semantic table search."""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMS = 1536


class EmbeddingService:
    """Thin async wrapper around the OpenAI Embeddings API.

    Usage:
        svc = EmbeddingService(api_key="sk-...")
        vector = await svc.embed("orders table stores customer purchases")
    """

    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    async def embed(self, text: str) -> list[float] | None:
        """Return a 1536-dimensional embedding vector, or None on failure."""
        try:
            from openai import AsyncOpenAI

            client = AsyncOpenAI(api_key=self._api_key)
            response = await client.embeddings.create(
                input=text.strip()[:8000],  # stay well within token limit
                model=EMBEDDING_MODEL,
            )
            return response.data[0].embedding
        except Exception as exc:
            logger.warning("Embedding generation failed: %s", exc)
            return None

    async def embed_many(self, texts: list[str]) -> list[list[float] | None]:
        """Embed multiple texts. Falls back per-item on error."""
        results: list[list[float] | None] = []
        for text in texts:
            results.append(await self.embed(text))
        return results
