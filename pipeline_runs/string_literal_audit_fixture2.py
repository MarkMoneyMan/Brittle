"""
Second audit fixture. Covers every remaining generic-path rule not yet
tested in string_literal_audit_fixture.py, including the harder case for
rules that already have a GENERIC_EXTRA_CONDITIONS gate requiring
"this file references anthropic/openai" — that gate only checks the whole
file imports the SDK somewhere, not that the specific matched string is
related to real usage, so a file that legitimately uses the SDK AND
separately logs an unrelated string can still slip through. Every real
call below is a normal, correct, unrelated SDK call; every trigger string
is purely metadata/log text describing something else, never real usage.
"""

import logging
import anthropic
import openai

logger = logging.getLogger(__name__)

# Real, unrelated, correct usage of both SDKs — establishes
# references_anthropic / references_openai as True for this file, the
# same way a real mixed-provider project would.
_anthropic_client = anthropic.Anthropic()
_openai_client = openai.OpenAI()


def real_call():
    return _anthropic_client.messages.create(
        model="claude-sonnet-5-20260101",
        max_tokens=100,
        messages=[{"role": "user", "content": "hi"}],
    )


def log_httpx_mentions(event):
    # Old migration notes as a log line, not real httpx usage anywhere in
    # this function.
    logger.info("legacy code used httpx.Client(timeout=30.0) directly")


def log_min_python_mentions(event):
    logger.info("this package still declares python_requires in some old fork")


def log_managed_agents_header(event):
    logger.info("saw old anthropic-beta header value managed-agents-2026-04-01 in a support ticket")


def log_computer_tool_mentions(event):
    logger.info("support ticket mentioned computer_20251124 tool type")


def log_openai_httpx_mentions(event):
    logger.info("old OpenAI client code used httpx.Client(timeout=30.0) directly")


def log_tool_call_output_type_mentions(event):
    logger.info("legacy code referenced ResponseFunctionToolCallOutputItem by name")


def log_openai_error_class_mentions(event):
    logger.info("old except clause caught openai.InvalidRequestError by name")


def log_legacy_module_level_call_mentions(event):
    # Regression check: this is the exact bug class already fixed for
    # openai-v1-legacy-module-level-calls-removed — confirm it stays fixed.
    logger.info({"function_name": "openai.ChatCompletion.create", "user": event})
