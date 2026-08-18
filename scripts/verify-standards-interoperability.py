#!/usr/bin/env python3
"""Independent S6 RDF, SHACL, PROV-O, and OWL-RL fixture gate."""

from __future__ import annotations

import hashlib
import json
import sys
from importlib.metadata import version
from pathlib import Path

from owlrl import DeductiveClosure, OWLRL_Semantics
from pyshacl import validate
from rdflib import Graph, Namespace, RDF, RDFS

ROOT = Path(__file__).resolve().parent.parent
FIXTURE_DIR = ROOT / "tests" / "fixtures" / "standards" / "s6"
MANIFEST = FIXTURE_DIR / "manifest.json"

SKOS = Namespace("http://www.w3.org/2004/02/skos/core#")
SH = Namespace("http://www.w3.org/ns/shacl#")
PROV = Namespace("http://www.w3.org/ns/prov#")
OWL = Namespace("http://www.w3.org/2002/07/owl#")
SKOS_EX = Namespace("https://example.test/skos/")
PROV_EX = Namespace("https://example.test/prov/")
OWL_EX = Namespace("https://example.test/owl/")
EXPECTED_PROCESSORS = {
    "rdflib": "7.6.0",
    "owlrl": "7.6.2",
    "pyshacl": "0.40.0",
}


def parse(name: str) -> Graph:
    graph = Graph()
    graph.parse(FIXTURE_DIR / name, format="turtle")
    return graph


def verify_manifest() -> int:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    checked = 0
    for fixture in manifest["fixtures"]:
        path = FIXTURE_DIR / fixture["file"]
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        require(digest == fixture["sha256"], f"hash mismatch for {path.name}")
        require(fixture["source"].startswith("https://www.w3.org/"), "fixture source is not W3C")
        checked += 1
    return checked


def verify_skos() -> int:
    graph = parse("skos-w3c-example.ttl")
    require((SKOS_EX.A, RDF.type, SKOS.Concept) in graph, "SKOS concept A missing")
    require((SKOS_EX.A, SKOS.broader, SKOS_EX.B) in graph, "SKOS broader link missing")
    require((SKOS_EX.S, RDF.type, SKOS.ConceptScheme) in graph, "SKOS scheme missing")
    return len(graph)


def verify_shacl() -> tuple[int, int]:
    shapes = parse("shacl-w3c-person-shapes.ttl")
    valid = parse("shacl-w3c-person-valid.ttl")
    invalid = parse("shacl-w3c-person-invalid.ttl")
    require((None, RDF.type, SH.NodeShape) in shapes, "SHACL node shape missing")
    valid_result, _, _ = validate(valid, shacl_graph=shapes, inference="none", advanced=False)
    invalid_result, report, _ = validate(
        invalid,
        shacl_graph=shapes,
        inference="none",
        advanced=False,
    )
    require(bool(valid_result), "SHACL valid fixture did not conform")
    require(not bool(invalid_result), "SHACL invalid fixture conformed")
    result_count = len(set(report.subjects(RDF.type, SH.ValidationResult)))
    require(result_count == 2, f"SHACL invalid fixture returned {result_count} results")
    return len(shapes), result_count


def verify_prov() -> int:
    graph = parse("prov-w3c-example.ttl")
    require((PROV_EX.article, RDF.type, PROV.Entity) in graph, "PROV entity missing")
    require((PROV_EX.writing, RDF.type, PROV.Activity) in graph, "PROV activity missing")
    require((PROV_EX.alice, RDF.type, PROV.Agent) in graph, "PROV agent missing")
    require((PROV_EX.writing, PROV.used, PROV_EX.draft) in graph, "PROV used edge missing")
    return len(graph)


def verify_owl() -> tuple[int, int]:
    graph = parse("owl2-rl-public-example.ttl")
    before = len(graph)
    DeductiveClosure(OWLRL_Semantics).expand(graph)
    require((OWL_EX.Buyer, RDFS.subClassOf, OWL_EX.Agent) in graph, "OWL-RL closure missing")
    require(
        (OWL_EX.Vendor, OWL.equivalentClass, OWL_EX.Supplier) in graph,
        "OWL equivalent-class symmetry missing",
    )
    return before, len(graph)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    processors = {name: version(name) for name in EXPECTED_PROCESSORS}
    require(processors == EXPECTED_PROCESSORS, f"processor drift: {processors}")
    manifest_count = verify_manifest()
    skos_triples = verify_skos()
    shacl_triples, shacl_results = verify_shacl()
    prov_triples = verify_prov()
    owl_input, owl_closure = verify_owl()
    evidence = {
        "gate": "naklidata-standards-interoperability-s6",
        "processors": processors,
        "fixtures": manifest_count,
        "matrix": {
            "skos": {"triples": skos_triples},
            "shacl": {"shape_triples": shacl_triples, "negative_results": shacl_results},
            "prov": {"triples": prov_triples},
            "owl": {"input_triples": owl_input, "closure_triples": owl_closure},
        },
    }
    print(json.dumps(evidence, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"standards interoperability gate failed: {error}", file=sys.stderr)
        sys.exit(1)
