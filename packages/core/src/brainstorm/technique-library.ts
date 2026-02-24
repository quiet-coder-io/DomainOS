/**
 * Static brainstorming technique library — 56 BMAD techniques (10 categories) + 50 Advanced Elicitation methods.
 *
 * This file is part of DomainOS (AGPL-3.0-only).
 * Technique data adapted/derived from BMAD-METHOD (MIT License, bmad-code-org).
 * See https://github.com/bmad-code-org/BMAD-METHOD
 */

// ── Types ──

export const TECHNIQUE_CATEGORIES = [
  'creative',
  'analytical',
  'strategic',
  'collaborative',
  'visual',
  'structured',
  'disruptive',
  'evaluative',
  'futuristic',
  'systematic',
] as const

export type TechniqueCategory = (typeof TECHNIQUE_CATEGORIES)[number]

export interface Technique {
  id: string
  name: string
  category: TechniqueCategory
  description: string
  keywords: string[]
}

export interface RecommendResult {
  techniques: Technique[]
  source: 'heuristic'
}

// ── Technique Data ──

export const TECHNIQUES: readonly Technique[] = [
  // ── Creative (8) ──
  { id: 'creative-analogical-thinking', name: 'Analogical Thinking', category: 'creative', description: 'Draw parallels from unrelated domains to generate fresh perspectives on the problem.', keywords: ['analogy', 'metaphor', 'comparison', 'cross-domain', 'parallel'] },
  { id: 'creative-reverse-brainstorm', name: 'Reverse Brainstorming', category: 'creative', description: 'Instead of solving the problem, brainstorm ways to cause or worsen it, then reverse those ideas.', keywords: ['reverse', 'opposite', 'invert', 'problem', 'cause'] },
  { id: 'creative-random-stimulus', name: 'Random Stimulus', category: 'creative', description: 'Use a random word, image, or concept as a catalyst to spark unexpected connections.', keywords: ['random', 'catalyst', 'unexpected', 'stimulus', 'spark'] },
  { id: 'creative-brainwriting', name: 'Brainwriting (6-3-5)', category: 'creative', description: 'Each participant writes 3 ideas in 5 minutes, then passes to the next person who builds on them.', keywords: ['writing', 'build', 'iterate', 'collaborative', 'silent'] },
  { id: 'creative-scamper', name: 'SCAMPER', category: 'creative', description: 'Apply Substitute, Combine, Adapt, Modify, Put to other use, Eliminate, Reverse to existing solutions.', keywords: ['substitute', 'combine', 'adapt', 'modify', 'eliminate', 'reverse', 'transform'] },
  { id: 'creative-mind-mapping', name: 'Mind Mapping', category: 'creative', description: 'Start with a central concept and branch out into related ideas, creating a visual web of connections.', keywords: ['map', 'visual', 'branch', 'connect', 'radial', 'diagram'] },
  { id: 'creative-worst-idea', name: 'Worst Possible Idea', category: 'creative', description: 'Generate deliberately terrible ideas to break mental blocks and find kernels of insight in the absurd.', keywords: ['worst', 'bad', 'absurd', 'humor', 'break', 'block'] },
  { id: 'creative-lateral-thinking', name: 'Lateral Thinking', category: 'creative', description: 'Use provocative statements and challenge assumptions to escape conventional thinking patterns.', keywords: ['lateral', 'provocation', 'assumption', 'unconventional', 'de-bono'] },

  // ── Analytical (6) ──
  { id: 'analytical-five-whys', name: 'Five Whys', category: 'analytical', description: 'Ask "why" five times to drill down from surface symptoms to root causes.', keywords: ['root-cause', 'why', 'drill', 'deep', 'cause', 'symptom'] },
  { id: 'analytical-swot', name: 'SWOT Analysis', category: 'analytical', description: 'Map Strengths, Weaknesses, Opportunities, and Threats to understand the full landscape.', keywords: ['swot', 'strength', 'weakness', 'opportunity', 'threat', 'assessment'] },
  { id: 'analytical-fishbone', name: 'Fishbone (Ishikawa) Diagram', category: 'analytical', description: 'Categorize potential causes of a problem into main branches (people, process, technology, etc.).', keywords: ['fishbone', 'ishikawa', 'cause-effect', 'category', 'root-cause', 'diagram'] },
  { id: 'analytical-pareto', name: 'Pareto Analysis (80/20)', category: 'analytical', description: 'Identify the vital few causes that account for the majority of the effect.', keywords: ['pareto', '80-20', 'vital-few', 'prioritize', 'impact', 'leverage'] },
  { id: 'analytical-force-field', name: 'Force Field Analysis', category: 'analytical', description: 'Map driving forces vs restraining forces to understand what helps or hinders change.', keywords: ['force', 'driving', 'restraining', 'change', 'barrier', 'enabler'] },
  { id: 'analytical-gap-analysis', name: 'Gap Analysis', category: 'analytical', description: 'Compare current state to desired state and identify the gaps that need to be bridged.', keywords: ['gap', 'current', 'desired', 'state', 'bridge', 'deficit'] },

  // ── Strategic (6) ──
  { id: 'strategic-blue-ocean', name: 'Blue Ocean Strategy', category: 'strategic', description: 'Find uncontested market space by simultaneously pursuing differentiation and low cost.', keywords: ['blue-ocean', 'uncontested', 'market', 'differentiation', 'value-innovation'] },
  { id: 'strategic-porters-five', name: "Porter's Five Forces", category: 'strategic', description: 'Analyze competitive intensity through supplier power, buyer power, substitutes, new entrants, and rivalry.', keywords: ['porter', 'competitive', 'industry', 'forces', 'rivalry', 'supplier', 'buyer'] },
  { id: 'strategic-ansoff-matrix', name: 'Ansoff Growth Matrix', category: 'strategic', description: 'Explore growth through market penetration, market development, product development, or diversification.', keywords: ['growth', 'market', 'product', 'diversification', 'penetration', 'expansion'] },
  { id: 'strategic-value-chain', name: 'Value Chain Analysis', category: 'strategic', description: 'Examine each activity in the value chain to find competitive advantages and optimization opportunities.', keywords: ['value-chain', 'activity', 'competitive-advantage', 'optimization', 'margin'] },
  { id: 'strategic-scenario-planning', name: 'Scenario Planning', category: 'strategic', description: 'Develop multiple plausible future scenarios and plan strategies for each.', keywords: ['scenario', 'future', 'planning', 'uncertainty', 'plausible', 'contingency'] },
  { id: 'strategic-okr-decomposition', name: 'OKR Decomposition', category: 'strategic', description: 'Break down Objectives into Key Results and generate initiatives for each key result.', keywords: ['okr', 'objective', 'key-result', 'initiative', 'goal', 'metric'] },

  // ── Collaborative (5) ──
  { id: 'collaborative-round-robin', name: 'Round Robin', category: 'collaborative', description: 'Each participant contributes one idea in turn, ensuring equal participation and diverse perspectives.', keywords: ['round-robin', 'turn', 'equal', 'participation', 'diverse'] },
  { id: 'collaborative-nominal-group', name: 'Nominal Group Technique', category: 'collaborative', description: 'Individual idea generation followed by structured group discussion and ranked voting.', keywords: ['nominal', 'individual', 'voting', 'rank', 'structured', 'consensus'] },
  { id: 'collaborative-world-cafe', name: 'World Café', category: 'collaborative', description: 'Rotate between themed discussion tables, cross-pollinating ideas between groups.', keywords: ['world-cafe', 'rotate', 'discussion', 'cross-pollinate', 'theme'] },
  { id: 'collaborative-affinity-mapping', name: 'Affinity Mapping', category: 'collaborative', description: 'Group related ideas into clusters to reveal natural themes and patterns.', keywords: ['affinity', 'cluster', 'group', 'theme', 'pattern', 'organize'] },
  { id: 'collaborative-dot-voting', name: 'Dot Voting', category: 'collaborative', description: 'Each participant allocates limited votes to their preferred ideas for democratic prioritization.', keywords: ['voting', 'prioritize', 'democratic', 'select', 'rank'] },

  // ── Visual (5) ──
  { id: 'visual-storyboarding', name: 'Storyboarding', category: 'visual', description: 'Create a visual sequence showing how an idea, product, or process unfolds step by step.', keywords: ['storyboard', 'sequence', 'visual', 'step', 'narrative', 'flow'] },
  { id: 'visual-customer-journey', name: 'Customer Journey Map', category: 'visual', description: 'Map every touchpoint of the customer experience to find pain points and improvement opportunities.', keywords: ['customer', 'journey', 'touchpoint', 'pain-point', 'experience', 'map'] },
  { id: 'visual-empathy-map', name: 'Empathy Map', category: 'visual', description: 'Map what users think, feel, say, and do to build deep understanding of their perspective.', keywords: ['empathy', 'user', 'think', 'feel', 'say', 'do', 'perspective'] },
  { id: 'visual-business-canvas', name: 'Business Model Canvas', category: 'visual', description: 'Map 9 building blocks of a business model on a single visual canvas.', keywords: ['business-model', 'canvas', 'revenue', 'value-proposition', 'customer-segment'] },
  { id: 'visual-concept-sketch', name: 'Concept Sketching', category: 'visual', description: 'Rapidly sketch rough visualizations of ideas to make abstract concepts tangible.', keywords: ['sketch', 'draw', 'visual', 'rough', 'prototype', 'tangible'] },

  // ── Structured (6) ──
  { id: 'structured-six-hats', name: 'Six Thinking Hats', category: 'structured', description: 'Examine ideas from six perspectives: facts, emotions, caution, benefits, creativity, and process.', keywords: ['six-hats', 'de-bono', 'perspective', 'facts', 'emotions', 'caution', 'benefits'] },
  { id: 'structured-decision-matrix', name: 'Decision Matrix', category: 'structured', description: 'Score options against weighted criteria for systematic, objective evaluation.', keywords: ['matrix', 'criteria', 'weight', 'score', 'evaluate', 'objective'] },
  { id: 'structured-impact-effort', name: 'Impact/Effort Matrix', category: 'structured', description: 'Plot ideas on a 2×2 grid of impact vs effort to identify quick wins and big bets.', keywords: ['impact', 'effort', 'matrix', 'quick-win', 'prioritize', '2x2'] },
  { id: 'structured-moscow', name: 'MoSCoW Prioritization', category: 'structured', description: 'Categorize items as Must have, Should have, Could have, Won\'t have for clear prioritization.', keywords: ['moscow', 'must', 'should', 'could', 'wont', 'prioritize'] },
  { id: 'structured-how-might-we', name: 'How Might We', category: 'structured', description: 'Reframe challenges as "How might we..." questions to open up solution space.', keywords: ['how-might-we', 'reframe', 'question', 'challenge', 'opportunity'] },
  { id: 'structured-design-sprint', name: 'Design Sprint Framework', category: 'structured', description: 'Compressed 5-phase process: understand, diverge, decide, prototype, test.', keywords: ['design-sprint', 'prototype', 'test', 'decide', 'compressed', 'rapid'] },

  // ── Disruptive (5) ──
  { id: 'disruptive-first-principles', name: 'First Principles Thinking', category: 'disruptive', description: 'Break down assumptions to fundamental truths and rebuild solutions from scratch.', keywords: ['first-principles', 'fundamental', 'assumption', 'rebuild', 'truth', 'scratch'] },
  { id: 'disruptive-constraint-removal', name: 'Constraint Removal', category: 'disruptive', description: 'Temporarily remove all constraints (budget, time, physics) and imagine the ideal solution.', keywords: ['constraint', 'remove', 'unlimited', 'ideal', 'freedom', 'no-limits'] },
  { id: 'disruptive-10x-thinking', name: '10x Thinking', category: 'disruptive', description: 'Instead of 10% improvement, ask what would need to change for 10x improvement.', keywords: ['10x', 'moonshot', 'radical', 'exponential', 'breakthrough'] },
  { id: 'disruptive-premortem', name: 'Pre-Mortem Analysis', category: 'disruptive', description: 'Imagine the project has failed spectacularly — then work backward to identify what went wrong.', keywords: ['premortem', 'failure', 'postmortem', 'risk', 'what-if', 'backward'] },
  { id: 'disruptive-what-if', name: 'What-If Scenarios', category: 'disruptive', description: 'Explore radical what-if questions that challenge the fundamental nature of the problem.', keywords: ['what-if', 'scenario', 'radical', 'challenge', 'explore', 'hypothetical'] },

  // ── Evaluative (5) ──
  { id: 'evaluative-pugh-matrix', name: 'Pugh Matrix', category: 'evaluative', description: 'Compare alternatives against a baseline using + / - / S scoring for systematic selection.', keywords: ['pugh', 'compare', 'baseline', 'selection', 'score', 'alternative'] },
  { id: 'evaluative-pros-cons', name: 'Weighted Pros and Cons', category: 'evaluative', description: 'List and weight pros and cons of each option for balanced comparison.', keywords: ['pros', 'cons', 'weight', 'balance', 'compare', 'trade-off'] },
  { id: 'evaluative-cost-benefit', name: 'Cost-Benefit Analysis', category: 'evaluative', description: 'Quantify costs and benefits of each option to find the highest net value.', keywords: ['cost', 'benefit', 'roi', 'value', 'quantify', 'net'] },
  { id: 'evaluative-feasibility-check', name: 'Feasibility Assessment', category: 'evaluative', description: 'Evaluate each idea against technical, financial, operational, and timeline feasibility.', keywords: ['feasibility', 'technical', 'financial', 'operational', 'timeline', 'viable'] },
  { id: 'evaluative-risk-reward', name: 'Risk-Reward Matrix', category: 'evaluative', description: 'Plot ideas on risk vs reward axes to balance ambition with prudence.', keywords: ['risk', 'reward', 'balance', 'ambition', 'prudence', 'matrix'] },

  // ── Futuristic (5) ──
  { id: 'futuristic-backcasting', name: 'Backcasting', category: 'futuristic', description: 'Start from a desired future outcome and work backward to identify the steps needed to get there.', keywords: ['backcast', 'future', 'backward', 'outcome', 'steps', 'path'] },
  { id: 'futuristic-trend-extrapolation', name: 'Trend Extrapolation', category: 'futuristic', description: 'Extend current trends into the future and explore their implications and intersections.', keywords: ['trend', 'extrapolate', 'future', 'implication', 'intersection'] },
  { id: 'futuristic-delphi-method', name: 'Delphi Method', category: 'futuristic', description: 'Gather expert opinions iteratively, with anonymous feedback, until consensus emerges.', keywords: ['delphi', 'expert', 'consensus', 'iterative', 'anonymous', 'forecast'] },
  { id: 'futuristic-emerging-tech', name: 'Emerging Technology Scan', category: 'futuristic', description: 'Survey emerging technologies and explore how they could transform the problem space.', keywords: ['technology', 'emerging', 'innovation', 'transform', 'ai', 'blockchain', 'quantum'] },
  { id: 'futuristic-vision-casting', name: 'Vision Casting', category: 'futuristic', description: 'Paint a vivid picture of the ideal future state to inspire and align creative energy.', keywords: ['vision', 'inspire', 'ideal', 'future', 'align', 'aspiration'] },

  // ── Systematic (5) ──
  { id: 'systematic-morphological', name: 'Morphological Analysis', category: 'systematic', description: 'Decompose the problem into dimensions, list options per dimension, and explore all combinations.', keywords: ['morphological', 'decompose', 'dimension', 'combination', 'systematic', 'matrix'] },
  { id: 'systematic-triz', name: 'TRIZ Inventive Principles', category: 'systematic', description: 'Apply 40 inventive principles derived from patent analysis to resolve technical contradictions.', keywords: ['triz', 'inventive', 'contradiction', 'patent', 'principle', 'technical'] },
  { id: 'systematic-synectics', name: 'Synectics', category: 'systematic', description: 'Use structured analogies (personal, direct, symbolic, fantasy) to find innovative solutions.', keywords: ['synectics', 'analogy', 'personal', 'direct', 'symbolic', 'fantasy'] },
  { id: 'systematic-boundary-exam', name: 'Boundary Examination', category: 'systematic', description: 'Systematically question and push every boundary of the problem definition.', keywords: ['boundary', 'limit', 'question', 'push', 'definition', 'scope'] },
  { id: 'systematic-attribute-listing', name: 'Attribute Listing', category: 'systematic', description: 'List every attribute of the subject and systematically modify each one to generate new ideas.', keywords: ['attribute', 'list', 'modify', 'systematic', 'property', 'characteristic'] },
] as const

// ── Advanced Elicitation Methods (50) ──

export const ELICITATION_METHODS: readonly Technique[] = [
  { id: 'elicit-socratic-questioning', name: 'Socratic Questioning', category: 'analytical', description: 'Use probing questions to challenge assumptions and deepen understanding.', keywords: ['socratic', 'question', 'probe', 'assumption', 'clarify'] },
  { id: 'elicit-five-w-h', name: '5W+H (Who/What/When/Where/Why/How)', category: 'analytical', description: 'Systematically explore all dimensions of a topic using the six fundamental questions.', keywords: ['who', 'what', 'when', 'where', 'why', 'how', 'comprehensive'] },
  { id: 'elicit-laddering', name: 'Laddering', category: 'analytical', description: 'Ask "why is that important?" repeatedly to climb from features to benefits to core values.', keywords: ['laddering', 'values', 'benefits', 'features', 'importance', 'hierarchy'] },
  { id: 'elicit-critical-incident', name: 'Critical Incident Technique', category: 'analytical', description: 'Identify and analyze specific examples of particularly good or bad outcomes.', keywords: ['critical', 'incident', 'example', 'extreme', 'good', 'bad', 'specific'] },
  { id: 'elicit-stakeholder-mapping', name: 'Stakeholder Mapping', category: 'collaborative', description: 'Identify and map all stakeholders by influence and interest to understand the full landscape.', keywords: ['stakeholder', 'influence', 'interest', 'map', 'power', 'landscape'] },
  { id: 'elicit-assumption-surfacing', name: 'Assumption Surfacing', category: 'disruptive', description: 'Systematically identify and challenge hidden assumptions underlying current thinking.', keywords: ['assumption', 'hidden', 'challenge', 'surface', 'expose', 'belief'] },
  { id: 'elicit-devil-advocate', name: "Devil's Advocate", category: 'disruptive', description: 'Deliberately argue against proposals to stress-test ideas and find weaknesses.', keywords: ['devil', 'advocate', 'argue', 'against', 'stress-test', 'weakness'] },
  { id: 'elicit-perspective-shift', name: 'Perspective Shifting', category: 'creative', description: 'View the problem from radically different viewpoints: customer, competitor, child, alien, etc.', keywords: ['perspective', 'viewpoint', 'shift', 'customer', 'competitor', 'different'] },
  { id: 'elicit-rich-pictures', name: 'Rich Pictures', category: 'visual', description: 'Draw holistic, informal diagrams that capture the full complexity of a situation.', keywords: ['rich', 'picture', 'diagram', 'holistic', 'complexity', 'informal'] },
  { id: 'elicit-metaphor-exploration', name: 'Metaphor Exploration', category: 'creative', description: 'Explore "this problem is like..." metaphors to unlock new framings and insights.', keywords: ['metaphor', 'like', 'framing', 'comparison', 'insight', 'reframe'] },
  { id: 'elicit-experience-prototyping', name: 'Experience Prototyping', category: 'visual', description: 'Role-play or simulate the experience to discover insights that analysis alone misses.', keywords: ['prototype', 'experience', 'role-play', 'simulate', 'discover', 'immerse'] },
  { id: 'elicit-extreme-scenarios', name: 'Extreme Scenarios', category: 'disruptive', description: 'Explore outcomes at the extremes: what if demand was 100x? Zero? Reversed?', keywords: ['extreme', 'scenario', '100x', 'zero', 'reversed', 'edge-case'] },
  { id: 'elicit-think-aloud', name: 'Think Aloud Protocol', category: 'analytical', description: 'Verbalize thought process in real-time to reveal hidden reasoning and decision patterns.', keywords: ['think-aloud', 'verbalize', 'reasoning', 'process', 'reveal', 'real-time'] },
  { id: 'elicit-card-sorting', name: 'Card Sorting', category: 'structured', description: 'Organize topics into groups and hierarchies to reveal mental models and natural categorization.', keywords: ['card', 'sort', 'group', 'hierarchy', 'mental-model', 'categorize'] },
  { id: 'elicit-storytelling', name: 'Storytelling', category: 'creative', description: 'Share narratives about past experiences, ideal futures, or hypothetical scenarios to elicit deep insights.', keywords: ['story', 'narrative', 'past', 'future', 'experience', 'insight'] },
  { id: 'elicit-context-mapping', name: 'Context Mapping', category: 'structured', description: 'Map the broader context: trends, influences, constraints, and environmental factors affecting the problem.', keywords: ['context', 'map', 'trend', 'influence', 'constraint', 'environment'] },
  { id: 'elicit-role-storming', name: 'Role Storming', category: 'creative', description: 'Brainstorm while embodying a specific persona: a CEO, a child, a competitor, etc.', keywords: ['role', 'persona', 'embodying', 'character', 'ceo', 'competitor'] },
  { id: 'elicit-provocative-statement', name: 'Provocative Statements', category: 'disruptive', description: 'Make deliberately provocative claims to challenge groupthink and provoke deeper exploration.', keywords: ['provocative', 'challenge', 'groupthink', 'claim', 'controversial', 'explore'] },
  { id: 'elicit-time-travel', name: 'Time Travel', category: 'futuristic', description: 'Imagine solving this problem 10 years ago, now, and 10 years from now. What changes?', keywords: ['time', 'past', 'future', 'change', 'evolve', 'perspective'] },
  { id: 'elicit-impact-mapping', name: 'Impact Mapping', category: 'strategic', description: 'Map goals → actors → impacts → deliverables to connect strategy to specific actions.', keywords: ['impact', 'goal', 'actor', 'deliverable', 'strategy', 'action'] },
  { id: 'elicit-negative-brainstorm', name: 'Negative Brainstorming', category: 'disruptive', description: 'What would make this problem worse? What would guarantee failure? Then reverse the insights.', keywords: ['negative', 'worse', 'failure', 'reverse', 'opposite', 'anti-pattern'] },
  { id: 'elicit-success-criteria', name: 'Success Criteria Definition', category: 'evaluative', description: 'Define what success looks like before exploring solutions — what measurable outcomes matter?', keywords: ['success', 'criteria', 'measure', 'outcome', 'definition', 'kpi'] },
  { id: 'elicit-boundary-object', name: 'Boundary Object Technique', category: 'collaborative', description: 'Use shared artifacts (diagrams, prototypes) as common ground for diverse stakeholders.', keywords: ['boundary', 'object', 'shared', 'artifact', 'common-ground', 'diverse'] },
  { id: 'elicit-reversal-technique', name: 'Reversal Technique', category: 'creative', description: 'Reverse key aspects of the problem: what if inputs were outputs? Suppliers were customers?', keywords: ['reversal', 'reverse', 'flip', 'invert', 'swap', 'opposite'] },
  { id: 'elicit-priority-poker', name: 'Priority Poker', category: 'collaborative', description: 'Simultaneous reveal of priority scores to surface disagreements and drive alignment discussion.', keywords: ['priority', 'poker', 'score', 'alignment', 'disagreement', 'reveal'] },
  { id: 'elicit-futures-wheel', name: 'Futures Wheel', category: 'futuristic', description: 'Map ripple effects: primary consequences → secondary consequences → tertiary, radiating outward.', keywords: ['futures', 'wheel', 'ripple', 'consequence', 'secondary', 'tertiary'] },
  { id: 'elicit-pain-gain-map', name: 'Pain/Gain Map', category: 'evaluative', description: 'Explicitly map what causes pain and what creates gain for each stakeholder.', keywords: ['pain', 'gain', 'stakeholder', 'map', 'value', 'frustration'] },
  { id: 'elicit-analogical-reasoning', name: 'Cross-Industry Analogies', category: 'creative', description: 'How do other industries solve this? What can healthcare learn from aviation? Finance from gaming?', keywords: ['cross-industry', 'analogy', 'learn', 'transfer', 'borrow', 'healthcare', 'aviation'] },
  { id: 'elicit-crazy-eights', name: 'Crazy Eights', category: 'creative', description: 'Sketch 8 ideas in 8 minutes, one per panel. Speed forces creativity over perfection.', keywords: ['crazy-eights', 'sketch', 'speed', 'rapid', 'eight', 'panel'] },
  { id: 'elicit-design-thinking', name: 'Design Thinking Empathize', category: 'visual', description: 'Deeply immerse in user experience through observation, interviews, and empathy exercises.', keywords: ['design-thinking', 'empathize', 'user', 'observe', 'interview', 'immerse'] },
  { id: 'elicit-starbursting', name: 'Starbursting', category: 'structured', description: 'Generate questions rather than answers. Map who, what, where, when, why, how around the central idea.', keywords: ['starbursting', 'question', 'star', 'who', 'what', 'where', 'when', 'why', 'how'] },
  { id: 'elicit-trigger-method', name: 'Trigger Method', category: 'creative', description: 'Present a list of idea triggers (verbs, adjectives, scenarios) and apply each to the problem.', keywords: ['trigger', 'list', 'verb', 'apply', 'prompt', 'generate'] },
  { id: 'elicit-abstraction-ladder', name: 'Abstraction Laddering', category: 'analytical', description: 'Move up ("why?") for broader purpose or down ("how?") for concrete implementation.', keywords: ['abstraction', 'ladder', 'why', 'how', 'broad', 'concrete', 'purpose'] },
  { id: 'elicit-challenge-framing', name: 'Challenge Reframing', category: 'structured', description: 'Restate the problem in 5 different ways to discover which framing opens the richest solution space.', keywords: ['reframe', 'challenge', 'restate', 'framing', 'problem-statement', 'different'] },
  { id: 'elicit-wishing', name: 'Wishing Technique', category: 'creative', description: 'Start with "I wish..." statements to bypass practical constraints and unlock aspirational thinking.', keywords: ['wish', 'aspiration', 'if-only', 'dream', 'unconstrained', 'ideal'] },
  { id: 'elicit-swot-brainstorm', name: 'SWOT-Driven Brainstorm', category: 'strategic', description: 'Use SWOT quadrants as explicit brainstorming prompts: ideas for each S, W, O, T.', keywords: ['swot', 'quadrant', 'strength', 'weakness', 'opportunity', 'threat'] },
  { id: 'elicit-product-box', name: 'Product Box', category: 'visual', description: 'Design the packaging for your idea — what headlines, features, and benefits would you highlight?', keywords: ['product-box', 'packaging', 'headline', 'feature', 'benefit', 'sell'] },
  { id: 'elicit-lotus-blossom', name: 'Lotus Blossom', category: 'systematic', description: 'Central idea surrounded by 8 themes, each generating 8 more ideas = 64 structured variations.', keywords: ['lotus', 'blossom', 'structured', 'systematic', 'variation', '64'] },
  { id: 'elicit-biomimicry', name: 'Biomimicry', category: 'creative', description: 'Look to nature for solutions: how does nature solve this problem? Ant colonies? Trees? Immune systems?', keywords: ['biomimicry', 'nature', 'biology', 'ant', 'tree', 'natural', 'evolution'] },
  { id: 'elicit-challenge-tree', name: 'Challenge Tree', category: 'analytical', description: 'Decompose the main challenge into sub-challenges, then sub-sub-challenges, creating a hierarchy.', keywords: ['challenge', 'tree', 'decompose', 'hierarchy', 'sub-challenge', 'breakdown'] },
  { id: 'elicit-speed-dating', name: 'Speed Dating Ideas', category: 'collaborative', description: 'Rapid-fire 2-minute pitches of each idea followed by instant feedback.', keywords: ['speed', 'dating', 'pitch', 'rapid', 'feedback', 'quick'] },
  { id: 'elicit-appreciative-inquiry', name: 'Appreciative Inquiry', category: 'collaborative', description: 'Focus on what works well and how to amplify it, rather than fixing what is broken.', keywords: ['appreciative', 'positive', 'amplify', 'works', 'strength-based', 'build-on'] },
  { id: 'elicit-constraint-brainstorm', name: 'Constraint-Driven Brainstorming', category: 'structured', description: 'Deliberately add constraints (half budget, double speed, no technology) to force creativity.', keywords: ['constraint', 'limit', 'force', 'creativity', 'budget', 'speed'] },
  { id: 'elicit-user-story-mapping', name: 'User Story Mapping', category: 'visual', description: 'Map the user journey as a backbone and generate feature ideas at each step.', keywords: ['user-story', 'map', 'journey', 'backbone', 'feature', 'step'] },
  { id: 'elicit-silent-brainstorm', name: 'Silent Brainstorming', category: 'collaborative', description: 'Everyone writes ideas simultaneously in silence, then shares. Prevents anchoring and groupthink.', keywords: ['silent', 'writing', 'simultaneous', 'anchoring', 'groupthink', 'independent'] },
  { id: 'elicit-kj-method', name: 'KJ Method (Affinity)', category: 'systematic', description: 'Write ideas on cards, silently sort into groups, then label clusters collaboratively.', keywords: ['kj', 'affinity', 'card', 'sort', 'cluster', 'label', 'collaborative'] },
  { id: 'elicit-value-proposition', name: 'Value Proposition Canvas', category: 'strategic', description: 'Map customer jobs, pains, gains against your value propositions for fit analysis.', keywords: ['value-proposition', 'canvas', 'customer', 'jobs', 'pains', 'gains', 'fit'] },
  { id: 'elicit-anti-problem', name: 'Anti-Problem', category: 'disruptive', description: 'Define the exact opposite of your problem and solve that instead.', keywords: ['anti-problem', 'opposite', 'reverse', 'define', 'invert'] },
  { id: 'elicit-substitute-leader', name: 'Substitute Leader', category: 'creative', description: 'How would Elon Musk/Steve Jobs/your competitor approach this problem?', keywords: ['substitute', 'leader', 'famous', 'approach', 'perspective', 'hero'] },
  { id: 'elicit-opportunity-mapping', name: 'Opportunity Mapping', category: 'strategic', description: 'Map unmet needs, underserved segments, and emerging behaviors to find opportunity spaces.', keywords: ['opportunity', 'unmet', 'underserved', 'emerging', 'segment', 'space'] },
] as const

// ── All techniques (combined) ──

export const ALL_TECHNIQUES: readonly Technique[] = [
  ...TECHNIQUES,
  ...ELICITATION_METHODS,
]

// ── Lookup helpers ──

const byIdMap = new Map(ALL_TECHNIQUES.map((t) => [t.id, t]))
const byCategoryMap = new Map<TechniqueCategory, Technique[]>()
for (const t of ALL_TECHNIQUES) {
  const list = byCategoryMap.get(t.category) || []
  list.push(t)
  byCategoryMap.set(t.category, list)
}

export function getById(id: string): Technique | undefined {
  return byIdMap.get(id)
}

export function getByCategory(category: TechniqueCategory): Technique[] {
  return byCategoryMap.get(category) || []
}

// ── Heuristic recommendation ──

/** Category affinity scores for common brainstorming goals. */
const GOAL_CATEGORY_AFFINITY: Record<string, TechniqueCategory[]> = {
  // Problem-solving goals
  'root-cause': ['analytical', 'systematic'],
  'problem': ['analytical', 'disruptive', 'structured'],
  'diagnose': ['analytical', 'systematic'],
  'fix': ['analytical', 'structured'],
  // Innovation goals
  'innovate': ['creative', 'disruptive', 'futuristic'],
  'creative': ['creative', 'disruptive', 'visual'],
  'new': ['creative', 'futuristic', 'disruptive'],
  'disrupt': ['disruptive', 'futuristic', 'strategic'],
  'breakthrough': ['disruptive', 'creative', 'futuristic'],
  // Strategic goals
  'strategy': ['strategic', 'evaluative', 'futuristic'],
  'growth': ['strategic', 'futuristic'],
  'competitive': ['strategic', 'analytical'],
  'market': ['strategic', 'evaluative'],
  'plan': ['strategic', 'structured', 'futuristic'],
  // Evaluation goals
  'evaluate': ['evaluative', 'structured', 'analytical'],
  'decide': ['evaluative', 'structured'],
  'compare': ['evaluative', 'structured'],
  'prioritize': ['structured', 'evaluative', 'collaborative'],
  'select': ['evaluative', 'structured'],
  // Collaboration goals
  'team': ['collaborative', 'visual', 'structured'],
  'align': ['collaborative', 'structured'],
  'consensus': ['collaborative', 'evaluative'],
  // User-centric goals
  'user': ['visual', 'creative', 'collaborative'],
  'customer': ['visual', 'strategic', 'creative'],
  'experience': ['visual', 'creative'],
  'ux': ['visual', 'creative', 'structured'],
  // Future-oriented goals
  'future': ['futuristic', 'strategic', 'disruptive'],
  'trend': ['futuristic', 'strategic'],
  'forecast': ['futuristic', 'analytical'],
  'scenario': ['futuristic', 'strategic'],
  // Risk goals
  'risk': ['evaluative', 'disruptive', 'analytical'],
  'failure': ['disruptive', 'analytical'],
  'assumption': ['disruptive', 'analytical'],
}

/**
 * Score a technique against a topic and goals using keyword matching + category affinity.
 * Returns a non-negative score; higher = more relevant.
 */
function scoreTechnique(technique: Technique, topicWords: Set<string>, goalCategories: TechniqueCategory[]): number {
  let score = 0

  // Keyword overlap with topic
  for (const kw of technique.keywords) {
    if (topicWords.has(kw)) score += 3
    // Partial match: check if any topic word starts with or contains the keyword
    for (const tw of topicWords) {
      if (tw !== kw && (tw.includes(kw) || kw.includes(tw))) score += 1
    }
  }

  // Category affinity from goals
  if (goalCategories.includes(technique.category)) {
    score += 5
  }

  // Name match with topic
  const nameLower = technique.name.toLowerCase()
  for (const tw of topicWords) {
    if (nameLower.includes(tw)) score += 2
  }

  return score
}

/**
 * Heuristic-only technique recommendation. No LLM call.
 * Scores techniques by keyword overlap + category affinity.
 */
export function recommend(topic: string, goals?: string): RecommendResult {
  // Tokenize topic into words
  const topicWords = new Set(
    (topic + ' ' + (goals ?? ''))
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  )

  // Determine goal-aligned categories
  const goalCategories: TechniqueCategory[] = []
  for (const word of topicWords) {
    const affinities = GOAL_CATEGORY_AFFINITY[word]
    if (affinities) {
      for (const cat of affinities) {
        if (!goalCategories.includes(cat)) goalCategories.push(cat)
      }
    }
  }

  // Score all techniques
  const scored = ALL_TECHNIQUES.map((t) => ({
    technique: t,
    score: scoreTechnique(t, topicWords, goalCategories),
  }))

  // Sort by score descending, take top 10
  scored.sort((a, b) => b.score - a.score)

  // Filter to techniques with score > 0, fall back to category-diverse selection
  const relevant = scored.filter((s) => s.score > 0).slice(0, 10)

  if (relevant.length >= 5) {
    return { techniques: relevant.map((s) => s.technique), source: 'heuristic' }
  }

  // Fallback: pick top technique from each category for diversity
  const diverse: Technique[] = []
  const seenCategories = new Set<string>()
  for (const s of scored) {
    if (!seenCategories.has(s.technique.category)) {
      seenCategories.add(s.technique.category)
      diverse.push(s.technique)
    }
    if (diverse.length >= 10) break
  }

  return { techniques: diverse, source: 'heuristic' }
}

/**
 * Serendipity mode: return random techniques, optionally excluding categories.
 */
export function getRandom(count: number, excludeCategories?: TechniqueCategory[]): Technique[] {
  let pool = [...ALL_TECHNIQUES]

  if (excludeCategories && excludeCategories.length > 0) {
    const excluded = new Set(excludeCategories)
    pool = pool.filter((t) => !excluded.has(t.category))
  }

  // Fisher-Yates shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }

  return pool.slice(0, Math.min(count, pool.length))
}
