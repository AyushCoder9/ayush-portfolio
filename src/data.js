// Everything that is about Ayush lives here. The world reads from this file.

export const PERSON = {
  name: 'Ayush Kumar Singh',
  short: 'Ayush Singh',
  initials: 'AS',
  email: 'ayushkumar1699@gmail.com',
  location: 'Pune, India',
};

/** The six chapters, in scroll order. */
export const CHAPTERS = [
  {
    id: 'origin',
    title: 'One person',
    line: 'AI engineer and full-stack developer. Models, backends, interfaces and infra — I build all of it.',
  },
  { id: 'memory', title: 'Software as we know it is dead', line: '' },
  {
    id: 'refraction',
    title: 'A new frame of mind',
    line: 'Every layer of the stack, one frame.',
  },
  {
    id: 'work',
    title: 'The work',
    line: 'Agents, ML systems, payments infra, iOS. Explore six featured projects, or visit the complete work archive.',
  },
  {
    id: 'threshold',
    title: 'Shipped',
    line: 'Live factory dashboards, autonomous agents, payments infra. And sites like this one.',
    stats: [
      ['Top 2%', 'of 134,421 applicants — Amazon ML Summer School ’26'],
      ['2× podium', 'IIT Kanpur Techkriti · Hyperlume GameDev'],
    ],
  },
  {
    id: 'network',
    title: 'What’s next',
    line: 'Bring the idea. I’ll take it from model to launch.',
    stats: [
      ['9.26', 'CGPA · B.Tech CS (AI & ML)'],
      ['15', 'projects in the work archive'],
    ],
  },
];

/** Labels that pin themselves to the glass frame in chapter 03. */
export const DISCIPLINES = ['Machine learning', 'LLM agents', 'Backend systems', 'Full-stack', 'iOS'];

const GH = 'https://github.com/AyushCoder9';

/** Featured work — one glass panel each in chapter 04. */
export const PROJECTS = [
  {
    id: 'repopilot',
    name: 'RepoPilot',
    tag: 'AI agents · RAG · Observability',
    color: '#3fe0c0',
    desc: 'An autonomous GitHub triage and review engine. An 8-stage LangGraph pipeline over hybrid RAG (pgvector, HNSW, BM25, Cohere rerank), a Redis circuit breaker failing over between Groq and Gemini, prompt-injection defences, full OpenTelemetry tracing and an MCP server for Claude Desktop — gated by 129 tests and 26 red-team evals.',
    stack: ['LangGraph', 'FastAPI', 'Next.js 15', 'pgvector', 'Redis', 'OpenTelemetry', 'MCP'],
    code: `${GH}/RepoPilot`,
    live: 'https://repopilot-steel.vercel.app/',
    media: ['/media/work/repopilot-1.jpg', '/media/work/repopilot-2.jpg'],
  },
  {
    id: 'paritylab',
    name: 'ParityLab',
    tag: 'Go · Payments · Distributed systems',
    color: '#7b6bff',
    desc: 'A continuous-verification control plane for Stripe integrations. It injects duplicate webhooks and out-of-order deliveries to prove state converges — a framework-less Go control plane, transactional outbox, HMAC verification and SSE, with Playwright, contract tests and hard container restarts in CI.',
    stack: ['Go 1.26', 'PostgreSQL 18', 'Next.js 16', 'Stripe API', 'SSE', 'Docker', 'Playwright'],
    code: `${GH}/ParityLab`,
    live: 'https://parity-lab-black.vercel.app/',
    media: ['/media/work/paritylab-1.jpg', '/media/work/paritylab-2.jpg'],
  },
  {
    id: 'clearswap',
    name: 'ClearSwap',
    tag: 'iOS · Swift 6 · Apple Wallet',
    color: '#ff3a5c',
    desc: 'A SwiftUI peer-to-peer escrow and wallet prototype exploring actor isolation, proximity interfaces, Face ID and PassKit. Wallet preview and release validation remain prototype features.',
    stack: ['Swift 6', 'SwiftUI', 'SwiftData', 'PassKit', 'ActivityKit', 'MapKit'],
    code: `${GH}/ClearSwap`,
    live: 'https://clear-swap.vercel.app/',
    media: ['/media/work/clearswap-1.jpg', '/media/work/clearswap-2.jpg'],
  },
  {
    id: 'yieldguard',
    name: 'YieldGuard',
    tag: 'ML · Predictive maintenance',
    color: '#ffb020',
    desc: 'An industrial predictive-maintenance project exploring sensor feature engineering, XGBoost, drift monitoring and SHAP explanations. Reported training metrics should be interpreted with the project’s data and evaluation boundaries.',
    stack: ['Python', 'XGBoost', 'Optuna', 'SHAP', 'FastAPI', 'Docker'],
    code: `${GH}/YieldGuard`,
    live: 'https://yield-guard-nine.vercel.app/',
    media: ['/media/work/yieldguard-1.jpg', '/media/work/yieldguard-2.jpg'],
  },
  {
    id: 'contralegal',
    name: 'ContraLegal AI',
    tag: 'NLP · Legal-BERT · Explainable AI',
    color: '#3b7bff',
    desc: 'A contract-analysis workflow combining PDF extraction, spaCy PII masking, hybrid ML and rule-based risk scoring, clause clustering, retrieval and LLM-assisted explanations. The reviewed checkout falls back to a Random Forest model.',
    stack: ['Legal-BERT', 'spaCy', 'scikit-learn', 'LangChain', 'FAISS', 'Streamlit'],
    code: `${GH}/ContraLegal-AI`,
    live: 'https://contralegal-ai.streamlit.app/',
    media: ['/media/work/contralegal-1.jpg', '/media/work/contralegal-2.jpg'],
  },
  {
    id: 'voicetutor',
    name: 'VoiceTutor',
    tag: 'Voice AI · Real-time audio',
    color: '#c45cff',
    desc: 'A voice-first Spanish tutor exploring conversational audio with Pipecat and WebSockets, a finite-state lesson manager and spaced vocabulary reviews.',
    stack: ['FastAPI', 'Next.js', 'WebSockets', 'Pipecat', 'Groq', 'Silero VAD'],
    code: `${GH}/VoiceTutor`,
    live: 'https://voicetutor-six.vercel.app/',
    media: ['/media/work/voicetutor-1.jpg', '/media/work/voicetutor-2.jpg'],
  },
];

/** Everything else, scrolling past on the LED columns in chapter 06. */
export const MORE_WORK = [
  'StudioFlow', 'FleetPulse', 'Field Intelligence', 'TribalForge', 'Enterprise Search', 'PromptPrep', 'Referral Manager', 'Impactify',
];

export const LINKS = [
  { label: 'GitHub', href: GH },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/ayush-kumar-singh-910379320/' },
  { label: 'LeetCode', href: 'https://leetcode.com/u/ayushsingh9/' },
  { label: 'Codeforces', href: 'https://codeforces.com/profile/AyushSinghCF' },
  { label: 'Kaggle', href: 'https://www.kaggle.com/ayuxxx999' },
  { label: 'CodeChef', href: 'https://www.codechef.com/users/ayushsinghcf' },
];
