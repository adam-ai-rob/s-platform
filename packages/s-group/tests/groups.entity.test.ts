import { describe, expect, test } from "bun:test";
import { createGroup } from "../core/src/groups/groups.entity";
import { compositeId, createMembership } from "../core/src/memberships/memberships.entity";

describe("createGroup", () => {
  test("lowercases emailDomainNames", () => {
    const g = createGroup({ name: "ACME", emailDomainNames: ["Example.COM", "FOO.io"] });
    expect(g.emailDomainNames).toEqual(["example.com", "foo.io"]);
  });

  test("defaults automaticUserAssignment to true", () => {
    const g = createGroup({ name: "x" });
    expect(g.automaticUserAssignment).toBe(true);
  });

  test("explicit automaticUserAssignment respected", () => {
    const g = createGroup({ name: "x", automaticUserAssignment: false });
    expect(g.automaticUserAssignment).toBe(false);
  });
});

describe("createMembership", () => {
  test("id is composite groupId#userId#rel", () => {
    const m = createMembership({ groupId: "G1", userId: "U1", rel: "manual" });
    expect(m.id).toBe("G1#U1#manual");
    expect(compositeId("G1", "U1", "manual")).toBe("G1#U1#manual");
  });

  test("status defaults to active", () => {
    const m = createMembership({ groupId: "G", userId: "U", rel: "domain" });
    expect(m.status).toBe("active");
  });
});
