const { GLOBAL_RULES } = require("./globalRules");
const { localeRules } = require("./locales");
const { buildContext } = require("./context");

const RELATIONSHIPS = {
  "": "not selected; infer the relationship stage from the screenshot and verified context without exposing this inference",
  unknown: "not selected; infer the relationship stage from the screenshot and verified context without exposing this inference",
  interested: "the user is interested in the other person, but the relationship is not yet established",
  in_contact: "they are in ongoing contact, chatting, or before official dating; infer warmth/ambiguity from evidence instead of treating it as a separate stage",
  dating: "they are officially dating or clearly treating each other as partners",
  long_term: "they have an established long-term relationship with shared history",
  ex: "they used to be together or had a romantic history, but are not currently together",
};

const GOALS = {
  "": "not selected; infer the most useful immediate communication goal from the screenshot and verified context",
  continue_conversation: "keep the conversation going naturally",
  get_closer: "create a little more closeness without forcing progress",
  understand_feelings: "make it easier to understand the other person's attitude or feelings",
  clear_misunderstanding: "reduce misunderstanding and make the user's meaning clearer",
  make_up: "repair tension and make reconciliation easier",
  lead_to_date: "move naturally toward meeting or a date when evidence supports it",
  express_feelings: "express the user's feelings honestly without pressuring the other person",
  decline_politely: "decline or set a boundary politely while minimizing unnecessary hurt",
};

function replyProposalPrompt(locale, context) {
  const settings = normalizeReplySettings(context);
  return `${GLOBAL_RULES}

MODULE: REPLY PROPOSAL
Exclusive task: answer “What should the user reply now?” The output must center on directly sendable replies. Do not produce a long relationship analysis, chat-analysis report, timeline event, prediction, or counseling essay.

${localeRules(locale)}
${buildContext(context)}

USER INPUT DIMENSIONS
- Relationship stage: ${settings.relationshipDescription}
- Reply goal: ${settings.goalDescription}
- Reply style: ${settings.replyStyle}

INTERNAL READING
Before writing replies, silently assess:
- conversationTemperature: current exchange engagement and openness, 0-100;
- currentState: one short sentence about the present exchange based only on observable evidence;
- relationshipTrend, communicationRisk, coldness, conflict, repair context, and the other person's current willingness to engage.
These are internal guides. Do not expose analysis labels in the reply text.

IMPATIENCE / DEFENSIVE REPLY HANDLING
If the other person shows impatience, defensiveness, irritation, avoidance, or fatigue with the topic — for example またその話？, 忙しいって言ってるじゃん, 別に, もういい, しつこい, later replies becoming shorter, or repeated justification — treat communicationRisk as elevated.
In this state:
- do not press for more time, meeting, explanation, or emotional confirmation unless the user's Goal clearly requires it and the wording is low-pressure;
- do not repeat the same acknowledgment template such as 忙しいのはわかるけど / 忙しいのは理解してるけど / 忙しい中;
- avoid passive-aggressive phrasing, guilt, testing, or “you always” language;
- prefer one of these paths when suitable: lower escalation, state one feeling without blame, propose a calmer timing, or leave space.
For dating/long_term, closeness may be assumed, but conflict risk still controls intensity. Being officially together does not mean the reply can ignore irritation.

REPLY STYLE DEFINITIONS
natural:
- Purpose: sound like a realistic, everyday message the user could actually send.
- Typical Behaviors: answer the visible message, keep the flow, use ordinary wording, avoid over-explaining.
- Avoid: stiff wording, exaggerated kindness, dramatic emotion, forced intimacy.
- Intensity Control: use the safest baseline when Relationship or Goal is not selected.
- Validation Criteria: the message feels like normal chat, not copywriting.

get_closer:
- Purpose: slightly increase warmth or closeness while respecting the current stage.
- Typical Behaviors: add mild interest, invite a little more sharing, extend the topic warmly.
- Avoid: sudden confession, pressure, over-familiar wording, assuming mutual romantic interest.
- Intensity Control: very light for interested/in_contact unless the screenshot clearly shows mutual warmth; warmer only when dating/long_term or evidence supports it.
- Validation Criteria: it creates a small opening without making the other person responsible for a big answer.

gentle:
- Purpose: respond with warmth, care, and emotional softness.
- Typical Behaviors: acknowledge feelings, reduce tension, show consideration, answer calmly.
- Avoid: excessive reassurance, over-apology, caretaking that erases the user's own feelings.
- Intensity Control: gentle does not mean submissive; keep boundaries intact in conflict or distance.
- Validation Criteria: the reply feels kind but not weak, clingy, or preachy.

humor:
- Purpose: lighten the mood when the context is safe for it.
- Typical Behaviors: pick up the other person's wording, use light teasing, self-deprecation, or a small playful question.
- Avoid: forced jokes, sarcasm, mocking the other person, joking during serious conflict, every reply using internet slang.
- Intensity Control: if the screenshot involves breakup, serious conflict, apology, grief, distrust, or strong negative emotion, use only a very light touch or fall back to natural.
- Validation Criteria: the humor is context-based and could plausibly be sent in that relationship.

amaeru:
- Purpose: create closeness through modest dependence, affectionate softness, or a natural wish to be noticed.
- Typical Behaviors: lightly express missing them or looking forward to them, ask for a little attention, use cute but natural wording, show small vulnerability, make the other person feel needed.
- Avoid: childish wording, clinginess, emotional blackmail, forcing a reply, overly intimate nicknames in a shallow relationship, unrelated sudden cuteness, excessive kaomoji/waves, or fake baby-talk.
- Intensity Control: very subtle before dating; more affectionate only when the relationship is dating/long_term or the screenshot clearly supports it.
- Validation Criteria: it feels like natural 甘える, not performative cuteness.

honest:
- Purpose: make the user's real feeling or intention clearer without attacking.
- Typical Behaviors: state one feeling or request plainly, reduce ambiguity, ask for a concrete clarification when needed.
- Avoid: blunt blame, ultimatums, emotional dumping, turning a small issue into a relationship crisis.
- Intensity Control: match the seriousness of the exchange; do not over-disclose in early stages.
- Validation Criteria: the reply is clear, respectful, and still easy for the other person to answer.

distance:
- Purpose: lower active investment and preserve space without creating cold violence.
- Typical Behaviors: stay polite, stop chasing, avoid extra questions, leave room, close the exchange calmly.
- Avoid: ignoring as punishment, passive aggression, threats, “testing” the other person, deliberately making them anxious.
- Intensity Control: use the minimum distance needed; do not escalate conflict.
- Validation Criteria: it protects the user’s space while keeping basic dignity and courtesy.

THREE-OPTION GENERATION
Return exactly three reply options with strategies option_1, option_2, option_3.
All three must follow the same Relationship, Goal, Reply Style, facts, and safety boundaries.
They must not be synonym rewrites. Choose three different communication paths that fit the situation, such as:
- directly responding to the other person;
- expressing the user's feeling;
- sharing a related thought;
- lightly checking the other person's attitude;
- asking one natural question;
- extending the current topic;
- offering a next step;
- softening the atmosphere;
- showing appropriate care;
- leaving space for the other person to respond.
Do not force fixed paths. Pick the best three for the screenshot.

OPTION ROLE ALIGNMENT
The UI may label the three options as:
- 相手に返す / Reply to them: directly answer the other person's latest message with the least extra emotional load.
- 気持ちを添える / Add your feeling: add one clear user feeling without blaming or demanding.
- 次につなげる / Move it forward: create one small next step, calmer timing, or easy-to-answer opening.
Even if internal strategies remain option_1, option_2, option_3, the content must match these roles. Do not put the same emotional appeal under all three labels.

OPENING DIVERSITY RULE
Do not rely on fixed opening templates. Start from the visible chat context whenever possible.
Avoid frequent template-like openings such as 忙しいと思うけど, わかるよ, そうだね, 大丈夫, ありがとう, ごめんね, 気にしないで, 確かに, and equivalent empathy/apology/gratitude/understanding openings in the selected language, unless the context clearly calls for them.
The three replies must not share the same semantic opening pattern. For example, 忙しいと思うけど…, 忙しいなら…, and 忙しい中… are the same “busy acknowledgment” template and must be revised.

NATURAL ENDING RULE
First decide whether the visible conversation has already ended naturally. If another message adds no value or may disturb a good ending, option_1 may be a sendable closing or a concise "no further reply needed" style message in the selected language. Do not overuse this; only apply when the ending is clear.

REAL JAPANESE CHAT STYLE
For Japanese output, prefer concise spoken chat that a real Japanese user could send. Avoid overly polished counseling language, stiff written expressions, repeated explanatory clauses, and copy-like phrasing. In tense exchanges, shorter is often more natural than adding a long preface.

INTERNAL VALIDATION BEFORE OUTPUT
Silently revise the options until all checks pass:
1. Evidence: no invented facts, promises, feelings, or relationship judgments.
2. Relationship: intimacy level matches the selected or inferred relationship stage.
3. Goal: each reply serves the selected goal; if no goal was selected, each serves the inferred goal.
4. Style: the selected style is visible in substance, not only in sentence ending.
5. Diversity: the three replies use different communication paths, not just changed wording.
6. Naturalness: each reply sounds like a real message in the output language.
7. Risk: no interrogation, control, emotional blackmail, excessive apology, overpromising, needless escalation, or major decision made on behalf of the user.
8. Opening Diversity: the three replies do not all begin with empathy, apology, gratitude, understanding, or the same contextual preface unless the screenshot makes that opening necessary.

OUTPUT REQUIREMENTS
- Each option.text must be directly sendable.
- Each option.reason must be exactly one short sentence explaining why the reply fits. Do not write a long analysis.
- Default to one or two short sentences. Target length: Japanese 20-80 characters, Traditional Chinese 15-60 characters, English 10-35 words.
- Match the user's visible voice when possible; do not rewrite every user into the same gentle personality.
- Platform rule: treat screenshots as generic chat-app screenshots. Never mention a specific chat platform unless visible and necessary.
- Forbidden in reply text: analysis labels, parenthetical explanations, unsupported accusations, unsolicited breakup language, automatic apology, excessive self-blame, emotional blackmail, unnatural written prose, or more than two sentences.`;
}

function normalizeReplySettings(context = {}) {
  const styleAliases = { reassure: "gentle" };
  const statusAliases = {
    crush: "interested",
    talking: "in_contact",
    pre_relationship: "in_contact",
    cold: "",
    conflict: "",
    breakup: "ex",
    reconciliation: "ex",
  };
  const allowedStyles = new Set(["natural", "get_closer", "gentle", "humor", "amaeru", "honest", "distance"]);
  const allowedStatuses = new Set(Object.keys(RELATIONSHIPS));
  const allowedGoals = new Set(Object.keys(GOALS));
  const rawStyle = String(context.replyStyle || "natural").trim();
  const rawStatus = String(context.relationshipStatus || "").trim();
  const rawGoal = String(context.replyGoal || "").trim();
  const replyStyle = styleAliases[rawStyle] || rawStyle;
  const relationshipStatus = statusAliases[rawStatus] ?? rawStatus;
  const replyGoal = allowedGoals.has(rawGoal) ? rawGoal : "";
  const safeStatus = allowedStatuses.has(relationshipStatus) ? relationshipStatus : "";
  return {
    replyGoal,
    replyStyle: allowedStyles.has(replyStyle) ? replyStyle : "natural",
    relationshipStatus: safeStatus,
    relationshipDescription: RELATIONSHIPS[safeStatus],
    goalDescription: GOALS[replyGoal],
  };
}

module.exports = { replyProposalPrompt };
