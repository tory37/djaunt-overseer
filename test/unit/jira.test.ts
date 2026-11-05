import * as fs from "fs";
import { describe, expect, it } from "vitest";
import {
  jiraStatusColorId,
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

describe("jiraStatusColorId", () => {
  it("groups status names by meaning", () => {
    expect(jiraStatusColorId("Blocked")).toBe(jiraStatusColorId("On Hold"));
    expect(jiraStatusColorId("Done")).toBe(jiraStatusColorId("Deployed to Prod"));
    expect(jiraStatusColorId("Ready for QA")).toBe(jiraStatusColorId("Ready to Ship"));
    expect(jiraStatusColorId("Ready for QA")).not.toBe(jiraStatusColorId("In QA"));
    expect(jiraStatusColorId("Peer Review")).toBe(jiraStatusColorId("PR Approved"));
    expect(jiraStatusColorId("Something Odd")).toBe("overseer.ticketOther");
  });

  it("only returns contributed theme colors", () => {
    const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const contributedIds = packageJson.contributes.colors.map((color: { id: string }) => color.id);
    const sampleStatuses = ["Blocked", "Done", "Removed", "Ready", "In Review", "In QA", "In Progress", "To Do", "Something Odd"];
    for (const statusName of sampleStatuses) {
      expect(contributedIds).toContain(jiraStatusColorId(statusName));
    }
  });
});
