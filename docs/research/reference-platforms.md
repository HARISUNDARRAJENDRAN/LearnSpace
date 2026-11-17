# Reference platforms: what Research mode borrows (and what it doesn't)

Studied 2026-11-16 from public pages only (no signed-in access was available in this
environment). We borrow product structure and teaching method, never content. All LearnSpace
tracks, lessons and exercises are original; papers are cited from verified metadata.

## Fanout (fanout.sh/ai)

- **Tracks** ("Choose your path"): goal-based tracks over a shared curriculum. Example "AI Researcher":
  Math → AI Intuitions → Neural Nets → Transformers → RL → LLMs → Research, labelled with
  module/lesson counts and a time estimate ("7 modules · 39 lessons · ~12 weeks").
  Each track says who it is for and what you can do after it.
- **Papers library**: about 10 headline papers, filterable by Architecture / Training & Optimization /
  Reasoning & Scaling / RAG & Retrieval / Agents / Efficiency / Foundational / "Ilya 30u30".
  Each card has a title, authors/lab, a 1–2 sentence "why it matters" claim and a category tag.
- **Lesson pattern** (PPO lesson, the model the user pointed at):
  1. Opens with a concrete scenario and question ("how much should one batch be allowed to change the model?").
  2. Uses one action and real numbers (old p=0.20, new p=0.30 → ratio 1.5).
  3. Gives the formula, then defines every symbol.
  4. "Watch where the incentive stops": walks the mechanism through its edge (clipping at 1±ε).
  5. Predict-then-reveal: "Predict the objective at ratio 0.5 and advantage −2", with a collapsed worked answer.
  6. A tiny runnable snippet (≈5 lines, CPU, prints a table) plus its expected output.
  7. A parameter-change challenge ("Change only ε to 0.1. What is the new ceiling?").
  8. A mapping table from the toy to the real system (observation/action/policy/reward in an LLM).
  9. "Inspect the actual claim": points to the exact paper section (PPO §3) and a reference implementation to compare.
  10. Explicit scope honesty: "This lesson isolates the policy term; it is not a complete PPO trainer."
  11. "Quick notes": 5–6 crisp takeaways, including common misconceptions.

## TensorTonic (tensortonic.com)

- **Research track per paper** ("Implement ML Papers From Scratch"): papers grouped by family
  (Transformers & LLMs, CNNs, Sequence models & embeddings, Generative models). Each paper is split into
  ordered steps that follow its architecture (Transformer: Tokenization → Embedding → Positional
  Encoding → Scaled Dot-Product Attention → Multi-Head Attention → FFN → LayerNorm → Encoder Block),
  with a difficulty per step (Easy/Medium/Hard) and a capstone ("Assemble and train").
  An architecture diagram sits beside the step list and highlights the component each step builds.
- **Exercise page**: step navigator ("4 / 8"), tabs (Description, Theory, Solution, Submissions, Notes),
  the formula and its shape contract, a small interactive visualisation (attention weights per
  query token), 2–3 worked examples whose explanations say *why* the output looks the way it does,
  progressive hints, requirements and constraints, a starter signature, editable test cases, Run/Submit.
- **Roadmap**: layers (Foundations → Core ML → Deep Learning → Language → Vision). Each module shows
  progress ("0 / 17"). Paper modules (Transformer, BERT, Word2Vec, ResNet, ViT) appear *after* the layers
  that teach their prerequisites.
- **llm-interview-questions (GitHub, MIT)**: 39 questions in 4 stages (Transformer foundations; Training &
  alignment; Inference & serving; Evaluation, RAG & system design). Each question maps to a concept page
  and to 1–2 small CPU practice problems (BPE, RoPE, causal mask, GQA, RMSNorm, SwiGLU, top-k MoE router,
  cross-entropy/perplexity, AdamW, warmup schedules, grad clipping, DPO loss, GRPO advantages, sampling,
  KV-cache decode, KV memory, online softmax, int8/int4 quantization, speculative sampling, BM25,
  precision@k, MinHash, Elo).

## What LearnSpace adopts

1. **Discover = goal tracks over a prerequisite graph** (Fanout tracks + TensorTonic layers): layered stages,
   per-track audience / prerequisites / outcomes / time estimate, papers placed after their prerequisites,
   multiple valid routes, and per-module progress from real session data.
2. **Paper exercises = architecture-ordered component steps** (TensorTonic): exercises follow the paper's
   own decomposition, each step is tied to a paper section and a diagram node, and each has a difficulty.
   A step exists only if it runs on CPU with small deterministic tensors; otherwise it becomes a project guide.
3. **Project/intuition guides = the Fanout lesson pattern**: concrete scenario → numbers → formula with every
   symbol defined → edge behaviour → predict-then-reveal → tiny runnable snippet with its expected output →
   parameter challenge → toy-to-real mapping → "inspect the actual claim" (exact paper section) → explicit
   scope statement → quick notes and misconceptions.
4. **Practice backs understanding**: every key concept in a paper links to a concept explanation plus at
   most two small practice problems (the interview-questions pattern).

## What LearnSpace does not adopt

- Paywalled "Pro" gating, contests and leaderboards, which aren't in scope.
- Hype-style claims on paper cards. Our "why it matters" lines must be grounded in the paper's abstract or
  verified metadata.
- Video lessons. Research mode is centred on the paper, with notes, Luny and exercises.
