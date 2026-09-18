"""
LangGraph StateGraph compilation for AIRA Universal Voice Agent.
Orchestrates orientation, conversational question formulation, extraction,
deterministic guardrails, cyclical error correction, and final DOM sync.
"""

from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver

from aira_agent.state import FormAgentState
from aira_agent.nodes import (
    orient_page_node,
    synthesize_question_node,
    listen_and_extract_node,
    guardrail_node,
    error_guidance_node,
    advance_queue_node,
    review_summary_node,
    sync_dom_node,
    detect_intent_node,
    step_back_node,
    explain_field_node,
    handle_review_confirmation_node,
    jump_to_field_node,
    prompt_field_choice_node,
    cancel_session_node
)
from aira_agent.edges import (
    route_turn_intent,
    route_after_validation,
    route_after_advance,
    route_after_confirmation
)

def build_turn_graph():
    """
    Constructs and compiles the AIRA Single-Turn Interaction StateGraph.
    Manages turn intent routing (voice step-back, explain assistance, or answer extraction),
    guardrail validation, error guidance, and question/review progression.
    """
    workflow = StateGraph(FormAgentState)

    # 1. Register turn nodes
    workflow.add_node("detect_intent", detect_intent_node)
    workflow.add_node("step_back", step_back_node)
    workflow.add_node("explain_field", explain_field_node)
    workflow.add_node("extract_semantic", listen_and_extract_node)
    workflow.add_node("guardrail", guardrail_node)
    workflow.add_node("error_guidance", error_guidance_node)
    workflow.add_node("advance_queue", advance_queue_node)
    workflow.add_node("synthesize_question", synthesize_question_node)
    workflow.add_node("review_summary", review_summary_node)

    # 2. Sequential & conditional edge wiring
    workflow.add_edge(START, "detect_intent")
    workflow.add_conditional_edges(
        "detect_intent",
        route_turn_intent,
        {
            "step_back": "step_back",
            "explain_field": "explain_field",
            "extract_semantic": "extract_semantic"
        }
    )

    # Step-back cleanly flows into synthesize_question (with zero-latency prompt cache hit)
    workflow.add_edge("step_back", "synthesize_question")
    workflow.add_edge("explain_field", END)

    # Answer path: extraction -> guardrail
    workflow.add_edge("extract_semantic", "guardrail")

    # Guardrail check: error guidance vs advance queue
    workflow.add_conditional_edges(
        "guardrail",
        route_after_validation,
        {
            "error_guidance": "error_guidance",
            "advance_queue": "advance_queue"
        }
    )
    workflow.add_edge("error_guidance", END)

    # Advance queue: synthesize next question vs review summary
    workflow.add_conditional_edges(
        "advance_queue",
        route_after_advance,
        {
            "synthesize_question": "synthesize_question",
            "review_summary": "review_summary"
        }
    )
    workflow.add_edge("synthesize_question", END)
    workflow.add_edge("review_summary", END)

    return workflow.compile()


def build_review_graph():
    """
    Constructs and compiles the AIRA Summary Review & Confirmation StateGraph.
    Manages final user submission, specific field corrections, and cancellations.
    """
    workflow = StateGraph(FormAgentState)

    # 1. Register review nodes
    workflow.add_node("handle_confirmation", handle_review_confirmation_node)
    workflow.add_node("sync_dom", sync_dom_node)
    workflow.add_node("jump_to_field", jump_to_field_node)
    workflow.add_node("prompt_field_choice", prompt_field_choice_node)
    workflow.add_node("cancel_session", cancel_session_node)

    # 2. Wire edges
    workflow.add_edge(START, "handle_confirmation")
    workflow.add_conditional_edges(
        "handle_confirmation",
        route_after_confirmation,
        {
            "sync_dom": "sync_dom",
            "synthesize_question": "jump_to_field",
            "ask_which_field": "prompt_field_choice",
            "cancel": "cancel_session"
        }
    )

    workflow.add_edge("sync_dom", END)
    workflow.add_edge("jump_to_field", END)
    workflow.add_edge("prompt_field_choice", END)
    workflow.add_edge("cancel_session", END)

    return workflow.compile()


def build_aira_graph(enable_checkpointing: bool = True):
    """
    Constructs and compiles the AIRA Voice Form StateGraph (backward-compatible).
    """
    workflow = StateGraph(FormAgentState)
    
    # 1. Register all nodes
    workflow.add_node("orient_page", orient_page_node)
    workflow.add_node("synthesize_question", synthesize_question_node)
    workflow.add_node("listen_and_extract", listen_and_extract_node)
    workflow.add_node("guardrail", guardrail_node)
    workflow.add_node("error_guidance", error_guidance_node)
    workflow.add_node("advance_queue", advance_queue_node)
    workflow.add_node("review_summary", review_summary_node)
    workflow.add_node("sync_dom", sync_dom_node)
    
    # 2. Add structural & sequential edges
    workflow.add_edge(START, "orient_page")
    workflow.add_edge("orient_page", "synthesize_question")
    workflow.add_edge("listen_and_extract", "guardrail")
    
    # 3. Add conditional edge after guardrail:
    workflow.add_conditional_edges(
        "guardrail",
        route_after_validation,
        {
            "error_guidance": "error_guidance",
            "advance_queue": "advance_queue"
        }
    )
    
    # 4. Add conditional edge after advance_queue:
    workflow.add_conditional_edges(
        "advance_queue",
        route_after_advance,
        {
            "synthesize_question": "synthesize_question",
            "review_summary": "review_summary"
        }
    )
    
    workflow.add_edge("sync_dom", END)
    
    checkpointer = MemorySaver() if enable_checkpointing else None
    
    app = workflow.compile(
        checkpointer=checkpointer,
        interrupt_before=["listen_and_extract", "sync_dom"]
    )
    
    return app

# Singleton compiled instances
aira_turn_graph = build_turn_graph()
aira_review_graph = build_review_graph()
aira_agent_app = build_aira_graph(enable_checkpointing=True)
