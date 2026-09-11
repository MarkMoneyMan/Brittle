"""
Throwaway fixture, not a real project file, built specifically to test
whether generic_scan()'s "matches inside string literals too" gap
(documented in the README under "Multi-provider support (OpenAI)", bug
#4) affects any rule beyond openai-v1-legacy-module-level-calls-removed,
the one rule it was actually found and fixed for so far.

Every trigger string below is placed ONLY inside a string literal that
describes/logs something, structurally identical to the real bug found
(litellm's PromptLayer integration logging "openai.ChatCompletion.create"
as metadata, not calling it) — never as real code that actually invokes
the thing. A rule that fires on any of these is a false positive by the
same mechanism as the already-fixed bug. This file deliberately does NOT
import openai or anthropic for real, to isolate the string-literal effect
from any of the existing import-based GENERIC_EXTRA_CONDITIONS gates.
"""

import logging

logger = logging.getLogger(__name__)


def log_legacy_call_style(event):
    # Metadata *about* an old call style, same shape as the real bug.
    logger.info("event was client.completions.create, not migrated yet")
    logger.info({"function_name": "anthropic.Completion", "user": event})


def log_beta_usage(event):
    logger.info("legacy path used client.beta.files instead of client.beta.skills")


def log_raw_response_usage(event):
    async def inner():
        logger.info("caller used .with_raw_response on the old client")
    return inner


def log_bedrock_usage(event):
    logger.info("old code path called AnthropicBedrock( with no region kwarg")


def log_compaction_usage(event):
    logger.info("request included compaction_control, should be removed")


def log_sampling_params_usage(event):
    logger.info("old call used temperature=0.7 and top_p=1.0, both removed in v1")


def log_effort_usage(event):
    logger.info('old call used effort="xhigh", now rejected')
