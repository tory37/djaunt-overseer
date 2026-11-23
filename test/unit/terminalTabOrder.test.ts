import { describe, expect, it } from "vitest";
import { TerminalTabPositions, terminalTabPositions } from "../../src/terminalTabOrder";

describe("terminalTabPositions", () => {
  it("numbers terminals in one group from 1 in tree order", () => {
    expect(terminalTabPositions([1, 1, 1])).toEqual([1, 2, 3]);
  });

  it("counts each editor group on its own", () => {
    expect(terminalTabPositions([1, 2, 1, 2, 3, 1])).toEqual([1, 1, 2, 2, 1, 3]);
  });

  it("returns nothing for no terminals", () => {
    expect(terminalTabPositions([])).toEqual([]);
  });
});

describe("TerminalTabPositions", () => {
  it("gives the next position per group as groups become known", () => {
    const positions = new TerminalTabPositions<number>();

    expect([positions.next(2), positions.next(1), positions.next(2)]).toEqual([1, 1, 2]);
  });
});
