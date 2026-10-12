import { describe, expect, it } from "vitest";
import {
  defaultJiraStatusColor,
  parseIssueStatuses,
  parseWorkflow,
  projectKeyOf,
  transitionError,
} from "../../src/jira";

describe("projectKeyOf", () => {
  it("takes the key prefix of a ticket", () => {
    expect(projectKeyOf("ASSMNT-2567")).toBe("ASSMNT");
    expect(projectKeyOf("CR1-9")).toBe("CR1");
    expect(projectKeyOf("not-a-key")).toBeUndefined();
  });
});

describe("parseIssueStatuses", () => {
  it("reads each ticket's status and skips failed ones", () => {
    const envelope = JSON.stringify({
      success: true,
      results: [
        { success: true, data: { status: "Peer Review", key: "ASSMNT-2567", parent: "ASSMNT-2337", summary: "Fix login" } },
        { success: false, error: "Issue does not exist" },
        { success: true, data: { status: "Closed", key: "CR-1" } },
      ],
    });
    expect([...parseIssueStatuses(envelope)]).toEqual([
      ["ASSMNT-2567", { status: "Peer Review", parentKey: "ASSMNT-2337", summary: "Fix login" }],
      ["CR-1", { status: "Closed", parentKey: undefined, summary: undefined }],
    ]);
    expect(parseIssueStatuses("not json").size).toBe(0);
  });
});

describe("parseWorkflow", () => {
  it("reads the current status, all statuses, and transitions", () => {
    const envelope = JSON.stringify({
      results: [
        {
          success: true,
          current_status: "Peer Review",
          statuses: ["To Do", "Peer Review", "CR Validating"],
          transitions: [
            { name: "RC Validating", to_status: "CR Validating" },
            { name: "To Do", to_status: "To Do" },
            { name: 3, to_status: "bad" },
          ],
        },
      ],
    });
    expect(parseWorkflow(envelope)).toEqual({
      currentStatus: "Peer Review",
      statuses: ["To Do", "Peer Review", "CR Validating"],
      transitions: [
        { name: "RC Validating", toStatus: "CR Validating" },
        { name: "To Do", toStatus: "To Do" },
      ],
    });
    expect(parseWorkflow(JSON.stringify({ results: [{ success: false }] }))).toBeUndefined();
  });
});

describe("transitionError", () => {
  it("returns the failure message of the one transition", () => {
    expect(transitionError(JSON.stringify({ results: [{ success: true }] }))).toBeUndefined();
    expect(transitionError(JSON.stringify({ results: [{ success: false, error: "Field required" }] }))).toBe("Field required");
    expect(transitionError("oops")).toBe("the transition failed");
  });
});

describe("defaultJiraStatusColor", () => {
  it("groups status names by meaning", () => {
    expect(defaultJiraStatusColor("Blocked")).toBe(defaultJiraStatusColor("On Hold"));
    expect(defaultJiraStatusColor("Done")).toBe(defaultJiraStatusColor("Deployed to Prod"));
    expect(defaultJiraStatusColor("Ready for QA")).toBe(defaultJiraStatusColor("Ready to Ship"));
    expect(defaultJiraStatusColor("Ready for QA")).not.toBe(defaultJiraStatusColor("In QA"));
    expect(defaultJiraStatusColor("Peer Review")).toBe(defaultJiraStatusColor("PR Approved"));
    expect(defaultJiraStatusColor("Something Odd")).toMatch(/^#[0-9A-F]{6}$/);
  });
});
