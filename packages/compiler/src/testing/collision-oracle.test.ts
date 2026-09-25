import { describe, expect, it } from "vitest";

import { randomCases, WORKED_CASES } from "./collision-cases";
import { clearance, type ShapeKind } from "./collision-oracle";

/**
 * The oracle the DS is checked against has to be right first: every hand-worked answer must come out of it, with room to spare. Those answers were
 * worked out on paper from the shapes' sizes (see the names), not by running anything.
 */
describe("the collision oracle", () => {
  for (const c of WORKED_CASES) {
    it(`${c.expected ? "overlap" : "apart"}: ${c.name}`, () => {
      const value = clearance(c.a, c.b);
      expect(value > 0, `clearance ${value.toFixed(4)}`).toBe(c.expected);
      expect(Math.abs(value), "every worked case is clear of touching").toBeGreaterThan(0.03);
    });
  }

  it("gives the exact clearance of two spheres: the gap between their surfaces", () => {
    const sphere = WORKED_CASES.find((c) => c.name.startsWith("two spheres of 0.5 and 0.7 overlap"))!;
    expect(clearance(sphere.a, sphere.b)).toBeCloseTo(1.2 - 1.15, 4);
    const apart = WORKED_CASES.find((c) => c.name === "and don't at 1.25")!;
    expect(clearance(apart.a, apart.b)).toBeCloseTo(1.2 - 1.25, 4);
  });

  it("gives the exact clearance of two axis-aligned boxes", () => {
    const boxes = WORKED_CASES[0];
    expect(clearance(boxes.a, boxes.b)).toBeCloseTo(0.1, 3);
    expect(clearance(WORKED_CASES[1].a, WORKED_CASES[1].b)).toBeCloseTo(-0.1, 3);
  });

  it("makes random cases that are clearly one thing or the other, in about equal numbers", () => {
    const kinds: ShapeKind[] = ["box", "sphere", "capsule", "cylinder"];
    for (const a of kinds) {
      for (const b of kinds) {
        const cases = randomCases(a, b, 20, 7);
        expect(cases).toHaveLength(20);
        expect(cases.filter((c) => c.clearance > 0)).toHaveLength(10);
        for (const c of cases) expect(Math.abs(c.clearance)).toBeGreaterThanOrEqual(0.03);
      }
    }
  });

  it("is repeatable: the same seed gives the same cases", () => {
    expect(randomCases("box", "capsule", 5, 3)).toEqual(randomCases("box", "capsule", 5, 3));
    expect(randomCases("box", "capsule", 5, 3)).not.toEqual(randomCases("box", "capsule", 5, 4));
  });
});
