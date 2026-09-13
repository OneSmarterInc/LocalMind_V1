"""Prompt scaffolding shared by the tutor, quiz generator and remediation.

Why one scaffold: llama.cpp (and Ollama) keep the processed key/value state
of the previous prompt and skip re-processing whatever prefix the next
prompt shares with it. Reading a 14,000-character module through a 1.7B
model on a laptop CPU is the slow part of every call, often more than half
the wall-clock time, so the prompts are laid out so that this prefix is as
long as possible and identical across features:

    [system: fixed rules, identical for every feature]
    [user: MODULE + SOURCE TEXT ............................] <- shared prefix
    [user: task instructions, conversation, question, ...]  <- varies

A student who asks three questions about a module pays for the source text
once. A quiz generated right after a lesson on the same module reuses the
lesson's prefix. Nothing about the instructions is weakened; they simply
come after the source instead of before it, which is also where a small
model attends to them best.
"""
from __future__ import annotations

from .gateway import trim_source

# One system prompt for everything. Feature-specific instructions live in
# the TASK block at the end of the user message, so the system turn never
# changes between calls and always matches the cached prefix.
SYSTEM_PROMPT = (
    "You are a tutor for one module of a textbook. Follow every rule.\n"
    "1. Use only the SOURCE TEXT. Do not add facts, dates, names or examples that are not in it.\n"
    "2. When the source does not cover something, say so plainly instead of guessing.\n"
    "3. Every source_reference is a short phrase copied from the SOURCE TEXT.\n"
    "4. Write in plain, simple English for a first-time learner.\n"
    "5. The TASK at the end of the message says exactly what to produce and in what shape.\n"
    "6. Output JSON only.\n"
)


def source_block(title: str, source_text: str, trim: bool = True) -> str:
    """The shared prefix of every user message about one module. Byte-for-byte
    identical for the same module and version, which is what makes the
    provider's prefix reuse fire. ``trim=False`` is for callers that already
    sized the text (retrieved chunks, coverage samples)."""
    text = trim_source(source_text) if trim else (source_text or "")
    return f'MODULE: {title}\n\nSOURCE TEXT:\n"""{text}"""\n'


def build_user_prompt(title: str, source_text: str, task: str, *extra_blocks: str, trim: bool = True) -> str:
    """Source first, then any context blocks (conversation, incorrect answers,
    previously asked questions), then the TASK last."""
    parts = [source_block(title, source_text, trim=trim)]
    parts.extend(block for block in extra_blocks if block)
    parts.append(f"TASK: {task.strip()}")
    return "\n".join(parts)
