export const LEARNER_GOALS = ["NEET", "UPSC", "JEE", "K12", "CUET", "FOUNDATION"] as const;

export type LearnerGoal = (typeof LEARNER_GOALS)[number];
export type ExamStreamCode = LearnerGoal;

export const GOAL_META: Record<LearnerGoal, { label: string; blurb: string }> = {
  NEET: { label: "NEET", blurb: "Medical entrance · Classes 11–12 & droppers" },
  UPSC: { label: "UPSC", blurb: "Civil services · Foundation & prelims" },
  JEE: { label: "JEE", blurb: "Engineering entrance · Main & Advanced" },
  K12: { label: "K12", blurb: "School learning · Concepts & board prep" },
  CUET: { label: "CUET", blurb: "University entrance · Subjects & general test" },
  FOUNDATION: { label: "Foundation", blurb: "Classes 8–10 · Build your fundamentals" },
};

export function isLearnerGoal(value: unknown): value is LearnerGoal {
  return typeof value === "string" && (LEARNER_GOALS as readonly string[]).includes(value);
}
