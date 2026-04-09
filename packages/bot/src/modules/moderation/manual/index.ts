import { DBMap, transaction } from "@tally/db";
import { range } from "@thetally/toolbox";
import z, { string, object, array, number, any, union, literal } from "zod";

const condition = union([
  object({
    type: literal("and"),
    get conditions() {
      return array(condition);
    },
  }),
  object({
    type: literal("or"),
    get conditions() {
      return array(condition);
    },
  }),
  object({
    type: literal("not"),
    get condition() {
      return condition;
    },
  }),
  object({
    type: literal("contains"),
    strings: strings(),
  }),
  object({
    type: literal("startsWith"),
    strings: strings(),
  }),
  object({
    type: literal("endsWith"),
    strings: strings(),
  }),
  object({
    type: literal("regex"),
    patterns: strings(),
  }),
  /**
   * time since account creation
   */
  object({
    type: literal("userAge"),
    lessThanMs: number(),
  }),
  /**
   * time in server
   */
  object({
    type: literal("memberAge"),
    lessThanMs: number(),
  }),
]);

const ruleSchema = object({
  id: string(),
  name: string(),
  conditions: z.any(), //todo,
  actions: any(), //todo
});

function strings() {
  return array(string());
}

const saodifj = strings();

type a = z.infer<typeof saodifj>;

const policySchema = object({
  id: string(),
  name: string(),

  rules: array(ruleSchema),
  // actions:
});
const policyAssignmentSchema = object({
  roles: array(string()),
  channels: array(string()),

  policyId: string(),
  priority: number(),
});

for (const i of range(5)) {
  
}
