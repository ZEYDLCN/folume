"""Seeded, topic-aware text generation for synthetic papers."""

from __future__ import annotations

import random

from .spec import Bullets, Code, Equation, Figure, Heading, Paper, Para, Ref, Table

FIRST = ["Alice", "Bora", "Chen", "Deniz", "Elif", "Farid", "Grace", "Hiro", "Ines", "Jonas",
         "Katya", "Leyla", "Mateo", "Nora", "Omar", "Priya", "Quinn", "Rana", "Sven", "Tara"]
LAST = ["Anderson", "Yilmaz", "Zhang", "Kaya", "Okafor", "Schmidt", "Rossi", "Tanaka", "Novak",
        "Haddad", "Ivanova", "Demir", "Silva", "Nguyen", "Cohen", "Larsen", "Mehta", "Weber"]
AFFS = ["Department of Computer Science, Northgate University", "Institute for Data Science, Lakeside Technical University",
        "Applied AI Laboratory, Meridian Research", "School of Engineering, Eastbridge University"]

EQUATIONS = [
    r"L(\theta) = \frac{1}{N} \sum_{i=1}^{N} \ell(f(x_i; \theta), y_i) + \lambda \| \theta \|^2",
    r"\alpha_{ij} = \frac{\exp(e_{ij})}{\sum_{k=1}^{n} \exp(e_{ik})}",
    r"\theta_{t+1} = \theta_t - \eta \nabla L(\theta_t)",
    r"p(x) = \int p(x \mid z) p(z) dz",
    r"s(q, k) = \frac{q \cdot k}{\sqrt{d}}",
    r"\mu_b = \frac{1}{B} \sum_{i=1}^{B} x_i",
]

TOPICS = {
    "ml": {
        "title": ["Sparse Routing for Efficient Transformers", "Adaptive Attention Budgets in Large Language Models",
                  "Learning Compact Representations with Contrastive Pretraining"],
        "concepts": ["attention mechanism", "gradient descent", "transformer encoder", "embedding space",
                     "loss landscape", "training objective", "regularization term", "batch size",
                     "token representation", "positional encoding", "feed-forward layer", "learning rate schedule"],
        "methods": ["sparse routing", "contrastive pretraining", "adaptive attention", "expert gating"],
        "datasets": ["WikiText-103", "ImageNet-1k", "GLUE", "C4"],
        "metrics": ["top-1 accuracy", "perplexity", "F1 score", "throughput"],
        "baselines": ["the dense baseline", "a standard transformer", "a distilled student", "linear attention"],
        "abbrs": [("Mixture-of-Experts", "MoE"), ("Stochastic Gradient Descent", "SGD"),
                  ("Layer Normalization", "LN"), ("Large Language Model", "LLM")],
        "tasks": ["language modeling", "image classification", "machine translation", "question answering"],
    },
    "graph": {
        "title": ["Message Passing with Learned Edge Priors", "Scalable Community Detection on Dynamic Graphs",
                  "Spectral Pooling for Graph Neural Networks"],
        "concepts": ["message passing", "graph Laplacian", "node embedding", "adjacency matrix", "spectral filter",
                     "community structure", "edge weight", "neighborhood sampling", "attention mechanism",
                     "gradient descent", "embedding space"],
        "methods": ["learned edge priors", "spectral pooling", "streaming modularity", "hierarchical coarsening"],
        "datasets": ["Cora", "OGB-Arxiv", "Reddit", "PubMed"],
        "metrics": ["node accuracy", "modularity", "AUROC", "runtime"],
        "baselines": ["GCN", "GraphSAGE", "a spectral baseline", "label propagation"],
        "abbrs": [("Graph Neural Network", "GNN"), ("Graph Convolutional Network", "GCN"),
                  ("Stochastic Gradient Descent", "SGD")],
        "tasks": ["node classification", "link prediction", "community detection", "graph classification"],
    },
    "bio": {
        "title": ["Deep Segmentation of Retinal Vessels under Limited Labels", "Self-Supervised Learning for Histopathology Slides",
                  "Uncertainty Estimation in Clinical Imaging Pipelines"],
        "concepts": ["retinal vessel", "image segmentation", "label noise", "data augmentation", "uncertainty estimate",
                     "convolutional layer", "gradient descent", "clinical annotation", "embedding space",
                     "training objective"],
        "methods": ["self-supervised pretraining", "uncertainty-aware segmentation", "stain normalization",
                    "active annotation"],
        "datasets": ["DRIVE", "CAMELYON16", "ChestX-ray14", "BraTS"],
        "metrics": ["Dice coefficient", "AUROC", "sensitivity", "expected calibration error"],
        "baselines": ["a U-Net baseline", "supervised pretraining", "a radiologist panel", "a random-forest baseline"],
        "abbrs": [("Convolutional Neural Network", "CNN"), ("Stochastic Gradient Descent", "SGD"),
                  ("Expected Calibration Error", "ECE")],
        "tasks": ["vessel segmentation", "tumor detection", "slide classification", "lesion grading"],
    },
}

SENTENCES = {
    "intro": [
        "{Method} addresses the long-standing problem of {task} by treating the {concept} as a learned quantity, which {benefit}.",
        "Recent progress in {task} {cite} has relied heavily on the {concept}, yet its {concept2} remains poorly understood.",
        "We argue that the {concept} should be considered jointly with the {concept2}, rather than in isolation.",
        "In this paper we propose {method}, a simple procedure that {benefit}.",
        "Our contributions are threefold: a formal treatment of the {concept}, an efficient algorithm, and an extensive evaluation on {dataset}.",
    ],
    "related": [
        "Prior work on the {concept} {cite} assumes that the {concept2} is fixed during training, which limits its flexibility.",
        "{Abbr_long} ({abbr}) was introduced by {cite} and has since become a standard tool for {task}.",
        "Unlike {baseline}, our approach does not require a separate {concept} and therefore {benefit}.",
        "A complementary line of research {cite} studies how the {concept} interacts with {concept2}, mostly in the setting of {task}.",
        "We build on the observation of {cite} that a carefully chosen {concept} can substantially reduce the cost of {task}.",
    ],
    "method": [
        "Let $x_i$ denote the {concept} of the $i$-th example and let $\\theta$ be the parameters of the model.",
        "We define the {term} as the quantity that minimizes the {concept} subject to a budget on the {concept2}.",
        "The {term} is given by Eq. ({eq}), where $\\lambda = 0.1$ controls the strength of the {concept}.",
        "Computing the {concept} naively requires $O(n^2)$ operations; {method} reduces this to $O(n \\log n)$.",
        "Intuitively, the {concept2} acts as a soft constraint on the {concept}, which {benefit}.",
        "We optimize the objective with {abbr} using a {concept} of {size}.",
    ],
    "results": [
        "On {dataset}, {method} improves {metric} by {pct}% over {baseline}, as reported in {table_ref}.",
        "{fig_ref} shows that the gap in {metric} widens as the {concept} grows, consistent with our analysis.",
        "Removing the {concept} reduces {metric} by {pct}%, confirming that it is a key ingredient.",
        "We repeat every experiment with five random seeds and report the mean; the standard deviation is below 0.4 in all cases.",
        "Compared with {baseline}, {method} is {pct}% faster at inference while matching {metric}.",
    ],
    "discussion": [
        "These results suggest that the {concept} is more important than previously assumed {cite}.",
        "A limitation of {method} is its sensitivity to the {concept2}, which we leave for future work.",
        "Future work will explore {task} in settings where the {concept} is only partially observed.",
        "We hope that {method} will serve as a useful baseline for further study of the {concept}.",
    ],
}
BENEFITS = ["reduces memory use without sacrificing accuracy", "improves robustness to distribution shift",
            "makes training substantially more stable", "scales gracefully to larger models",
            "removes the need for manual tuning", "yields interpretable intermediate representations"]


class Gen:
    def __init__(self, topic: str, seed: int, template: str, n_refs: int):
        self.p = TOPICS[topic]
        self.r = random.Random(seed)
        self.template = template
        self.n_refs = n_refs
        self.fig_total = 0
        self.tab_total = 0
        self.eq_total = 0
        self.method = self.r.choice(self.p["methods"])
        self.abbr = self.r.choice(self.p["abbrs"])

    def pick(self, key: str) -> str:
        return self.r.choice(self.p[key])

    def cite(self) -> str:
        n = self.r.randint(1, self.n_refs)
        if self.r.random() < 0.3:
            m = self.r.randint(1, self.n_refs)
            if m != n:
                lo, hi = sorted((n, m))
                return f"{{cite:{lo},{hi}}}"
        return f"{{cite:{n}}}"

    def sentence(self, kind: str, figs: int, tabs: int, eqs: int) -> str:
        s = self.r.choice(SENTENCES[kind])
        concepts = self.r.sample(self.p["concepts"], 2)
        fig_word = "Fig." if self.template == "ieee" else "Figure"
        tab_word = "Table"
        tab_no = _roman(self.r.randint(1, max(tabs, 1))) if self.template == "ieee" else str(self.r.randint(1, max(tabs, 1)))
        fmt = dict(
            Method=self.method.capitalize(), method=self.method, task=self.pick("tasks"),
            concept=concepts[0], concept2=concepts[1], benefit=self.r.choice(BENEFITS),
            cite=self.cite(), dataset=self.pick("datasets"), metric=self.pick("metrics"),
            baseline=self.pick("baselines"), abbr=self.abbr[1], Abbr_long=self.abbr[0],
            term=f"<i>{concepts[0]}</i>", eq=self.r.randint(1, max(eqs, 1)), pct=self.r.randint(2, 19),
            size=self.r.choice(["32", "64", "128", "256"]),
            fig_ref=f"{fig_word} {self.r.randint(1, max(figs, 1))}",
            table_ref=f"{tab_word} {tab_no}",
        )
        text = s.format(**fmt)
        return text[0].upper() + text[1:] if not text.startswith("<") else text

    def paragraph(self, kind: str, figs: int = 2, tabs: int = 1, eqs: int = 3, n: int | None = None) -> str:
        n = n or self.r.randint(4, 7)
        return " ".join(self.sentence(kind, figs, tabs, eqs) for _ in range(n))


def _roman(n: int) -> str:
    return ["", "I", "II", "III", "IV", "V", "VI"][min(n, 6)]


def build_paper(pid: str, template: str, topic: str, seed: int, *, sections: int = 5, figures: int = 2,
                tables: int = 1, equations: int = 3, footnotes: int = 0, wide_table: bool = False,
                wide_figure: bool = False, stamp: str | None = None, bullets: bool = True,
                paragraphs_per_section: tuple[int, int] = (2, 3), n_refs: int = 14,
                title_index: int = 0, code: bool = False) -> Paper:
    g = Gen(topic, seed, template, n_refs)
    r = g.r
    title = g.p["title"][title_index % len(g.p["title"])]
    authors = [(f"{r.choice(FIRST)} {r.choice(LAST)}", r.choice(AFFS)) for _ in range(r.randint(2, 4))]
    abstract = (
        f"We study {g.pick('tasks')} through the lens of the {g.pick('concepts')}. "
        f"We introduce {g.method}, which {r.choice(BENEFITS)}. "
        f"On {g.pick('datasets')}, our method improves {g.pick('metrics')} by {r.randint(3, 15)}% over {g.pick('baselines')}, "
        f"while using less compute. We also analyze the role of the {g.pick('concepts')} and release our code."
    )
    keywords = r.sample(g.p["concepts"], 3) + [g.method]
    body: list = []
    eq_pool = list(EQUATIONS)
    fig_left, tab_left, eq_left, fn_left = figures, tables, equations, footnotes

    def paras(kind: str, count: int) -> None:
        nonlocal fn_left
        for _ in range(count):
            fn = None
            if fn_left > 0 and r.random() < 0.7:
                fn = r.choice([
                    f"Throughout, we write {g.abbr[1]} for {g.abbr[0]} and use the terms interchangeably.",
                    f"Code and trained checkpoints for {g.method} are available from the authors on request.",
                    f"All reported numbers use the {g.pick('datasets')} validation split unless stated otherwise.",
                ])
                fn_left -= 1
            body.append(Para(g.paragraph(kind, figures, tables, equations), footnote=fn))

    lo, hi = paragraphs_per_section
    body.append(Heading("Introduction", 1))
    paras("intro", r.randint(lo, hi))
    if bullets:
        body.append(Bullets([
            f"A formal treatment of the {g.pick('concepts')} and its relation to the {g.pick('concepts')}.",
            f"An efficient algorithm, {g.method}, with {{cite:{r.randint(1, n_refs)}}} as a special case.",
            f"A thorough evaluation on {g.pick('datasets')} and {g.pick('datasets')}.",
        ]))
    body.append(Heading("Related Work", 1))
    paras("related", r.randint(lo, hi))
    body.append(Heading("Method", 1))
    body.append(Heading("Problem Setup", 2))
    paras("method", 1)
    for _ in range(min(equations, 2)):
        body.append(Equation(eq_pool.pop(r.randrange(len(eq_pool)))))
        eq_left -= 1
        body.append(Para("where $\\theta$ are the model parameters and $\\lambda$ weights the regularizer. " +
                         g.sentence("method", figures, tables, equations)))
    body.append(Heading("Training Objective", 2))
    paras("method", 1)
    if code:
        body.append(Code(["for step in range(num_steps):", "    batch = sampler.next()",
                          "    loss = model(batch).loss", "    loss.backward()", "    optimizer.step()"]))
    while eq_left > 0 and eq_pool:
        body.append(Equation(eq_pool.pop(r.randrange(len(eq_pool)))))
        eq_left -= 1
        body.append(Para("Here the sum runs over all $N$ training examples. " + g.sentence("method", figures, tables, equations)))
    body.append(Heading("Experiments", 1))
    paras("results", 1)
    if tab_left > 0:
        body.append(Table(
            header=["Model", g.pick("metrics").title(), g.pick("metrics").title(), "Params (M)"],
            rows=[[name, f"{r.uniform(60, 90):.1f}", f"{r.uniform(60, 90):.1f}", f"{r.randint(20, 400)}"]
                  for name in [g.method.title(), "Baseline", "Ablation", "Prior work"]],
            caption=f"Comparison on {g.pick('datasets')}; higher is better.",
            style="booktabs" if r.random() < 0.5 else "grid", wide=wide_table))
        tab_left -= 1
    paras("results", 1)
    kinds = ["line", "bar", "raster", "mixed"]
    for i in range(fig_left):
        body.append(Figure(kind=kinds[i % 4], caption=f"{g.method.capitalize()} versus {g.pick('baselines')} on {g.pick('datasets')}. "
                                                       f"The {g.pick('concepts')} is varied along the x-axis.",
                           wide=wide_figure and i == 0, height=115 if template != "arxiv" else 160))
        paras("results", 1)
    for _ in range(tab_left):
        body.append(Table(header=["Setting", "Value"], rows=[["Batch size", "128"], ["Learning rate", "3e-4"]],
                          caption="Hyperparameters used in all experiments."))
    body.append(Heading("Discussion", 1))
    paras("discussion", r.randint(1, 2))
    body.append(Heading("Conclusion", 1))
    paras("discussion", 1)
    body.append(Heading("References", 1))

    refs = []
    for _ in range(n_refs):
        names = [(r.choice(FIRST), r.choice(LAST)) for _ in range(r.randint(1, 3))]
        refs.append(Ref(authors=names, title=f"{r.choice(g.p['concepts']).capitalize()} for {r.choice(g.p['tasks'])}",
                        venue=r.choice(["Proc. ICML", "Proc. NeurIPS", "J. Mach. Learn. Res.", "Proc. ACL", "Nature Methods"]),
                        year=r.randint(2012, 2024), pages=f"{r.randint(1, 800)}–{r.randint(801, 900)}"))
    return Paper(id=pid, title=title, authors=authors, abstract=abstract, keywords=keywords, body=body,
                 references=refs, template=template, short_title=title if len(title) < 50 else title[:47] + "...",
                 stamp=stamp)
