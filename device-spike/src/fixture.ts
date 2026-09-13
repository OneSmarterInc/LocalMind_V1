/** Authored synthetic fixture, not a production package or learner record. */
export const FIXTURE_VERSION = "device-spike-1";
export const BLOCK = {
  id: "normalization-functional-dependency",
  title: "A functional dependency",
  revision: 1,
  text: `A functional dependency describes a rule between attributes in a relation. We write X -> Y when a particular value of X determines exactly one value of Y. Two rows with the same X value must therefore have the same Y value. The rule applies to every valid state of the relation, not merely to a few rows we happen to see today.

Consider a student directory with StudentID, StudentName and Programme. The college gives each student a unique StudentID. StudentID determines StudentName: once an ID is chosen, only that student's name is allowed. Students may share the same name, so StudentName does not necessarily determine StudentID. The direction of a dependency matters.

A candidate key is a minimal set of attributes that determines all attributes in the relation. Minimal means that removing any attribute from that set would stop it being a key. A dependency is a rule about data; it is not a claim that one attribute physically causes another.

To check the proposed rule StudentID -> StudentName, look for two rows with the same ID and different names. Such rows violate the rule. Two different IDs with the same name do not violate this rule. The owner of the data must confirm the intended rule: a small sample without violations is not sufficient evidence that the rule is always true.`,
};
export const QUESTION = {
  id: "dependency-direction",
  blockId: BLOCK.id,
  prompt: "Does StudentName determine StudentID in this directory? Explain why.",
  rubric: [
    { id: "direction", text: "StudentName does not necessarily determine StudentID." },
    { id: "shared-name", text: "Different students may share a name but have different IDs." },
  ],
};
export const CASES = {
  explain: { task: "explain", blockId: BLOCK.id, question: "Explain why the direction of this dependency matters." },
  outside_source: { task: "explain", blockId: BLOCK.id, question: "What salary did the college principal earn last year?" },
  check_answer: { task: "check_answer", questionId: QUESTION.id, answer: "No. Different students can share a name and have different IDs." },
  check_misconception: { task: "check_answer", questionId: QUESTION.id, answer: "Yes, names are unique, so a name always determines the ID." },
} as const;
export type CaseName = keyof typeof CASES;
