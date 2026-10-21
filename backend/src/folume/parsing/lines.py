"""Group characters into lines/fragments, attaching sub/superscripts to their line."""

from __future__ import annotations

from collections import Counter
from statistics import median

from .types import Char, Fragment, RawPage, union


def dominant_size(chars: list[Char]) -> float:
    counts: Counter[float] = Counter()
    for c in chars:
        if not c.text.isspace():
            counts[round(c.size, 1)] += 1
    if not counts:
        return chars[0].size if chars else 10.0
    return counts.most_common(1)[0][0]


def _bucket_by_baseline(chars: list[Char]) -> list[list[Char]]:
    buckets: list[list[Char]] = []
    for c in sorted(chars, key=lambda c: c.baseline):
        if buckets:
            last = buckets[-1]
            tol = max(1.0, 0.12 * c.size)
            if c.baseline - last[-1].baseline <= tol:
                last.append(c)
                continue
        buckets.append([c])
    return buckets


def _runs(chars: list[Char], max_gap: float) -> list[list[Char]]:
    runs: list[list[Char]] = []
    for c in sorted(chars, key=lambda c: c.x0):
        if runs and c.x0 - runs[-1][-1].x1 <= max_gap:
            runs[-1].append(c)
        else:
            runs.append([c])
    return runs


def _attach_scripts(buckets: list[list[Char]]) -> list[list[Char]]:
    """Move small, vertically offset runs (sub/superscripts) into the adjacent larger bucket.

    Decided per run, not per bucket: two columns share baselines, so a bucket can mix a script
    run with unrelated body text and its dominant size says nothing about the run.
    """
    base = [median(c.baseline for c in b) for b in buckets]
    sizes = [dominant_size(b) for b in buckets]
    ink = [[c for c in b if not c.text.isspace()] for b in buckets]
    result = [list(b) for b in buckets]
    moved: list[set[int]] = [set() for _ in buckets]
    for i, bucket in enumerate(buckets):
        for run in _runs(bucket, 1.0 * sizes[i]):
            if len(run) > 14:
                continue  # a long run is a text line of its own, not a script
            size_r = dominant_size(run)
            run_base = median(c.baseline for c in run)
            left, right = run[0].x0, run[-1].x1
            cands = sorted(
                (j for j in range(len(buckets))
                 if j != i and sizes[j] > size_r * 1.1 and abs(base[j] - run_base) <= 0.55 * sizes[j]),
                key=lambda j: abs(base[j] - run_base),
            )
            for j in cands:
                reach = 0.8 * sizes[j]
                if any((m.x0 - reach <= left <= m.x1 + reach) or (m.x0 <= right <= m.x1 + reach) for m in ink[j]):
                    result[j].extend(run)
                    moved[i].update(id(c) for c in run)
                    break
    for i, ids in enumerate(moved):
        if ids:
            result[i] = [c for c in result[i] if id(c) not in ids]
    return [b for b in result if b]


def split_fragments(chars: list[Char], baseline: float, page: int) -> list[Fragment]:
    ink = sorted((c for c in chars if not c.text.isspace()), key=lambda c: c.x0)
    if not ink:
        return []
    main = dominant_size(ink)
    gaps = [ink[k + 1].x0 - ink[k].x1 for k in range(len(ink) - 1)]
    typical = median(gaps) if gaps else 0.0
    # letter-spaced text has a large median gap; normal text has touching letters
    gap_limit = max(0.95 * main, 7.0, 3.0 * typical if typical > 0.05 * main else 0.0)
    groups: list[list[Char]] = [[ink[0]]]
    for k in range(1, len(ink)):
        if ink[k].x0 - groups[-1][-1].x1 > gap_limit:
            groups.append([ink[k]])
        else:
            groups[-1].append(ink[k])
    frags = []
    for g in groups:
        frags.append(Fragment(page=page, chars=g, bbox=union([c.bbox for c in g]), baseline=baseline,
                              size=dominant_size(g)))
    return frags


def build_fragments(page: RawPage) -> tuple[list[Fragment], list[Char]]:
    """Return (upright fragments, rotated chars) for a page."""
    upright = [c for c in page.chars if c.upright and not c.text.isspace()]
    rotated = [c for c in page.chars if not c.upright and not c.text.isspace()]
    buckets = _attach_scripts(_bucket_by_baseline(upright))
    fragments: list[Fragment] = []
    for b in buckets:
        main_chars = [c for c in b if c.size >= 0.9 * dominant_size(b)] or b
        baseline = median(c.baseline for c in main_chars)
        fragments += split_fragments(b, baseline, page.number)
    fragments.sort(key=lambda f: (round(f.baseline, 1), f.x0))
    return fragments, rotated
