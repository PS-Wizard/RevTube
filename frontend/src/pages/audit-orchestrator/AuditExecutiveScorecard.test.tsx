import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { AuditExecutiveScorecard } from "./AuditExecutiveScorecard";

describe("AuditExecutiveScorecard", () => {
  it("renders overall score, grade, and SVG radial gauge", () => {
    const html = renderToString(
      <AuditExecutiveScorecard
        overall={84}
        grade="A"
        title="Channel Health Report"
        executiveStats={{
          totalPotentialGain: 12,
          projectedMax: 96,
          recCount: 5,
          highCount: 2,
          auditedVideosCount: 20,
        }}
      />
    );
    expect(html).toContain("84");
    expect(html).toContain("Grade");
    expect(html).toContain("Strong Performance");
    expect(html).toContain("aop-score-dial-svg");
    expect(html).toContain("Potential Uplift");
    expect(html).toContain("12");
    expect(html).toContain("Projected Target");
    expect(html).toContain("96");
    expect(html).toContain("Action Items");
    expect(html).toContain("5");
    expect(html).toContain("2 high priority");
    expect(html).toContain("Audited Scope");
    expect(html).toContain("20");
  });

  it("renders live audit result correctly", () => {
    const html = renderToString(
      <AuditExecutiveScorecard
        result={{
          auditRunId: 101,
          overall: 65,
          grade: "C",
          subRuns: {} as any,
        }}
        executiveStats={null}
      />
    );
    expect(html).toContain("65");
    expect(html).toContain("Grade");
    expect(html).toContain("Needs Optimization");
    expect(html).toContain("Overall Channel Health");
  });
});
