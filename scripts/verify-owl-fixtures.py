#!/usr/bin/env python3
"""Optional independent OWL 2 RL fixture gate.

Usage:
  PYTHONPATH=/path/to/pinned/site-packages python3 scripts/verify-owl-fixtures.py

Pinned comparison environment for Batch S4:
  rdflib==7.6.0 owlrl==7.6.1
"""

from __future__ import annotations

import json
from importlib.metadata import version
from pathlib import Path

from owlrl import OWLRL_Semantics
from rdflib import Graph, URIRef
from rdflib.namespace import RDFS


FIXTURES = Path(__file__).parent.parent / "tests" / "fixtures" / "standards" / "s4"


def expand(name: str) -> tuple[Graph, list[str]]:
    graph = Graph().parse(FIXTURES / name, format="turtle")
    semantics = OWLRL_Semantics(graph, axioms=False, daxioms=False, rdfs=False)
    semantics.closure()
    return graph, list(semantics.error_messages)


def main() -> None:
    satisfiable, satisfiable_errors = expand("satisfiable.ttl")
    inconsistent, inconsistent_errors = expand("inconsistent.ttl")
    cyclic, cyclic_errors = expand("cyclic.ttl")
    unsupported, unsupported_errors = expand("unsupported.ttl")

    expected_entailment = (
        URIRef("https://example.test/owl/A"),
        RDFS.subClassOf,
        URIRef("https://example.test/owl/C"),
    )
    if satisfiable_errors:
        raise RuntimeError(f"satisfiable fixture reported errors: {satisfiable_errors}")
    if expected_entailment not in satisfiable:
        raise RuntimeError("satisfiable fixture lacks transitive subclass entailment")
    if not inconsistent_errors:
        raise RuntimeError("inconsistent fixture produced no OWL-RL error")
    if cyclic_errors:
        raise RuntimeError(f"cyclic fixture is OWL-consistent but reported errors: {cyclic_errors}")
    if unsupported_errors:
        raise RuntimeError(f"unsupported fixture reported OWL-RL errors: {unsupported_errors}")

    print(
        json.dumps(
            {
                "rdflib": version("rdflib"),
                "owlrl": version("owlrl"),
                "satisfiable": {"errors": 0, "expandedTriples": len(satisfiable)},
                "inconsistent": {
                    "errors": len(inconsistent_errors),
                    "expandedTriples": len(inconsistent),
                },
                "cyclic": {"errors": 0, "expandedTriples": len(cyclic)},
                "unsupported": {"errors": 0, "expandedTriples": len(unsupported)},
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
