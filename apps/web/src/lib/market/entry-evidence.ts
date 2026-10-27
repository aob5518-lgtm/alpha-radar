/** V1.2 ordinal evidence quality, never a calibrated probability.
 * Thresholds are versioned here; hard failures cannot be compensated by points. */
export const EVIDENCE_RULES = {
  ready: 70,
  gradeA: 80,
  gradeC: 60,
  weights: {
    trend: 20,
    ma: 15,
    state: 15,
    macd: 10,
    volume: 10,
    structure: 15,
    price: 15,
  },
} as const;
export type EvidenceKey = keyof typeof EVIDENCE_RULES.weights;
export interface EntryEvidence {
  key: EvidenceKey;
  points: number;
  maximum: number;
  tone: "positive" | "neutral" | "negative";
}
export interface EvidenceFacts {
  trend: "strong" | "neutral" | "weak";
  ma: "confluence" | "aligned" | "flat";
  state: "confirmed" | "pullback" | "bottoming" | "neutral" | "opposed";
  macd: "strong" | "improving" | "neutral" | "conflict";
  volume: "expansion" | "normal" | "light" | "weak";
  structure: "confluence" | "structural" | "breakout" | "weak";
  price: "strong" | "good" | "acceptable" | "weak";
}
export function scoreEvidence(facts: EvidenceFacts) {
  const points = {
    trend: { strong: 20, neutral: 12, weak: 8 }[facts.trend],
    ma: { confluence: 15, aligned: 10, flat: 0 }[facts.ma],
    state: {
      confirmed: 15,
      pullback: 12,
      bottoming: 8,
      neutral: 5,
      opposed: 0,
    }[facts.state],
    macd: { strong: 10, improving: 6, neutral: 3, conflict: 0 }[facts.macd],
    volume: { expansion: 10, normal: 6, light: 3, weak: 0 }[facts.volume],
    structure: { confluence: 15, structural: 12, breakout: 10, weak: 5 }[
      facts.structure
    ],
    price: { strong: 15, good: 10, acceptable: 6, weak: 0 }[facts.price],
  };
  const evidence: EntryEvidence[] = (Object.keys(points) as EvidenceKey[]).map(
    (key) => ({
      key,
      points: points[key],
      maximum: EVIDENCE_RULES.weights[key],
      tone:
        points[key] === 0
          ? "negative"
          : points[key] >= EVIDENCE_RULES.weights[key] * 0.75
            ? "positive"
            : "neutral",
    }),
  );
  const score = evidence.reduce((sum, item) => sum + item.points, 0);
  return { evidence, score, grade: evidenceGrade(score) };
}
export function evidenceGrade(score: number): "A" | "B" | "C" | "none" {
  return score >= EVIDENCE_RULES.gradeA
    ? "A"
    : score >= EVIDENCE_RULES.ready
      ? "B"
      : score >= EVIDENCE_RULES.gradeC
        ? "C"
        : "none";
}
