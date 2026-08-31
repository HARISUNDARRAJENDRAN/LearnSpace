ALTER TABLE identity.user_settings
  ADD COLUMN onboarding_completed_at timestamptz,
  ADD COLUMN onboarding_version smallint;

INSERT INTO knowledge.concepts (id, slug, name, kind, summary, status)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'ai-machine-learning', 'AI / Machine Learning', 'domain', 'Artificial intelligence, machine learning, and intelligent systems.', 'active'),
  ('10000000-0000-4000-8000-000000000002', 'data-science', 'Data Science', 'domain', 'Data analysis, modeling, and decision-making.', 'active'),
  ('10000000-0000-4000-8000-000000000003', 'programming-computer-science', 'Programming / Computer Science', 'domain', 'Programming fundamentals, systems, and computer science.', 'active'),
  ('10000000-0000-4000-8000-000000000004', 'web-development', 'Web Development', 'domain', 'Web interfaces, applications, and the platform underneath them.', 'active'),
  ('10000000-0000-4000-8000-000000000005', 'devops-cloud', 'DevOps / Cloud', 'domain', 'Infrastructure, deployment, and reliable cloud systems.', 'active'),
  ('10000000-0000-4000-8000-000000000006', 'cybersecurity', 'Cybersecurity', 'domain', 'Security, privacy, and resilient digital systems.', 'active'),
  ('10000000-0000-4000-8000-000000000007', 'mathematics-statistics', 'Mathematics / Statistics', 'domain', 'Mathematical reasoning, probability, and statistics.', 'active'),
  ('10000000-0000-4000-8000-000000000008', 'physics', 'Physics', 'domain', 'The study of matter, energy, and the physical world.', 'active'),
  ('10000000-0000-4000-8000-000000000009', 'biology', 'Biology', 'domain', 'Life sciences and living systems.', 'active'),
  ('10000000-0000-4000-8000-000000000010', 'english-language-learning', 'English / Language Learning', 'domain', 'Language, fluency, and communication skills.', 'active'),
  ('10000000-0000-4000-8000-000000000011', 'communication-public-speaking', 'Communication / Public Speaking', 'domain', 'Clear communication, presentation, and public speaking.', 'active'),
  ('10000000-0000-4000-8000-000000000021', 'python', 'Python', 'skill', 'A general-purpose programming language.', 'active'),
  ('10000000-0000-4000-8000-000000000022', 'transformers', 'Transformers', 'concept', 'A neural architecture used widely in modern machine learning.', 'active'),
  ('10000000-0000-4000-8000-000000000023', 'large-language-models', 'Large Language Models', 'topic', 'Language models that learn patterns from large text datasets.', 'active'),
  ('10000000-0000-4000-8000-000000000024', 'linear-algebra', 'Linear Algebra', 'concept', 'Vectors, matrices, and linear transformations.', 'active'),
  ('10000000-0000-4000-8000-000000000025', 'react', 'React', 'skill', 'A library for building user interfaces.', 'active'),
  ('10000000-0000-4000-8000-000000000026', 'operating-systems', 'Operating Systems', 'topic', 'The software that manages computer hardware and programs.', 'active'),
  ('10000000-0000-4000-8000-000000000027', 'databases', 'Databases', 'topic', 'Systems for storing, querying, and organizing data.', 'active'),
  ('10000000-0000-4000-8000-000000000029', 'javascript', 'JavaScript', 'skill', 'The programming language of the web platform.', 'active'),
  ('10000000-0000-4000-8000-000000000030', 'typescript', 'TypeScript', 'skill', 'Typed JavaScript for building maintainable applications.', 'active'),
  ('10000000-0000-4000-8000-000000000031', 'docker', 'Docker', 'skill', 'Containers and reproducible application environments.', 'active'),
  ('10000000-0000-4000-8000-000000000032', 'kubernetes', 'Kubernetes', 'skill', 'Orchestration for containerized workloads.', 'active'),
  ('10000000-0000-4000-8000-000000000033', 'computer-networks', 'Computer Networks', 'topic', 'Protocols and systems that connect computers.', 'active'),
  ('10000000-0000-4000-8000-000000000034', 'technical-writing', 'Technical Writing', 'skill', 'Writing that makes complex technical ideas clear.', 'active'),
  ('10000000-0000-4000-8000-000000000035', 'public-speaking', 'Public Speaking', 'skill', 'Presenting ideas with clarity and confidence.', 'active')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  kind = EXCLUDED.kind,
  summary = EXCLUDED.summary,
  status = EXCLUDED.status,
  updated_at = now();

INSERT INTO knowledge.concept_aliases (concept_id, alias, normalized_alias, locale, source)
SELECT concepts.id, starter.alias, starter.normalized_alias, 'en', 'learnspace-starter-v1'
FROM (
  VALUES
    ('ai-machine-learning', 'AI', 'ai'),
    ('ai-machine-learning', 'ML', 'ml'),
    ('ai-machine-learning', 'Machine Learning', 'machine learning'),
    ('data-science', 'Data Analytics', 'data analytics'),
    ('programming-computer-science', 'CS', 'cs'),
    ('programming-computer-science', 'Computer Science', 'computer science'),
    ('web-development', 'Frontend', 'frontend'),
    ('web-development', 'Backend', 'backend'),
    ('devops-cloud', 'Cloud Computing', 'cloud computing'),
    ('cybersecurity', 'Security', 'security'),
    ('mathematics-statistics', 'Math', 'math'),
    ('mathematics-statistics', 'Statistics', 'statistics'),
    ('english-language-learning', 'English', 'english'),
    ('communication-public-speaking', 'Communication', 'communication'),
    ('python', 'Py', 'py'),
    ('transformers', 'Transformer Models', 'transformer models'),
    ('large-language-models', 'LLM', 'llm'),
    ('large-language-models', 'LLMs', 'llms'),
    ('linear-algebra', 'Vectors and Matrices', 'vectors and matrices'),
    ('react', 'ReactJS', 'reactjs'),
    ('operating-systems', 'OS', 'os'),
    ('databases', 'SQL', 'sql'),
    ('javascript', 'JS', 'js'),
    ('typescript', 'TS', 'ts'),
    ('kubernetes', 'K8s', 'k8s'),
    ('technical-writing', 'Documentation', 'documentation'),
    ('public-speaking', 'Presentation', 'presentation')
) AS starter(slug, alias, normalized_alias)
JOIN knowledge.concepts concepts ON concepts.slug = starter.slug
ON CONFLICT (concept_id, normalized_alias, locale) DO NOTHING;
