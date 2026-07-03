#!/usr/bin/env python3
"""
Facet M0 — generate the semantic-search labeled tasks (tasks/semantic.jsonl).

Relevance ground truth = topical subtopic clusters. Human judgment is
encoded as: a title keyword that defines the subtopic + manual `excludes`
of eyeballed false-positives + a seed. Only papers WITH an abstract are
eligible (the semantic gate embeds title+abstract). Each cluster yields:

  * a `by-node` task  — seed paper -> should retrieve its cluster siblings
  * a `by-text` task  — an NL description -> should retrieve the cluster

The model run (WebGPU) embeds the query, does VSS over the precomputed
embedding column, and returns ranked neighbours; those are scored against
`relevant_pids` (precision@k / recall) and judged useful (G4). Reproducible
from the fixture; re-run to regenerate.
"""

import json
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "tasks" / "semantic.jsonl"

# name: (keyword, excludes, text_query, extra_text_query|None)
CLUSTERS = {
    "super_resolution": (
        "%super-resolution%", [],
        "deep learning methods for single-image super-resolution",
        "using GANs to produce photo-realistic high-resolution images",
    ),
    "diabetic_retinopathy": (
        "%retinopath%", [],
        "detecting diabetic retinopathy from retinal fundus images", None,
    ),
    "brain_tumor_mri": (
        "%brain tumor%", [],
        "classifying and segmenting brain tumors from MRI scans", None,
    ),
    "skin_lesion": (
        "%skin%", ["W4386057769"],  # exclude VideoMAE false-positive
        "classifying skin lesions and melanoma from dermoscopy images", None,
    ),
    "object_detection": (
        "%object detection%", [],
        "deep neural network architectures for object detection", None,
    ),
    "semantic_segmentation": (
        "%semantic segmentation%", [],
        "fully-convolutional networks for semantic image segmentation", None,
    ),
    "generative_adversarial": (
        "%generative adversarial%", [],
        "generative adversarial networks for image synthesis", None,
    ),
    "covid_chest": (
        "%covid%", [],
        "diagnosing COVID-19 from chest CT and X-ray images", None,
    ),
    "pose_estimation": (
        "%pose estimation%", ["W1909903157"],  # exclude object-recognition descriptor paper
        "estimating human body pose from images", None,
    ),
    "reinforcement": (
        "%reinforcement learning%", [],
        "deep reinforcement learning for control and games", None,
    ),
    "face_recognition": (
        "%face recognition%", [],
        "deep learning embeddings for face recognition", None,
    ),
    "anomaly_detection": (
        "%anomaly detection%", [],
        "deep learning for anomaly and outlier detection", None,
    ),
    "point_cloud": (
        "%point cloud%", [],
        "deep learning on 3D point clouds", None,
    ),
    "hyperspectral": (
        "%hyperspectral%", [],
        "convolutional networks for hyperspectral image classification", None,
    ),
    "action_recognition": (
        "%action recognition%", [],
        "recognising human actions in video", None,
    ),
}

con = duckdb.connect()
con.execute(f"CREATE VIEW papers AS SELECT * FROM '{DATA / 'papers.parquet'}'")

tasks = []
n = 0
for name, (kw, excludes, text_q, extra_q) in CLUSTERS.items():
    ex = " AND pid NOT IN (" + ",".join(f"'{e}'" for e in excludes) + ")" if excludes else ""
    rows = con.sql(
        f"SELECT pid FROM papers WHERE ttl ILIKE '{kw}' AND abs IS NOT NULL{ex} "
        f"ORDER BY n_cite DESC LIMIT 20"
    ).fetchall()
    members = [r[0] for r in rows]
    if len(members) < 3:
        print(f"  skip {name}: only {len(members)} members")
        continue
    seed, siblings = members[0], members[1:]
    n += 1
    tasks.append({
        "id": f"sem-{n:03d}", "type": "by-node", "cluster": name,
        "query_pid": seed, "intent": f"Find papers similar to {seed}.",
        "relevant_pids": siblings,
        "note": f"cluster '{name}' (keyword {kw}); relevance = topical siblings.",
    })
    n += 1
    tasks.append({
        "id": f"sem-{n:03d}", "type": "by-text", "cluster": name,
        "query_text": text_q, "intent": text_q,
        "relevant_pids": members,
        "note": f"cluster '{name}'; relevance = all members with an abstract.",
    })
    if extra_q:
        n += 1
        tasks.append({
            "id": f"sem-{n:03d}", "type": "by-text", "cluster": name,
            "query_text": extra_q, "intent": extra_q,
            "relevant_pids": members,
            "note": f"cluster '{name}', alternate phrasing.",
        })

with OUT.open("w", encoding="utf-8") as f:
    for t in tasks:
        f.write(json.dumps(t, ensure_ascii=False) + "\n")

by_node = sum(1 for t in tasks if t["type"] == "by-node")
by_text = sum(1 for t in tasks if t["type"] == "by-text")
sizes = [len(t["relevant_pids"]) for t in tasks]
print(f"wrote {len(tasks)} semantic tasks ({by_node} by-node, {by_text} by-text) -> {OUT.name}")
print(f"relevance-set sizes: min {min(sizes)}, max {max(sizes)}, mean {sum(sizes)/len(sizes):.1f}")
