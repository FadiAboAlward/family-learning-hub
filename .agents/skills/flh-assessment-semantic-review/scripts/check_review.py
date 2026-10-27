#!/usr/bin/env python3
"""Fail-closed structural checks for an advisory LLM review record.

NOT a semantic judge and NOT an academic release gate. No external packages.
Input must contain ``item`` (mode, prompt, options, hints, explanations) and
``review`` (verdict, complete, defect fields, diagnostic booleans).
"""
import json
import re
import sys
from pathlib import Path

ALLOWED = {"KEY_INCORRECT", "HINT_COUNT_OR_BULLETS", "HINT_OFF_TASK",
           "H2_ANSWER_LEAK", "OTHER_HINT_LEAK", "SOURCE_CONFLICT",
           "DISTRACTOR_INVALID", "OTHER_BLOCKING"}
WORD_RE = re.compile(r"[\w\u0600-\u06ff]+", re.UNICODE)


def validate(data):
    issues = []
    item = data.get("item") or {}
    review = data.get("review") or {}
    mode = str(item.get("mode", "")).lower()
    hints = item.get("hints") or []
    if mode not in {"learning", "exam"}:
        issues.append("BAD_MODE")
    if not isinstance(item.get("options"), list) or len(item["options"]) != 4:
        issues.append("FOUR_OPTIONS_REQUIRED")
    if not isinstance(hints, list):
        issues.append("INVALID_HINTS")
        hints = []
    if mode == "exam" and hints:
        issues.append("EXAM_MUST_HAVE_ZERO_HINTS")
    if mode == "learning":
        if len(hints) != 4:
            issues.append("LEARNING_MUST_HAVE_FOUR_HINTS")
        for i, h in enumerate(hints, 1):
            body = h if isinstance(h, str) else h.get("content", "")
            bullets = re.findall(r"(?m)^\s*[•*-]\s+\S", body)
            words = WORD_RE.findall(body)
            if len(bullets) != 3 or len(words) < 30:
                issues.append(f"H{i}_BAD_STRUCTURE")
    else:
        # In Exam, absence of hints is correct: a reviewer must not call it bad.
        if review.get("hints_valid") not in {None, "NOT_APPLICABLE"}:
            issues.append("EXAM_HINTS_REVIEW_SHOULD_BE_NA")
        if review.get("h2_leak") not in {None, "NOT_APPLICABLE"}:
            issues.append("EXAM_H2_SHOULD_BE_NA")

    defects = review.get("defects", [])
    if not isinstance(defects, list):
        defects = []
        issues.append("DEFECTS_NOT_LIST")
    text_pieces = [str(item.get("prompt", "")), str(item.get("source_excerpt", ""))]
    for opt in item.get("options", []):
        text_pieces.append(opt if isinstance(opt, str) else str(opt.get("content", "")))
    for h in hints:
        text_pieces.append(h if isinstance(h, str) else str(h.get("content", "")))
    for key in ("correct_explanation", "final_incorrect_explanation"):
        text_pieces.append(str(item.get(key, "")))
    searchable = "\n".join(text_pieces)
    norm = lambda s: " ".join(str(s).split()).casefold()
    for d in defects:
        if not isinstance(d, dict) or d.get("code") not in ALLOWED:
            issues.append("UNKNOWN_DEFECT_CODE")
            continue
        quote = d.get("quote", "")
        if not quote or norm(quote) not in norm(searchable):
            issues.append("UNGROUNDED_EVIDENCE_QUOTE")
        if d.get("code") == "HINT_COUNT_OR_BULLETS":
            # Word minimum, NOT a maximum or a per-bullet requirement.
            if mode == "exam" or (len(hints) == 4 and all(
                len(re.findall(r"(?m)^\s*[•*-]\s+\S", h if isinstance(h, str) else h.get("content", ""))) == 3
                and len(WORD_RE.findall(h if isinstance(h, str) else h.get("content", ""))) >= 30 for h in hints)):
                issues.append("SPURIOUS_HINT_LENGTH_CLAIM")
    verdict = review.get("verdict")
    if verdict not in {"PASS", "FAIL", "INCOMPLETE"}:
        issues.append("BAD_VERDICT")
    if review.get("complete") != "YES":
        issues.append("INCOMPLETE_REVIEW")
    if verdict == "PASS" and (defects or review.get("key_valid") != "YES"
        or review.get("source_valid") != "YES"
        or review.get("distractors_valid") != "YES"
        or (mode == "learning" and (review.get("hints_valid") != "YES"
            or review.get("hint_aligned") != "YES" or review.get("h2_leak") != "NO"))):
        issues.append("CONTRADICTORY_PASS")
    if verdict == "FAIL" and not defects:
        issues.append("UNSUPPORTED_FAIL")
    return sorted(set(issues))


def main(argv):
    if len(argv) != 2:
        print("Usage: check_review.py review_input.json", file=sys.stderr)
        return 2
    try:
        data = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
        problems = validate(data)
    except (OSError, ValueError, TypeError) as exc:
        print(f"INVALID_INPUT: {exc}", file=sys.stderr)
        return 2
    print(json.dumps({"structural_consistency": "PASS" if not problems else "BLOCKED",
                      "issues": problems, "independent_semantic_pass": False}, ensure_ascii=False))
    return 0 if not problems else 1

if __name__ == "__main__":
    raise SystemExit(main(sys.argv))