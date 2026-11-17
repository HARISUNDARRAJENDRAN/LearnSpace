import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { researchCurriculumSchema, type CurriculumPaper, type ResearchCurriculum } from "../../packages/shared/src/research-curriculum.js";

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(here, ".cache");
const output = join(here, "../../apps/web/lib/research/curriculum/data.json");
const userAgent = "LearnSpace/1.0 (research curriculum metadata verification)";
const now = new Date().toISOString();
const optionalIds = new Set(["1810.03993", "1404.1100", "1602.07261", "1606.03498", "1706.02262", "1804.03599", "2011.10566", "1901.02860", "1907.11692", "2009.06732", "1811.08883", "1612.03144", "2112.01527", "2301.11093", "1606.01540", "2006.05990", "2211.05100", "2403.08295", "2307.04964", "2303.11366", "2209.10652"]);

type Seed = { arxivId: string; why: string; stage: string; concepts: string[]; difficulty?: "beginner" | "intermediate" | "advanced"; required?: boolean };
const seedRows: Array<[string, string, string, string[]]> = [
  // Classical machine learning
  ["1603.02754", "XGBoost made regularized gradient tree boosting practical at scale, with a system design that exposes the cost and accuracy trade-offs.", "classical", ["gradient boosting", "regularization", "tree ensembles"]],
  ["1706.09516", "CatBoost addresses categorical features and prediction shift with ordered boosting, making its training choices the central lesson.", "classical", ["categorical features", "ordered boosting", "gradient boosting"]],
  ["1404.1100", "This tutorial develops principal component analysis from covariance structure through eigenvectors, low-rank approximation, and practical interpretation.", "classical", ["principal component analysis", "eigendecomposition", "dimensionality reduction"]],
  ["1810.03993", "Model Cards proposes a concise reporting format for intended use, evaluation conditions, and limitations of trained models.", "classical", ["model evaluation", "documentation", "responsible ML"]],
  // Neural networks and backpropagation
  ["1412.6980", "Adam combines adaptive first- and second-moment estimates into a simple stochastic optimizer that became a common neural-network baseline.", "neural", ["backpropagation", "adaptive optimization", "moment estimates"]],
  ["1502.03167", "Batch Normalization stabilizes layer input distributions during training and enables faster optimization at higher learning rates.", "neural", ["neural networks", "normalization", "optimization"]],
  ["1512.03385", "ResNet introduces identity shortcuts that let very deep convolutional networks train effectively, reframing depth as an optimization problem.", "neural", ["residual learning", "backpropagation", "convolutional networks"]],
  ["1409.1556", "VGG demonstrates the representational strength of deep networks built from repeated small convolution filters and simple design choices.", "neural", ["convolution", "depth", "feature hierarchies"]],
  ["1606.04838", "This work surveys optimization methods for large-scale machine learning, emphasizing how computational structure shapes practical optimizer choices.", "optimization", ["large-scale optimization", "stochastic gradients", "machine learning"]],
  ["1602.07261", "Inception-v4 and Inception-ResNet study efficient convolutional architectures and the effect of residual connections inside Inception modules.", "neural", ["convolutional networks", "residual connections", "architecture design"]],
  ["1706.03762", "The Transformer replaces recurrence with attention and shows that sequence modeling can be parallelized while retaining strong translation quality.", "attention", ["attention", "sequence modeling", "backpropagation"]],
  // Optimization and generalization
  ["1502.04390", "The paper analyzes how optimization and generalization interact in deep learning, arguing that successful training dynamics need not imply classical overfitting.", "optimization", ["generalization", "optimization", "deep learning theory"]],
  ["1706.02677", "The work demonstrates large-minibatch stochastic gradient descent for ImageNet and describes the linear learning-rate scaling and warmup recipe.", "optimization", ["minibatch SGD", "learning-rate scaling", "distributed training"]],
  ["1711.00165", "This work connects infinitely wide deep neural networks to Gaussian processes, providing a kernel view of network initialization and prediction.", "optimization", ["Gaussian processes", "neural tangent kernels", "wide networks"]],
  ["1803.05407", "The authors show that averaging model weights can lead to wider optima and improve generalization in deep learning.", "optimization", ["weight averaging", "loss landscape", "generalization"]],
  ["1806.07572", "The Neural Tangent Kernel characterizes gradient-descent training of wide neural networks and gives a tractable account of convergence and generalization.", "optimization", ["neural tangent kernel", "gradient descent", "generalization"]],
  ["1904.09237", "This paper analyzes convergence properties of Adam and proposes an update that addresses cases where the original method can fail to converge.", "optimization", ["Adam", "convergence", "adaptive optimization"]],
  ["1804.04235", "Adafactor reduces optimizer-state memory by factoring second-moment estimates, making adaptive optimization more practical for large models.", "optimization", ["adaptive optimization", "memory efficiency", "second moments"]],
  ["2302.06675", "Lion introduces a simple sign-based optimizer discovered through symbolic search and evaluates its memory and training trade-offs.", "optimization", ["optimizers", "sign updates", "training efficiency"]],
  ["2006.09092", "This paper studies the geometry of neural-network loss surfaces and shows how the Hessian spectrum changes during training.", "optimization", ["Hessian", "loss geometry", "training dynamics"]],
  ["2000.01412", "The work analyzes gradient descent in over-parameterized models, helping explain how interpolation can coexist with useful predictive performance.", "optimization", ["interpolation", "gradient descent", "generalization"]],
  // Representation learning
  ["1312.6114", "The Variational Autoencoder gives a scalable variational-inference objective for learning a probabilistic latent representation with neural networks.", "representation", ["variational inference", "latent variables", "autoencoders"]],
  ["1406.2661", "GANs formulate generative learning as a minimax game between a generator and discriminator, introducing an influential implicit-density approach.", "representation", ["adversarial learning", "generative models", "minimax optimization"]],
  ["1503.03585", "DCGAN identifies architectural guidelines that make convolutional GAN representations more stable and useful for image generation.", "representation", ["convolutional GAN", "representation learning", "image generation"]],
  ["1606.03498", "The paper studies practical GAN training techniques, including feature matching, minibatch discrimination, and historical averaging.", "representation", ["GAN", "feature matching", "training stability"]],
  ["1706.02262", "InfoVAE modifies the variational autoencoder objective to control mutual information and improve the informativeness of latent representations.", "representation", ["variational inference", "mutual information", "latent representations"]],
  ["1804.03599", "The authors propose a mutual-information objective for unsupervised visual representation learning, connecting augmentation-based prediction to invariance.", "representation", ["contrastive learning", "mutual information", "invariance"]],
  ["2002.05709", "SimCLR demonstrates a simple contrastive-learning framework whose performance depends strongly on augmentations, projection heads, and large batches.", "representation", ["contrastive learning", "augmentations", "self-supervision"]],
  ["2011.10566", "This work presents momentum contrast with a queue and momentum encoder, enabling contrastive visual learning with many negatives and modest batches.", "representation", ["MoCo", "contrastive learning", "visual representations"]],
  // Sequence models and NLP
  ["1301.3781", "The paper introduces efficient continuous vector representations of words and training objectives that capture useful linguistic regularities.", "sequence", ["word embeddings", "language modeling", "representation learning"]],
  ["1409.3215", "Sequence-to-sequence learning maps an input sequence to an output sequence with an encoder-decoder recurrent neural network.", "sequence", ["encoder-decoder", "RNN", "sequence transduction"]],
  ["1406.1078", "The authors introduce attention for neural machine translation so the decoder can selectively use source positions instead of a fixed-length encoding.", "sequence", ["attention", "machine translation", "alignment"]],
  ["1607.06450", "Layer Normalization normalizes hidden activations within each training example, avoiding dependence on batch statistics.", "neural", ["normalization", "recurrent networks", "training stability"]],
  ["1706.03762", "The Transformer replaces recurrence with attention and demonstrates parallel sequence transduction for machine translation.", "sequence", ["self-attention", "encoder-decoder", "sequence modeling"]],
  ["1802.05365", "ULMFiT shows how general-domain language-model pretraining can be fine-tuned effectively for text classification tasks.", "sequence", ["language model pretraining", "transfer learning", "fine-tuning"]],
  ["1810.04805", "BERT pretrains bidirectional Transformer representations and establishes a broadly reusable fine-tuning recipe for language understanding.", "sequence", ["masked language modeling", "pretraining", "bidirectional context"]],
  ["1901.02860", "Transformer-XL extends attention with recurrence and relative positional representations to model dependencies beyond a fixed segment.", "sequence", ["long context", "recurrence", "relative position"]],
  // Attention and transformer architectures
  ["1706.03762", "The original Transformer establishes scaled dot-product and multi-head self-attention as a parallel alternative to recurrent sequence models.", "attention", ["self-attention", "multi-head attention", "transformers"]],
  ["1810.04805", "BERT makes deep bidirectional Transformer pretraining a reusable foundation for language understanding tasks.", "attention", ["Transformer encoder", "masked language modeling", "fine-tuning"]],
  ["1907.11692", "RoBERTa revisits BERT's training recipe and shows that data, training duration, and optimization choices substantially affect results.", "attention", ["masked language modeling", "pretraining", "training recipes"]],
  ["2001.08361", "The paper studies scaling laws for language models, relating model size, data, and compute to predictable loss trends.", "attention", ["scaling laws", "language models", "compute allocation"]],
  ["1910.10683", "T5 frames NLP tasks as text-to-text problems and compares transfer-learning objectives and model scales in one unified setup.", "attention", ["text-to-text", "transfer learning", "encoder-decoder"]],
  ["2003.10555", "ELECTRA trains a discriminator to identify replaced tokens, obtaining an efficient alternative to masked-language-model pretraining.", "attention", ["replaced-token detection", "pretraining", "sample efficiency"]],
  ["2004.05150", "Longformer combines local windowed attention with task-driven global attention to handle longer documents efficiently.", "attention", ["sparse attention", "long documents", "transformers"]],
  ["2009.06732", "This survey organizes efficient Transformer variants by how they reduce attention's compute or memory cost on long sequences.", "attention", ["efficient attention", "long context", "Transformer variants"]],
  // Computer vision
  ["2010.11929", "Vision Transformer applies a standard Transformer to image patches and shows that large-scale pretraining can make this design competitive.", "vision", ["vision transformer", "patch embeddings", "image classification"]],
  ["2103.14030", "Swin Transformer uses shifted windows to build hierarchical visual features with attention whose cost scales linearly with image size.", "vision", ["shifted-window attention", "hierarchical vision", "efficient vision"]],
  ["2201.03545", "ConvNeXt modernizes a pure convolutional architecture using design choices informed by contemporary Transformer networks.", "vision", ["convolutional networks", "architecture design", "image classification"]],
  ["1708.02002", "Focal Loss reshapes dense object-detection training to focus on hard examples under severe foreground-background class imbalance.", "vision", ["object detection", "focal loss", "class imbalance"]],
  ["1506.02640", "You Only Look Once formulates object detection as a single regression problem, enabling fast end-to-end prediction from an image.", "vision", ["object detection", "single-stage detectors", "real-time inference"]],
  ["1605.06409", "R-FCN uses position-sensitive score maps to share most computation across regions while retaining localization for object detection.", "vision", ["object detection", "region-based fully convolutional networks", "position-sensitive pooling"]],
  ["1811.08883", "This study revisits ImageNet pretraining and reports how pretraining choices affect transfer to downstream vision tasks.", "vision", ["transfer learning", "ImageNet", "pretraining"]],
  ["1804.02767", "YOLOv3 improves a one-stage detector with multi-scale predictions and a stronger feature extractor while preserving fast inference.", "vision", ["object detection", "multi-scale prediction", "real-time inference"]],
  ["1904.07850", "Objects as Points formulates object detection as predicting object centers and regressing their attributes from a heatmap.", "vision", ["object detection", "keypoints", "center-based detection"]],
  ["1703.06870", "Mask R-CNN adds a parallel mask-prediction branch to object detection and extends the region-based framework to instance segmentation.", "vision", ["instance segmentation", "object detection", "region proposals"]],
  ["1612.03144", "Feature Pyramid Networks build semantically strong multi-scale feature maps with a top-down pathway and lateral connections for object detection.", "vision", ["feature pyramids", "object detection", "multi-scale features"]],
  ["2012.12877", "DeiT shows that data-efficient training and distillation can make vision Transformers work well without massive private datasets.", "vision", ["vision transformers", "distillation", "data-efficient training"]],
  ["2112.01527", "Mask2Former unifies several image-segmentation tasks with masked attention over image features and predicted regions.", "vision", ["image segmentation", "masked attention", "unified architecture"]],
  // Generative models and diffusion
  ["2006.11239", "DDPM connects denoising diffusion training to variational inference and shows high-quality image generation through a simple noise-prediction objective.", "generative", ["diffusion", "denoising", "generative modeling"]],
  ["2011.13456", "The score-SDE framework unifies discrete and continuous diffusion models and derives sampling methods from stochastic differential equations.", "generative", ["score matching", "SDE", "diffusion"]],
  ["2112.10752", "Latent Diffusion moves denoising into a learned perceptual latent space, reducing compute while retaining high-resolution synthesis quality.", "generative", ["latent diffusion", "perceptual compression", "text-to-image"]],
  ["2205.11487", "Photorealistic Text-to-Image Diffusion Models with Deep Language Understanding scales a language encoder and cascaded diffusion for text-conditioned image synthesis.", "generative", ["text-to-image", "cascaded diffusion", "language conditioning"]],
  ["2211.01324", "eDiff-I uses an ensemble of expert denoisers specialized to different noise ranges to improve text-to-image diffusion quality.", "generative", ["diffusion", "expert denoisers", "text-to-image"]],
  ["2301.11093", "Simple Diffusion studies an end-to-end diffusion design for high-resolution generation, including choices that simplify the model pipeline.", "generative", ["diffusion", "high-resolution generation", "sampling"]],
  ["2206.00364", "Elucidating the Design Space analyzes diffusion parameterizations, noise schedules, and samplers to clarify quality and speed trade-offs.", "generative", ["diffusion design", "sampling", "noise schedules"]],
  ["2102.09672", "Improved DDPM proposes learned reverse-process variances and a new schedule to improve diffusion likelihoods and sampling efficiency.", "generative", ["diffusion", "variance learning", "sampling"]],
  // Reinforcement learning
  ["1312.5602", "The DQN work combines deep convolutional perception with Q-learning and replay to learn control policies directly from Atari pixels.", "rl", ["Q-learning", "experience replay", "value functions"]],
  ["1509.02971", "This paper introduces deep deterministic policy gradients for continuous control, combining an actor-critic method with replay and target networks.", "rl", ["DDPG", "continuous control", "actor-critic"]],
  ["1707.06347", "PPO constrains policy updates with a clipped surrogate objective, making repeated minibatch optimization practical for policy-gradient learning.", "rl", ["policy gradients", "clipped objective", "on-policy RL"]],
  ["1801.01290", "Soft Actor-Critic derives a maximum-entropy off-policy actor-critic algorithm that balances reward and policy entropy.", "rl", ["maximum entropy RL", "actor-critic", "off-policy learning"]],
  ["1802.09477", "TD3 addresses value overestimation in continuous control with clipped double critics, delayed policy updates, and target smoothing.", "rl", ["continuous control", "actor-critic", "overestimation"]],
  ["1606.01540", "OpenAI Gym provides a common toolkit and benchmark interface for comparing reinforcement-learning algorithms across environments.", "rl", ["RL environments", "benchmarking", "reproducibility"]],
  ["2106.01345", "Decision Transformer treats offline reinforcement learning as conditional sequence modeling over states, actions, and desired returns.", "rl", ["offline RL", "sequence modeling", "return conditioning"]],
  ["2006.05990", "This large-scale empirical study tests implementation and hyperparameter choices that matter for on-policy reinforcement-learning results.", "rl", ["on-policy RL", "empirical evaluation", "reproducibility"]],
  ["2004.07219", "D4RL provides benchmark tasks for offline reinforcement learning and highlights dataset quality and evaluation challenges.", "rl", ["offline RL", "benchmarks", "dataset shift"]],
  // LLM pretraining and scaling
  ["2005.14165", "GPT-3 demonstrates that scaling autoregressive language models improves few-shot task performance through in-context examples.", "llm", ["in-context learning", "few-shot learning", "scaling"]],
  ["2203.15556", "Chinchilla argues that compute-optimal language-model training requires scaling tokens alongside parameters, revising common model-size choices.", "llm", ["compute-optimal training", "data scaling", "language models"]],
  ["2204.02311", "PaLM studies scaling a dense decoder-only language model and reports performance across reasoning, multilingual, and code tasks.", "llm", ["language model scaling", "reasoning", "multilingual models"]],
  ["2211.05100", "BLOOM documents the training and release of a multilingual large language model, including its data governance and evaluation approach.", "llm", ["multilingual language models", "pretraining", "data governance"]],
  ["2205.01068", "OPT presents a family of openly available decoder-only language models and documents reproducible training and evaluation choices.", "llm", ["language models", "reproducibility", "scaling"]],
  ["2302.13971", "The LLaMA family reports strong results from training dense language models on more tokens, emphasizing data and training efficiency.", "llm", ["language models", "scaling", "open models"]],
  ["2307.09288", "Llama 2 documents a family of pretrained and instruction-tuned models and reports its data, safety, and evaluation methodology.", "llm", ["pretraining", "instruction tuning", "evaluation"]],
  ["2310.06825", "Mistral 7B combines grouped-query attention and sliding-window attention and reports strong performance at a compact model scale.", "llm", ["grouped-query attention", "sliding window", "language models"]],
  ["2312.11805", "Gemini reports a family of multimodal models trained to understand and combine text, image, audio, video, and code inputs.", "llm", ["multimodal pretraining", "language models", "evaluation"]],
  ["2403.08295", "Gemma presents openly available lightweight language models and describes training data, evaluation, and responsible-use guidance.", "llm", ["language models", "training data", "evaluation"]],
  ["1910.10683", "T5 provides a controlled comparison of transfer-learning objectives and scales in a text-to-text language-model framework.", "llm", ["pretraining objectives", "transfer learning", "scaling"]],
  // Alignment and post-training
  ["2203.02155", "InstructGPT studies supervised demonstrations and human-feedback reinforcement learning as a way to make language models follow instructions.", "alignment", ["RLHF", "instruction following", "human preference"]],
  ["2212.08073", "Constitutional AI uses written principles and AI feedback to supervise and align assistants while reducing dependence on human labels.", "alignment", ["AI feedback", "preference learning", "constitutional principles"]],
  ["2305.18290", "DPO derives a direct preference-optimization objective that fits a preference model without a separate online RL loop.", "alignment", ["preference optimization", "KL regularization", "RLHF"]],
  ["2402.03300", "DeepSeekMath introduces GRPO, a group-relative policy optimization method, and applies it to mathematical reasoning in language models.", "alignment", ["GRPO", "reasoning", "policy optimization"]],
  ["2309.00267", "RLAIF vs. RLHF compares AI feedback and human feedback as sources of preference supervision for reinforcement learning from feedback.", "alignment", ["RLAIF", "AI feedback", "preference modeling"]],
  ["2402.14740", "This paper revisits REINFORCE-style policy optimization for human-feedback language-model training and evaluates a simpler alternative to PPO.", "alignment", ["policy gradients", "RLHF", "REINFORCE"]],
  ["2405.14734", "SimPO proposes a reference-free preference-optimization objective with length-normalized rewards for aligning language models.", "alignment", ["SimPO", "preference learning", "reference-free alignment"]],
  ["2307.04964", "The paper examines reward-model overoptimization and proposes a proxy-aware approach to reduce failures from optimizing imperfect preferences.", "alignment", ["reward models", "overoptimization", "preference alignment"]],
  // Efficient training and inference
  ["2205.14135", "FlashAttention uses IO-aware tiling to compute exact attention with less high-bandwidth-memory traffic and lower memory use.", "efficient", ["attention", "IO complexity", "GPU kernels"]],
  ["2309.06180", "PagedAttention manages the KV cache in non-contiguous blocks, enabling higher-throughput LLM serving through virtual-memory-inspired allocation.", "efficient", ["KV cache", "LLM serving", "memory management"]],
  ["2305.13245", "Grouped-Query Attention shares key-value heads across query groups to reduce autoregressive inference cost while retaining quality.", "efficient", ["GQA", "attention", "inference efficiency"]],
  ["1911.02150", "Multi-Query Attention shares keys and values across attention heads to reduce memory bandwidth during incremental decoding.", "efficient", ["MQA", "decoding", "memory bandwidth"]],
  ["2210.17323", "GPTQ presents post-training weight quantization using approximate second-order information to compress large language models.", "efficient", ["quantization", "GPTQ", "post-training compression"]],
  ["2306.00978", "AWQ protects salient weights during low-bit quantization and demonstrates efficient inference for large language models.", "efficient", ["quantization", "activation-aware scaling", "inference"]],
  ["2211.17192", "Speculative decoding uses a small draft model to propose tokens that a larger target model verifies in parallel without changing output distributions.", "efficient", ["speculative decoding", "sampling", "latency"]],
  ["2106.09685", "LoRA reduces fine-tuning memory and trainable parameters with low-rank weight updates that can be merged into the base model.", "efficient", ["LoRA", "parameter-efficient fine-tuning", "low-rank adaptation"]],
  // Retrieval and agents
  ["2005.11401", "RAG combines parametric generation with a retrieved non-parametric memory, grounding generation in external passages.", "retrieval", ["retrieval-augmented generation", "dense retrieval", "grounded generation"]],
  ["2004.04906", "Dense Passage Retrieval trains dual encoders for open-domain question answering and establishes a strong learned retrieval baseline.", "retrieval", ["dense retrieval", "dual encoders", "question answering"]],
  ["2004.12832", "ColBERT uses late interaction between contextualized query and document tokens to balance retrieval effectiveness and indexability.", "retrieval", ["late interaction", "retrieval", "ranking"]],
  ["2212.10496", "This work studies zero-shot dense retrieval without relevance labels and examines pseudo-relevance feedback for improving ranking.", "retrieval", ["zero-shot retrieval", "pseudo-relevance feedback", "dense retrieval"]],
  ["2210.03629", "ReAct interleaves reasoning traces with actions, showing how language models can use tools and observations in a loop.", "retrieval", ["tool use", "reasoning", "agents"]],
  ["2302.04761", "Toolformer explores self-supervised tool-use learning by letting a language model decide when and how to call APIs.", "retrieval", ["tool use", "API calling", "self-supervision"]],
  ["2303.11366", "Reflexion uses verbal feedback and episodic memory to improve an agent's future decisions without updating model weights.", "retrieval", ["agent memory", "reflection", "planning"]],
  ["2305.15334", "Gorilla studies retrieval-aware API selection and fine-tuning for language models that need to call rapidly changing tools.", "retrieval", ["API calling", "retrieval", "tool use"]],
  // Multimodal
  ["2103.00020", "CLIP learns transferable image representations from natural-language supervision collected at scale.", "multimodal", ["contrastive learning", "vision-language", "zero-shot transfer"]],
  ["2204.14198", "Flamingo connects frozen vision and language models with gated cross-attention to support few-shot multimodal tasks.", "multimodal", ["cross-attention", "few-shot learning", "vision-language"]],
  ["2301.12597", "BLIP-2 bridges frozen image encoders and language models with a lightweight Querying Transformer.", "multimodal", ["Q-Former", "vision-language", "frozen models"]],
  ["2304.08485", "LLaVA instruction-tunes a language model on multimodal conversations generated from image-text data.", "multimodal", ["visual instruction tuning", "vision-language", "multimodal dialogue"]],
  ["2305.05665", "ImageBind learns a shared embedding space across six modalities using image-paired data as the binding signal.", "multimodal", ["joint embedding", "multimodal learning", "contrastive learning"]],
  ["2308.12966", "Qwen-VL studies visual-language alignment and resolution handling for general-purpose image understanding and dialogue.", "multimodal", ["visual grounding", "OCR", "vision-language models"]],
  ["2303.15343", "SigLIP replaces the global contrastive softmax with a pairwise sigmoid loss for language-image pretraining.", "multimodal", ["vision-language", "contrastive learning", "sigmoid loss"]],
  ["2311.10122", "Video-LLaVA aligns visual representations from images and video to support unified video-language understanding.", "multimodal", ["video understanding", "visual alignment", "multimodal models"]],
  // Advanced topics
  ["1609.02907", "The graph convolutional network paper applies localized spectral graph convolutions to semi-supervised node classification.", "advanced", ["graph neural networks", "semi-supervised learning", "message passing"]],
  ["1706.02216", "GraphSAGE learns an inductive neighborhood-aggregation function so embeddings can be generated for unseen nodes.", "advanced", ["inductive learning", "graph neural networks", "neighborhood aggregation"]],
  ["1710.10903", "Graph Attention Networks use masked self-attention to weight neighborhood messages in graph representation learning.", "advanced", ["graph attention", "message passing", "graph learning"]],
  ["1701.06538", "The sparsely-gated mixture-of-experts layer increases model capacity through conditional computation and learned expert routing.", "advanced", ["mixture of experts", "conditional computation", "sparsity"]],
  ["2101.03961", "Switch Transformers simplify sparse expert routing and demonstrate scaling language-model capacity with modest additional compute.", "advanced", ["sparse experts", "routing", "scaling"]],
  ["2401.06066", "DeepSeekMoE studies fine-grained expert segmentation and shared experts to improve specialization and parameter efficiency.", "advanced", ["mixture of experts", "expert specialization", "routing"]],
  ["2209.10652", "This paper analyzes superposition in neural networks, explaining how models can represent more features than they have dimensions.", "advanced", ["mechanistic interpretability", "superposition", "feature representations"]],
  ["2106.09685", "LoRA demonstrates that low-rank adaptation can match full fine-tuning on multiple tasks while substantially reducing trainable parameters.", "advanced", ["parameter-efficient adaptation", "low-rank methods", "fine-tuning"]],
];
const seeds: Seed[] = seedRows.map(([arxivId, why, stage, concepts]) => ({ arxivId, why, stage, concepts })).filter((seed, index, all) => all.findIndex((candidate) => candidate.arxivId === seed.arxivId) === index);

const stages = [
  ["math", "Mathematical foundations"], ["classical", "Classical machine learning"], ["neural", "Neural networks and backpropagation"], ["optimization", "Optimization and generalization"], ["representation", "Representation learning"], ["sequence", "Sequence models and NLP"], ["attention", "Attention and Transformers"], ["vision", "Computer vision"], ["generative", "Generative models and diffusion"], ["rl", "Reinforcement learning"], ["llm", "LLMs: pretraining and scaling"], ["alignment", "Alignment and post-training"], ["efficient", "Efficient training and inference"], ["retrieval", "Retrieval and agents"], ["multimodal", "Multimodal learning"], ["advanced", "Advanced topics"],
].map(([id, title], order) => ({ id, title, order }));
const prerequisiteStage: Record<string, string> = { neural: "classical", optimization: "neural", representation: "optimization", sequence: "neural", attention: "sequence", vision: "neural", generative: "representation", rl: "optimization", llm: "attention", alignment: "llm", efficient: "llm", retrieval: "llm", multimodal: "llm", advanced: "optimization" };

const conceptSeeds = [
  ["math-linear-algebra", "Linear algebra", "Vectors, matrices, eigenvectors, and matrix factorizations make model representations and transformations easier to reason about."],
  ["math-probability", "Probability and statistics", "Random variables, likelihood, expectation, and uncertainty underpin estimation, loss functions, and evaluation."],
  ["math-calculus", "Calculus and gradients", "Derivatives, chain rule, and gradients explain how backpropagation computes parameter updates."],
  ["math-optimization", "Optimization basics", "Objective functions, constraints, and gradient descent provide the language for fitting machine-learning models."],
];

const foundationStages = ["math", "classical", "neural", "optimization", "representation"];
const trackSpecs = [
  { id: "ml-foundations", title: "ML research foundations (beginner)", requires: [] as string[], stages: ["math", "classical", "neural", "optimization", "representation"], audience: "Learners beginning ML who want a grounded route from mathematical tools to modern learned representations.", assumptions: ["Comfort with algebra; calculus and probability can be learned alongside the track."], outcomes: ["Explain core supervised-learning and neural-network ideas", "Read foundational ML papers and identify their claims", "Choose a next specialization based on learned concepts"], hours: 36, next: ["transformers-llms", "computer-vision", "generative-diffusion", "reinforcement-learning"] },
  { id: "transformers-llms", title: "Transformers & LLMs", requires: ["ml-foundations"], stages: ["sequence", "attention", "llm", "alignment", "efficient"], audience: "Learners who want to understand language-model architecture, pretraining, post-training, and serving.", assumptions: ["Basic Python", "Linear algebra and gradient descent, or completion of ML research foundations"], outcomes: ["Trace a Transformer language-model pipeline", "Compare pretraining and alignment objectives", "Explain the main compute and memory trade-offs in inference"], hours: 42, next: ["retrieval-agents", "multimodal", "efficient-inference"] },
  { id: "reinforcement-learning", title: "Reinforcement learning to RLHF/GRPO", requires: ["ml-foundations"], stages: ["sequence", "attention", "llm", "rl", "alignment"], audience: "Learners moving from value-based and policy-gradient RL toward preference optimization for language models.", assumptions: ["Probability and neural-network training basics"], outcomes: ["Compare value-based, policy-gradient, and offline RL", "Explain PPO and group-relative optimization", "Describe how feedback objectives connect to assistant alignment"], hours: 34, next: ["transformers-llms", "efficient-inference"] },
  { id: "generative-diffusion", title: "Generative models & diffusion", requires: ["ml-foundations"], stages: ["generative"], audience: "Learners interested in the foundations and modern design choices behind generative models.", assumptions: ["Probability, neural networks, and basic optimization"], outcomes: ["Contrast adversarial, latent-variable, and diffusion approaches", "Explain denoising objectives and sampling", "Identify the role of latent spaces and guidance"], hours: 31, next: ["computer-vision", "multimodal"] },
  { id: "computer-vision", title: "Computer vision", requires: ["ml-foundations"], stages: ["vision"], audience: "Learners who want a route through image recognition, detection, segmentation, and modern vision Transformers.", assumptions: ["Basic neural-network and optimization concepts"], outcomes: ["Explain convolutional and attention-based vision models", "Compare classification, detection, and segmentation architectures", "Interpret compute-aware vision design choices"], hours: 30, next: ["generative-diffusion", "multimodal"] },
  { id: "efficient-inference", title: "Efficient inference", requires: ["ml-foundations"], stages: ["attention", "llm", "efficient"], audience: "Practitioners focused on reducing LLM inference latency, memory use, or serving cost.", assumptions: ["Transformer basics and familiarity with GPU memory concepts"], outcomes: ["Explain KV-cache and attention bottlenecks", "Compare quantization and speculative decoding", "Reason about memory-aware serving techniques"], hours: 24, next: ["retrieval-agents", "multimodal"] },
  { id: "retrieval-agents", title: "Retrieval & agents", requires: ["ml-foundations"], stages: ["sequence", "attention", "llm", "retrieval"], audience: "Builders studying retrieval-augmented generation, tool use, and agent reasoning loops.", assumptions: ["Language-model and embedding basics"], outcomes: ["Describe dense retrieval and late interaction", "Trace a retrieval-augmented generation pipeline", "Compare tool-use and reflection patterns in agents"], hours: 26, next: ["multimodal", "efficient-inference"] },
  { id: "multimodal", title: "Multimodal learning", requires: ["ml-foundations"], stages: ["attention", "llm", "vision", "multimodal"], audience: "Learners exploring systems that connect images, video, and language.", assumptions: ["Basic vision and Transformer concepts"], outcomes: ["Explain shared embedding and cross-attention approaches", "Compare multimodal pretraining and instruction tuning", "Identify alignment and evaluation challenges"], hours: 30, next: ["retrieval-agents", "efficient-inference"] },
];

const concepts = conceptSeeds.map(([id, title, why]) => ({ id, stageId: "math", type: "concept" as const, title, why, difficulty: "beginner" as const, keyConcepts: [title], prerequisites: id === "math-optimization" ? ["math-calculus", "math-linear-algebra"] : [], required: true, codingApplicability: "cpu-plausible" as const }));

function unescapeXml(text: string): string {
  return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}
function tag(block: string, name: string): string | null {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`));
  return match ? unescapeXml(match[1].trim().replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")) : null;
}
function parseEntry(xml: string) {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((x) => x[1]);
  return entries.map((entry) => {
    const id = entry.match(/<id>https?:\/\/arxiv\.org\/abs\/(\d{4}\.\d{4,5})/i)?.[1];
    const title = tag(entry, "title");
    const published = tag(entry, "published");
    const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g)].map((x) => unescapeXml(x[1].trim()));
    const doi = tag(entry, "arxiv:doi");
    const venue = tag(entry, "arxiv:journal_ref");
    if (!id || !title || !published || authors.length === 0) return null;
    return { id, title, authors, year: Number(published.slice(0, 4)), doi, venue };
  }).filter((x): x is NonNullable<typeof x> => x !== null);
}
async function fetchMetadata(ids: string[]) {
  await mkdir(cacheDir, { recursive: true });
  const records = new Map<string, ReturnType<typeof parseEntry>[number]>();
  const uncached: string[] = [];
  for (const id of ids) {
    try { records.set(id, JSON.parse(await readFile(join(cacheDir, `${id}.json`), "utf8"))); }
    catch { uncached.push(id); }
  }
  for (let start = 0; start < uncached.length; start += 10) {
    const batch = uncached.slice(start, start + 10);
    const url = `https://export.arxiv.org/api/query?id_list=${batch.join(",")}`;
    const response = await fetch(url, { headers: { "User-Agent": userAgent } });
    if (!response.ok) throw new Error(`arXiv API returned ${response.status}`);
    const found = parseEntry(await response.text());
    for (const record of found) {
      records.set(record.id, record);
      await writeFile(join(cacheDir, `${record.id}.json`), JSON.stringify(record, null, 2));
    }
    if (start + 10 < uncached.length) await new Promise((resolve) => setTimeout(resolve, 3500));
  }
  return records;
}

function buildTracks(availableIds: Set<string>) {
  return trackSpecs.map((track) => ({
    id: track.id, title: track.title, audience: track.audience, assumedKnowledge: track.assumptions,
    outcomes: track.outcomes, estimatedHours: track.hours, nextTrackIds: track.next, prerequisiteTrackIds: track.requires,
    modules: [...new Set(track.stages.flatMap((stageId) => {
      const ancestors: string[] = [];
      // Stages a prerequisite track teaches are not repeated here; the track links to it instead.
      const covered = (stage: string) => track.stages.includes(stage) || (track.requires.length > 0 && foundationStages.includes(stage));
      let parent = prerequisiteStage[stageId];
      while (parent && !covered(parent)) { ancestors.push(parent); parent = prerequisiteStage[parent]; }
      return [stageId, ...ancestors];
    }))].sort((a, b) => stages.find((stage) => stage.id === a)!.order - stages.find((stage) => stage.id === b)!.order).map((stageId) => ({ id: `${track.id}-${stageId}`, title: stages.find((stage) => stage.id === stageId)!.title, stageId, itemIds: [...concepts.filter((item) => stageId === "math").map((item) => item.id), ...seeds.filter((item) => item.stage === stageId && availableIds.has(item.arxivId)).map((item) => `arxiv:${item.arxivId}`)] })).filter((module) => module.itemIds.length > 0),
  }));
}

async function main() {
  const ids = [...new Set(seeds.map((seed) => seed.arxivId))];
  const source = await fetchMetadata(ids);
  const verified: CurriculumPaper[] = [];
  const removed: string[] = [];
  const stageAnchor = new Map<string, string>();
  for (const seed of seeds) {
  const record = source.get(seed.arxivId);
  if (!record || record.id !== seed.arxivId || !record.title || !record.authors.length || !Number.isInteger(record.year)) { removed.push(seed.arxivId); continue; }
  const priorStage = stages.find((stage) => stage.id === seed.stage)?.order ?? 0;
  const prereqs: string[] = [];
  const parentId = prerequisiteStage[seed.stage] ? stageAnchor.get(prerequisiteStage[seed.stage]) : undefined;
  if (parentId) prereqs.push(parentId);
  const item: CurriculumPaper = {
    id: `arxiv:${record.id}`, stageId: seed.stage, type: "paper", arxivId: record.id, doi: record.doi,
    title: record.title, authors: record.authors, year: record.year, venue: record.venue,
    url: `https://arxiv.org/abs/${record.id}`, verifiedAt: now, verifiedSource: "arXiv API",
    why: seed.why,
    difficulty: seed.difficulty ?? (priorStage < 6 ? "intermediate" : "advanced"), keyConcepts: seed.concepts,
    prerequisites: prereqs, required: seed.required ?? !optionalIds.has(record.id),
    codingApplicability: ["1603.02754", "1412.6980", "1502.03167", "1707.06347", "2006.11239", "2205.14135"].includes(record.id) ? "cpu-plausible" : "project-guide",
  };
    verified.push(item);
    if (!stageAnchor.has(seed.stage)) stageAnchor.set(seed.stage, item.id);
  }
  const availableIds = new Set(verified.map((paper) => paper.arxivId));
  const curriculum: ResearchCurriculum = researchCurriculumSchema.parse({ version: 1, stages, items: [...concepts, ...verified], tracks: buildTracks(availableIds).map((track) => {
    // About 45 minutes per paper read for its key sections, and 30 per concept refresher.
    const ids = track.modules.flatMap((module) => module.itemIds);
    return { ...track, estimatedHours: Math.max(2, Math.round(ids.filter((id) => id.startsWith("arxiv:")).length * 0.75 + ids.filter((id) => !id.startsWith("arxiv:")).length * 0.5)) };
  }) });

  let existing: ResearchCurriculum | undefined;
  try { existing = researchCurriculumSchema.parse(JSON.parse(await readFile(output, "utf8"))); } catch { /* first build */ }
  if (existing && !process.argv.includes("--write")) {
    const indexed = new Map(existing.items.filter((item) => item.type === "paper").map((paper) => [paper.arxivId, paper]));
    for (const paper of curriculum.items.filter((item): item is CurriculumPaper => item.type === "paper")) {
      const current = indexed.get(paper.arxivId);
    if (!current || current.title !== paper.title || current.year !== paper.year || JSON.stringify(current.authors) !== JSON.stringify(paper.authors) || current.doi !== paper.doi || current.venue !== paper.venue || current.id !== `arxiv:${paper.arxivId}`) {
        throw new Error(`Committed metadata does not match arXiv for ${paper.arxivId}; run with --write to replace the dataset after reviewing source metadata.`);
      }
    }
  if (indexed.size !== curriculum.items.filter((item) => item.type === "paper").length) throw new Error("Committed paper identifiers do not match the verified candidate set; run with --write after reviewing removals.");
  }
  if (process.argv.includes("--write")) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(curriculum, null, 2)}\n`);
  }
  console.log(JSON.stringify({ verified: verified.length, removed: removed.length, removedIds: removed, totalTrackCount: curriculum.tracks.length, datasetWritten: process.argv.includes("--write") }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
