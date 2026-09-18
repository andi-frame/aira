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
    sync_dom_node
)
from aira_agent.edges import (
    route_after_validation,
    route_after_advance,
    route_after_confirmation
)

def build_aira_graph(enable_checkpointing: bool = True):
    """
    Constructs and compiles the AIRA Voice Form StateGraph.
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

# Singleton compiled instance
aira_agent_app = build_aira_graph(enable_checkpointing=True)
