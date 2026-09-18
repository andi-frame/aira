"""
Conditional Edge routing functions for AIRA LangGraph StateGraph.
Controls cyclical error recovery, sequential field traversal, and human-in-the-loop approval.
"""

from typing import Literal
from aira_agent.state import FormAgentState

def route_after_validation(state: FormAgentState) -> Literal["error_guidance", "advance_queue"]:
    """
    Decides whether to route to error feedback or advance to the next field.
    """
    if not state.get("is_valid", False):
        return "error_guidance"
    return "advance_queue"


def route_after_advance(state: FormAgentState) -> Literal["synthesize_question", "review_summary"]:
    """
    Checks if there are remaining fields in the queue or if we should proceed to review.
    """
    if state.get("status") == "REVIEWING":
        return "review_summary"
    return "synthesize_question"


def route_after_confirmation(state: FormAgentState) -> Literal["sync_dom", "synthesize_question", "ask_which_field", "cancel"]:
    """
    Evaluates user confirmation response during the final review stage.
    Supports affirmative confirmation, cyclical field correction, and cancellation.
    """
    decision = state.get("review_decision")
    if decision == "CONFIRMED":
        return "sync_dom"
    elif decision == "CORRECT_FIELD":
        return "synthesize_question"
    elif decision == "ASK_WHICH_FIELD":
        return "ask_which_field"
    elif decision == "CANCELLED":
        return "cancel"

    # Fallback to response string check
    response = str(state.get("confirmation_response", "")).lower().strip()
    if any(affirm in response for affirm in ["ya", "kirim", "lanjut", "benar", "sudah", "oke", "setuju", "betul", "siap"]):
        return "sync_dom"
    elif any(neg in response for neg in ["batal", "jangan"]):
        return "cancel"
        
    return "ask_which_field"
